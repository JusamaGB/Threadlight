import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { temporaryDirectory } from './helpers'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureGit, invalidateGitComparison, retainedPatch } from '../src/main/changes/git'
import { LocalHistory } from '../src/main/changes/store'
import { ThreadDiffLedger } from '../src/main/sessions/threadDiff'
import { UncommittedThreads } from '../src/main/sessions/threadUncommitted'
import { ThreadChanges } from '../src/main/sessions/threadChanges'
import { DatabaseSync } from 'node:sqlite'
import type { Session } from '../src/shared/types'
import { supportedLines } from '../src/main/changes/mapping'
import { parseUnifiedDiff } from '../src/shared/unifiedDiff'

async function fixture(work: (root: string, git: (...args: string[]) => string) => Promise<void>) {
  const root = await temporaryDirectory('threadlight-local-')
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: 'pipe',
    })
  try {
    git('init', '-q')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'core.autocrlf', 'false')
    await work(root, git)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('local Git comparison contract', { timeout: 60_000 }, () => {
  it('groups one chat editing two repositories and opens identical relative paths in their own root', async () =>
    fixture(async (root, git) => {
      const second = join(root, 'second'),
        history = join(root, 'history.sqlite')
      await mkdir(second)
      await writeFile(join(root, '.git', 'info', 'exclude'), 'history.sqlite\nsecond/\n')
      await writeFile(join(root, 'shared.txt'), 'base\n')
      git('add', '.')
      git('commit', '-qm', 'base')
      const gitSecond = (...args: string[]) =>
        execFileSync('git', ['-C', second, ...args], { windowsHide: true, stdio: 'pipe' })
      gitSecond('init', '-q')
      gitSecond('config', 'user.name', 'Test')
      gitSecond('config', 'user.email', 'test@example.invalid')
      await writeFile(join(second, 'shared.txt'), 'base\n')
      gitSecond('add', '.')
      gitSecond('commit', '-qm', 'base')
      await writeFile(join(root, 'shared.txt'), 'first owner\n')
      await writeFile(join(second, 'shared.txt'), 'second owner\n')
      const db = new DatabaseSync(history)
      try {
        db.exec(
          'CREATE TABLE thread_items(thread_id TEXT,item_json TEXT,rollout_ordinal INTEGER,item_type TEXT)',
        )
        db.prepare('INSERT INTO thread_items VALUES(?,?,?,?)').run(
          'multi',
          JSON.stringify({
            id: 'native-both',
            type: 'fileChange',
            status: 'completed',
            changes: [root, second].map((folder, index) => ({
              path: join(folder, 'shared.txt'),
              kind: { type: 'update' },
              diff: `@@ -1 +1 @@\n-base\n+${index ? 'second' : 'first'} owner\n`,
            })),
          }),
          1,
          'fileChange',
        )
        const service = new ThreadChanges({ history, transcript: () => null, changed: () => {} })
        const session = { id: 'codex:multi', cwd: root, git: { root, branch: 'main' } } as Session
        const result = await service.changes(session)
        expect(result?.groups).toHaveLength(2)
        expect(result?.files.map((file) => file.displayPath)).toEqual(['shared.txt', 'shared.txt'])
        expect(new Set(result?.files.map((file) => file.path)).size).toBe(2)
        const item = result!.files.find(
          (file) => file.rootId === result!.groups!.find((group) => group.root === second)!.rootId,
        )!
        expect(JSON.stringify(await service.file(session, item.path, result!.revision))).toContain(
          'second owner',
        )
        expect(await service.sourceRoot(session, item.path, result!.revision)).toBe(second)
        expect(await service.absolute(session, item.path, result!.revision)).toBe(
          join(second, 'shared.txt').replace(/\\/g, '/'),
        )
      } finally {
        db.close()
      }
    }))
  it('separates current, staged and unstaged endpoints and retains the clicked revision', async () =>
    fixture(async (root, git) => {
      await writeFile(join(root, 'a.txt'), 'A\n')
      git('add', '.')
      git('commit', '-qm', 'base')
      await writeFile(join(root, 'a.txt'), 'B\n')
      git('add', '.')
      await writeFile(join(root, 'a.txt'), 'A\n')
      const current = await captureGit(root)
      expect(current).toMatchObject({ files: [], complete: true, hasOtherLensChanges: true })
      const staged = await captureGit(root, 'git-staged')
      const unstaged = await captureGit(root, 'git-unstaged')
      expect(staged.files).toMatchObject([{ added: 1, removed: 1 }])
      expect(unstaged.patches.get('a.txt')).toMatchObject({
        kind: 'text',
        lines: expect.arrayContaining([{ type: 'add', text: 'A', newLine: 1 }]),
      })
      await writeFile(join(root, 'a.txt'), 'C\n')
      git('add', '.')
      invalidateGitComparison(root)
      await captureGit(root, 'git-staged')
      expect(retainedPatch(root, staged.revision, 'a.txt')).toMatchObject({
        kind: 'text',
        lines: expect.arrayContaining([{ type: 'add', text: 'B', newLine: 1 }]),
      })
      expect(retainedPatch(root, 'expired', 'a.txt')).toMatchObject({
        kind: 'unavailable',
        reason: expect.stringContaining('refresh'),
      })
    }))
  it('supports an unborn repository and unknown binary line metrics', async () =>
    fixture(async (root, git) => {
      await writeFile(join(root, 'new.txt'), 'one\ntwo\n')
      git('add', '.')
      await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
      const result = await captureGit(root)
      expect(result.files.find((f) => f.path === 'new.txt')).toMatchObject({
        added: 2,
        removed: 0,
        status: 'added',
      })
      expect(result.coverage?.files.state).toBe('complete')
      expect(result.coverage?.added.state).toBe('partial')
      expect(result.complete).toBe(false)
    }))
  it('refuses content filters before they can execute', async () =>
    fixture(async (root, git) => {
      await writeFile(join(root, 'a.txt'), 'base\n')
      git('add', '.')
      git('commit', '-qm', 'base')
      git('config', 'filter.test.clean', 'echo invoked > invoked.txt')
      await writeFile(join(root, '.gitattributes'), '*.txt filter=test\n')
      await writeFile(join(root, 'a.txt'), 'next\n')
      await expect(captureGit(root)).rejects.toThrow('Unsupported Git filter')
      await expect(readFile(join(root, 'invoked.txt'))).rejects.toThrow()
    }))
})

