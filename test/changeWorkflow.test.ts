import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChangeWorkflowService } from '../src/main/changeWorkflow'
import type {
  ChangeWorkflowReply,
  WorkflowInspection,
  WorkflowPlan,
} from '../src/shared/changeWorkflow'

const exec = promisify(execFile)
let root: string, store: string, service: ChangeWorkflowService
const git = async (...args: string[]) =>
  (await exec('git', args, { cwd: root, windowsHide: true })).stdout.trim()
const plan = (result: ChangeWorkflowReply) => {
  expect(result.kind, JSON.stringify(result)).toBe('plan')
  return result as WorkflowPlan
}
const inspect = async () => {
  const result = await service.request('chat', root, { action: 'inspect' })
  expect(result.kind, JSON.stringify(result)).toBe('inspection')
  return result as WorkflowInspection
}
const prepare = async (selection: { path: string; hunks?: number[] }[]) =>
  plan(
    await service.request('chat', root, {
      action: 'prepare',
      revision: (await inspect()).revision,
      selection,
    }),
  )
const validate = async (p: WorkflowPlan, scripts: string[] = []) =>
  plan(await service.request('chat', root, { action: 'validate', planId: p.id, scripts }))
const save = (p: WorkflowPlan, branch = 'reviewed') =>
  service.request('chat', root, {
    action: 'save',
    planId: p.id,
    branch,
    message: 'Reviewed selection',
    acknowledgeNoTests: true,
  })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'threadlight-workflow-test-'))
  store = await mkdtemp(join(tmpdir(), 'threadlight-workflow-store-'))
  service = new ChangeWorkflowService(store)
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'user.name', 'Workflow test')
  await git('config', 'core.autocrlf', 'false')
  await git('config', 'commit.gpgsign', 'false')
  await writeFile(
    join(root, 'shared.txt'),
    Array.from({ length: 30 }, (_, i) => 'line ' + i).join('\n') + '\n',
  )
  await writeFile(join(root, 'other.txt'), 'original\n')
  await git('add', '.')
  await git('commit', '-m', 'base')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(store, { recursive: true, force: true })
})
describe('guided local change workflow', () => {
  it('saves selected sections on a new branch and preserves dirty files, original HEAD and index bytes', async () => {
    const original = await readFile(join(root, 'shared.txt'), 'utf8')
    const changed = original
      .replace('line 1\n', 'first writer\n')
      .replace('line 25\n', 'second writer\n')
    await writeFile(join(root, 'shared.txt'), changed)
    await writeFile(join(root, 'other.txt'), 'someone else staged this\n')
    await git('add', 'other.txt')
    const beforeHead = await git('rev-parse', 'HEAD'),
      beforeIndex = await readFile(join(root, '.git', 'index'))
    const p = await prepare([{ path: 'shared.txt', hunks: [0] }])
    expect(p.patch).toContain('first writer')
    expect(p.patch).not.toContain('second writer')
    await validate(p)
    const result = plan(await save(p))
    expect(await git('show', 'reviewed:shared.txt')).toBe(
      original.replace('line 1\n', 'first writer\n').trim(),
    )
    expect(await git('show', 'reviewed:other.txt')).toBe('original')
    expect(await git('rev-parse', 'HEAD')).toBe(beforeHead)
    expect(await git('branch', '--show-current')).toBe('main')
    expect(await readFile(join(root, '.git', 'index'))).toEqual(beforeIndex)
    expect(await readFile(join(root, 'shared.txt'), 'utf8')).toBe(changed)
    service = new ChangeWorkflowService(store)
    expect(plan(await save(p)).receipt).toEqual(result.receipt)
  }, 60000)
  it('includes explicitly selected staged edits and untracked files without changing staging', async () => {
    await writeFile(join(root, 'other.txt'), 'staged version\n')
    await git('add', 'other.txt')
    await writeFile(join(root, 'new.txt'), 'new contents\n')
    const index = await readFile(join(root, '.git', 'index'))
    const p = await prepare([{ path: 'other.txt' }, { path: 'new.txt' }])
    await validate(p)
    plan(await save(p))
    expect(await git('show', 'reviewed:new.txt')).toBe('new contents')
    expect(await git('show', 'reviewed:other.txt')).toBe('staged version')
    expect(await readFile(join(root, '.git', 'index'))).toEqual(index)
  }, 60000)
  it('rejects stale selection, cross-thread plans, invalid paths and stale save', async () => {
    await writeFile(join(root, 'other.txt'), 'change\n')
    const first = await inspect()
    await writeFile(join(root, 'other.txt'), 'changed again\n')
    expect(
      await service.request('chat', root, {
        action: 'prepare',
        revision: first.revision,
        selection: [{ path: 'other.txt' }],
      }),
    ).toMatchObject({ kind: 'error', reason: expect.stringContaining('changed') })
    expect(
      await service.request('chat', root, {
        action: 'prepare',
        revision: (await inspect()).revision,
        selection: [{ path: '../outside' }],
      }),
    ).toMatchObject({ kind: 'error' })
    const p = await prepare([{ path: 'other.txt' }])
    await validate(p)
    expect(
      await service.request('another-chat', root, {
        action: 'validate',
        planId: p.id,
        scripts: [],
      }),
    ).toMatchObject({ kind: 'error' })
    await writeFile(join(root, 'other.txt'), 'third writer\n')
    expect(await save(p)).toMatchObject({
      kind: 'error',
      reason: expect.stringContaining('changed'),
    })
    await expect(git('rev-parse', '--verify', 'reviewed')).rejects.toThrow()
  }, 60000)
  it('blocks failed checks, missing test acknowledgement, hooks and an existing branch', async () => {
    await writeFile(join(root, 'other.txt'), 'trailing whitespace   \n')
    let p = await prepare([{ path: 'other.txt' }])
    expect((await validate(p)).validated).toBe(false)
    expect(await save(p)).toMatchObject({ kind: 'error' })
    await writeFile(join(root, 'other.txt'), 'clean\n')
    p = await prepare([{ path: 'other.txt' }])
    await validate(p)
    expect(
      await service.request('chat', root, {
        action: 'save',
        planId: p.id,
        branch: 'reviewed',
        message: 'checkpoint',
        acknowledgeNoTests: false,
      }),
    ).toMatchObject({ kind: 'error', reason: expect.stringContaining('No project checks') })
    await git('branch', 'existing')
    expect(await save(p, 'existing')).toMatchObject({
      kind: 'error',
      reason: expect.stringContaining('already exists'),
    })
    await writeFile(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
    expect(await save(p)).toMatchObject({
      kind: 'error',
      reason: expect.stringContaining('commit hooks'),
    })
  }, 60000)
  it('runs project checks against the selected candidate, excluding other dirty changes', async () => {
    const pkg = {
      scripts: { verify: 'node verify.cjs', 'check:fail': 'node -e "process.exit(2)"' },
    }
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg))
    await writeFile(
      join(root, 'verify.cjs'),
      "const fs=require('fs');if(fs.readFileSync('other.txt','utf8')!=='original\\n')process.exit(3)\n",
    )
    await git('add', 'package.json', 'verify.cjs')
    await git('commit', '-m', 'checks')
    await writeFile(join(root, 'other.txt'), 'unselected dirty change\n')
    await writeFile(join(root, 'new.txt'), 'selected\n')
    const p = await prepare([{ path: 'new.txt' }])
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', 'dependency-proof'), 'preserve dependency target')
    const withDependencies = await prepare([{ path: 'new.txt' }])
    expect((await validate(withDependencies, ['verify'])).validated).toBe(true)
    expect(await readFile(join(root, 'node_modules', 'dependency-proof'), 'utf8')).toBe(
      'preserve dependency target',
    )
    // Preparing the second candidate changed the observed checkout; refresh this plan too.
    const current = await prepare([{ path: 'new.txt' }])
    expect((await validate(current, ['check:fail'])).validated).toBe(false)
    expect(await save(current)).toMatchObject({ kind: 'error' })
    expect(p.scripts).not.toContain('deploy')
  }, 60000)
  it('saves deletions and binary additions without changing their source files', async () => {
    await rm(join(root, 'other.txt'))
    const bytes = Buffer.from([0, 255, 1, 128, 0])
    await writeFile(join(root, 'image.bin'), bytes)
    const p = await prepare([{ path: 'other.txt' }, { path: 'image.bin' }])
    await validate(p)
    plan(await save(p))
    await expect(git('show', 'reviewed:other.txt')).rejects.toThrow()
    const committed = await exec('git', ['show', 'reviewed:image.bin'], {
      cwd: root,
      encoding: 'buffer',
      windowsHide: true,
    })
    expect(committed.stdout).toEqual(bytes)
    expect(await readFile(join(root, 'image.bin'))).toEqual(bytes)
  }, 60000)
  it('rejects a check that changes tracked candidate sources', async () => {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'check:mutate': "node -e \"require('fs').writeFileSync('other.txt','different')\"",
        },
      }),
    )
    await git('add', 'package.json')
    await git('commit', '-m', 'check script')
    await writeFile(join(root, 'other.txt'), 'selection\n')
    const p = await prepare([{ path: 'other.txt' }])
    const result = await validate(p, ['check:mutate'])
    expect(result.validated).toBe(false)
    expect(result.checks.at(-1)?.name).toBe('Candidate unchanged')
    expect(await readFile(join(root, 'other.txt'), 'utf8')).toBe('selection\n')
  }, 60000)
})