describe('ordinary folders', { timeout: 60_000 }, () => {
  it('can inspect an existing baseline while recording is paused without persisting new bytes', async () => {
    const parent = await temporaryDirectory('threadlight-paused-'),
      root = join(parent, 'folder'),
      history = new LocalHistory(join(parent, 'history'))
    try {
      await mkdir(root)
      await writeFile(join(root, 'a.txt'), 'before\n')
      let state = await history.state(root)
      state = await history.configure(root, 'enable', state.policyRevision)
      state = await history.configure(root, 'pause', state.policyRevision)
      await writeFile(join(root, 'a.txt'), 'after\n')
      expect((await history.comparison(root))?.files).toMatchObject([
        { path: 'a.txt', added: 1, removed: 1 },
      ])
      expect((await history.state(root)).bytes).toBe(state.bytes)
    } finally {
      await history.close()
      await rm(parent, { recursive: true, force: true })
    }
  })
  it('deduplicates durable evidence, preserves it after restart, and blocks replay after Forget', async () => {
    const parent = await temporaryDirectory('threadlight-evidence-'),
      root = join(parent, 'folder'),
      store = join(parent, 'history')
    let history = new LocalHistory(store)
    try {
      await mkdir(root)
      await writeFile(join(root, 'a.txt'), 'base\n')
      let state = await history.state(root)
      state = await history.configure(root, 'enable', state.policyRevision)
      const ledger = new ThreadDiffLedger()
      ledger.record(
        { path: join(root, 'a.txt'), kind: 'update', before: 'base\n', after: 'mine\n' },
        'native-tool-1',
      )
      await history.recordEvidence(root, 'codex:chat', ledger)
      await history.recordEvidence(root, 'codex:chat', ledger)
      expect((await history.recordedEvidence(root, 'codex:chat'))?.mutations).toHaveLength(1)
      await history.close()
      history = new LocalHistory(store)
      await history.start()
      expect((await history.recordedEvidence(root, 'codex:chat'))?.data().summary).toMatchObject({
        added: 1,
        removed: 1,
        complete: false,
      })
      state = await history.configure(root, 'forget', state.policyRevision)
      await history.configure(root, 'enable', state.policyRevision)
      await history.recordEvidence(root, 'codex:chat', ledger)
      expect((await history.recordedEvidence(root, 'codex:chat'))?.mutations).toHaveLength(0)
      ledger.record(
        { path: join(root, 'a.txt'), kind: 'update', before: 'mine\n', after: 'next\n' },
        'native-tool-2',
      )
      await history.recordEvidence(root, 'codex:chat', ledger)
      expect((await history.recordedEvidence(root, 'codex:chat'))?.mutations).toHaveLength(1)
    } finally {
      await history.close()
      await rm(parent, { recursive: true, force: true })
    }
  })
  it('requires recording, preserves baseline across restart, excludes secrets and forgets history', async () => {
    const parent = await temporaryDirectory('threadlight-baseline-'),
      root = join(parent, 'folder'),
      store = join(parent, 'history')
    let history = new LocalHistory(store)
    try {
      await mkdir(root)
      await writeFile(join(root, 'a.txt'), 'before\n')
      await writeFile(join(root, '.env'), 'SECRET=value\n')
      const state = await history.state(root)
      expect(state.recording).toBe(false)
      expect(await history.comparison(root)).toBeNull()
      await history.configure(root, 'enable', state.policyRevision)
      await writeFile(join(root, 'a.txt'), 'after\n')
      let result = await history.comparison(root)
      expect(result?.files).toMatchObject([{ path: 'a.txt', added: 1, removed: 1 }])
      expect(result?.files.some((file) => file.path === '.env')).toBe(false)
      await history.close()
      history = new LocalHistory(store)
      result = await history.comparison(root)
      expect(result?.files).toMatchObject([{ path: 'a.txt', added: 1, removed: 1 }])
      const current = await history.state(root)
      await history.configure(root, 'forget', current.policyRevision)
      expect(await history.state(root)).toMatchObject({
        baseline: null,
        recording: false,
        bytes: 0,
      })
      expect(await history.comparison(root)).toBeNull()
    } finally {
      await history.close()
      await rm(parent, { recursive: true, force: true })
    }
  })
  it('rejects stale settings and keeps an active baseline when storage is exhausted', async () => {
    const parent = await temporaryDirectory('threadlight-limit-'),
      root = join(parent, 'folder')
    const history = new LocalHistory(join(parent, 'history'), 16)
    try {
      await mkdir(root)
      await writeFile(join(root, 'a.txt'), '1234567890\n')
      const state = await history.state(root)
      const enabled = await history.configure(root, 'enable', state.policyRevision)
      await expect(history.configure(root, 'pause', state.policyRevision)).rejects.toThrow(
        'settings changed',
      )
      await writeFile(join(root, 'a.txt'), 'abcdefghij\n')
      expect((await history.comparison(root))?.complete).toBe(false)
      expect((await history.state(root)).baseline).toBe(enabled.baseline)
    } finally {
      await history.close()
      await rm(parent, { recursive: true, force: true })
    }
  })
})

describe('evidence correspondence', () => {
  it('retains counts beyond preview limits using captured endpoints only', async () => {
    const root = join(tmpdir(), 'synthetic-local-comparison'),
      path = join(root, 'new.txt')
    const text = Array.from({ length: 1600 }, (_, index) => `line ${index}`).join('\n') + '\n'
    const ledger = new ThreadDiffLedger()
    ledger.record({ path, kind: 'add', after: text })
    const lines = text
      .trimEnd()
      .split('\n')
      .map((text, index) => ({ type: 'add' as const, text, newLine: index + 1 }))
    const result = await new UncommittedThreads().project(ledger, root, 0, {
      root,
      rootId: 'root',
      revision: 'captured',
      branch: null,
      lens: 'folder-baseline',
      complete: true,
      files: [{ path: 'new.txt', status: 'added', added: 1600, removed: 0, binary: false }],
      patches: new Map([['new.txt', { kind: 'too-big', lines: 1600 }]]),
      evidence: new Map([['new.txt', { lines, before: '', after: text }]]),
    })
    expect(result?.summary).toMatchObject({ added: 1600, removed: 0, files: 1, complete: false })
    expect(result?.files[0]?.diff).toEqual({ kind: 'too-big', lines: 1600 })
  })
  it('maps a surviving contextual edit after an insertion above it', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({
      path: '/file',
      kind: 'update',
      before: 'top\nold\nend\n',
      after: 'top\nmine\nend\n',
    })
    const current = parseUnifiedDiff('@@ -1,3 +1,4 @@\n+new heading\n top\n-old\n+mine\n end\n')
    const selected = supportedLines(
      current,
      ledger.evidence()[0]!.events,
      'top\nold\nend\n',
      'new heading\ntop\nmine\nend\n',
    )
    expect(selected.filter((l) => l.type === 'add')).toEqual([
      { type: 'add', text: 'mine', newLine: 3 },
    ])
    expect(selected.filter((l) => l.type === 'remove')).toEqual([
      { type: 'remove', text: 'old', oldLine: 2 },
    ])
  })
  it('withholds an ambiguous repeated context and an overwritten replacement', () => {
    const ledger = new ThreadDiffLedger()
    ledger.record({
      path: '/file',
      kind: 'update',
      before: 'top\nold\nend\n',
      after: 'top\nmine\nend\n',
    })
    const current = parseUnifiedDiff('@@ -1,3 +1,3 @@\n top\n-old\n+mine\n end\n')
    const selected = supportedLines(
      current,
      ledger.evidence()[0]!.events,
      'top\nold\nend\n',
      'top\nmine\nend\ntop\nmine\nend\n',
    )
    expect(selected.filter((l) => l.type === 'add')).toEqual([])
    const overwritten = parseUnifiedDiff('@@ -1,3 +1,3 @@\n top\n-old\n+someone else\n end\n')
    expect(
      supportedLines(
        overwritten,
        ledger.evidence()[0]!.events,
        'top\nold\nend\n',
        'top\nsomeone else\nend\n',
      ),
    ).toEqual([])
  })
})
