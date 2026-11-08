import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  changeWorkflowCommand,
  type ChangeWorkflowReply,
  type WorkflowFile,
  type WorkflowInspection,
  type WorkflowPlan,
} from '../shared/changeWorkflow'
import { findGitRepository } from './sessions/gitRepository'
import { runProjectCheck } from './changeWorkflowChecks'

const execute = promisify(execFile)
const LIMIT = 8 * 1024 * 1024
interface SavedPlan extends WorkflowPlan {
  sessionId: string
  revision: string
  tree: string
  pending?: { branch: string; commit: string; message: string }
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const hasControl = (value: string) => [...value].some((char) => char.charCodeAt(0) < 32)
const environment = (index?: string) => {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (const key of Object.keys(env))
    if (key.startsWith('GIT_') && key !== 'GIT_TERMINAL_PROMPT') delete env[key]
  return { ...env, GIT_OPTIONAL_LOCKS: '0', ...(index ? { GIT_INDEX_FILE: index } : {}) }
}
async function git(root: string, args: string[], index?: string) {
  const result = await execute('git', ['--no-pager', '--literal-pathspecs', ...args], {
    cwd: root,
    env: environment(index),
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: LIMIT,
  })
  return result.stdout
}
function safePath(path: string) {
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((p) => !p || p === '..' || p === '.' || p.toLowerCase() === '.git') ||
    hasControl(path)
  )
    throw Error('Unsupported file path.')
}
async function safeFile(root: string, path: string) {
  safePath(path)
  let parent = root
  for (const part of path.split('/')) {
    parent = join(parent, part)
    const info = await lstat(parent).catch(() => null)
    if (info?.isSymbolicLink()) throw Error('Symbolic links require review outside this workflow.')
  }
}
const splitPatch = (patch: string) => {
  const offset = patch.indexOf('\n@@ ')
  return offset < 0
    ? { header: patch, hunks: [] }
    : {
        header: patch.slice(0, offset + 1),
        hunks: patch.slice(offset + 1).split(/(?<=\n)(?=@@ )/),
      }
}

/** Local, explicit commands. The caller supplies an already authorised session root. */
export class ChangeWorkflowService {
  private busy = new Set<string>()
  constructor(private readonly directory: string) {}
  async request(sessionId: string, folder: string, input: unknown): Promise<ChangeWorkflowReply> {
    const parsed = changeWorkflowCommand.safeParse(input)
    if (!parsed.success) return { kind: 'error', reason: 'Invalid change workflow request.' }
    const repository = await findGitRepository(folder)
    if (!repository)
      return {
        kind: 'error',
        reason: 'This folder needs an existing Git repository and first commit.',
      }
    const root = repository.root
    const key = repository.commonDir
    if (this.busy.has(key))
      return { kind: 'error', reason: 'Another change operation is running for this repository.' }
    this.busy.add(key)
    try {
      await mkdir(this.directory, { recursive: true })
      const command = parsed.data
      if (command.action === 'roots') return { kind: 'roots', roots: [{ id: digest(root), root }] }
      if (command.action === 'inspect') return await this.inspect(root)
      if (command.action === 'prepare')
        return await this.prepare(sessionId, root, command.revision, command.selection)
      const plan = JSON.parse(
        await readFile(join(this.directory, command.planId + '.json'), 'utf8'),
      ) as SavedPlan
      if (plan.sessionId !== sessionId || plan.root !== root || plan.id !== command.planId)
        throw Error('This plan belongs to a different thread or checkout.')
      if (command.action === 'save' && plan.pending) {
        if (command.branch !== plan.pending.branch || command.message !== plan.pending.message)
          throw Error(
            'A save is already recorded for this plan. Use its original branch and message.',
          )
        const ref = await git(root, [
          'rev-parse',
          '--verify',
          'refs/heads/' + plan.pending.branch,
        ]).catch(() => '')
        if (ref.trim() === plan.pending.commit) {
          plan.receipt = { branch: plan.pending.branch, commit: plan.pending.commit }
          await this.persist(plan)
          return this.publicPlan(plan)
        }
        if (ref) throw Error('The destination branch changed. No branch was overwritten.')
      }
      if (plan.receipt) return this.publicPlan(plan)
      if ((await this.inspect(root)).revision !== plan.revision)
        throw Error(
          'Files, staging or the source branch changed. Refresh and prepare the selection again.',
        )
      if (command.action === 'validate') return await this.validate(plan, command.scripts)
      return await this.save(plan, command.branch, command.message, command.acknowledgeNoTests)
    } catch (error) {
      return {
        kind: 'error',
        reason: error instanceof Error ? error.message.slice(0, 2000) : 'Change operation failed.',
      }
    } finally {
      this.busy.delete(key)
    }
  }
  private publicPlan(plan: SavedPlan): WorkflowPlan {
    const {
      sessionId: _session,
      revision: _revision,
      tree: _tree,
      pending: _pending,
      ...view
    } = plan
    return view
  }
  private async persist(plan: SavedPlan) {
    const file = join(this.directory, plan.id + '.json')
    const temp = file + '.tmp'
    await writeFile(temp, JSON.stringify(plan), { mode: 0o600 })
    await rename(temp, file)
  }
  private async inspect(root: string): Promise<WorkflowInspection> {
    const head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim()
    const branch = (
      await git(root, ['symbolic-ref', '--short', 'HEAD']).catch(() => 'detached HEAD')
    ).trim()
    const index = await git(root, ['ls-files', '--stage', '-z'])
    const entries = new Map(
      index
        .split('\0')
        .filter(Boolean)
        .map((line) => [line.slice(line.indexOf('\t') + 1), line.split(' ')[0]!]),
    )
    if (index.split('\0').some((line) => /^\d+ [a-f0-9]+ [123]\t/.test(line)))
      throw Error('Resolve the current Git conflicts before preparing a commit.')
    const changed = (await git(root, ['diff', '--no-renames', '--name-only', '-z', 'HEAD'])).split(
      '\0',
    )
    const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split(
      '\0',
    )
    const paths = [...new Set([...changed, ...untracked])].filter(Boolean)
    if (paths.length > 500)
      throw Error(
        'This checkout has more than 500 changed files. Narrow it before preparing a commit.',
      )
    const files: WorkflowFile[] = []
    const fingerprints: string[] = [head, branch, index]
    let bytes = 0
    for (const path of paths) {
      await safeFile(root, path)
      if (
        index.split('\0').some((line) => line.startsWith('160000 ') && line.endsWith('\t' + path))
      )
        throw Error('Submodule changes require a separate review.')
      const info = await lstat(join(root, path)).catch(() => null)
      if (info && !info.isFile()) throw Error('Only regular file changes are supported.')
      bytes += info?.size ?? 0
      if (bytes > LIMIT) throw Error('This selection exceeds the 8 MiB review limit.')
      const content = info ? await readFile(join(root, path)) : null
      const contentHash = content ? digest(content) : null
      const tracked = entries.has(path)
      const patch = tracked
        ? await git(root, [
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--no-renames',
            '--binary',
            'HEAD',
            '--',
            path,
          ])
        : content?.includes(0)
          ? 'Binary file addition\n'
          : 'New file\n' + (content?.toString('utf8') ?? '')
      const status = !info ? 'deleted' : tracked ? 'modified' : 'added'
      const chunks = splitPatch(patch)
      const mode = /^new (?:file )?mode (\d+)/m.exec(patch)?.[1] ?? entries.get(path) ?? '100644'
      if (!['100644', '100755'].includes(mode))
        throw Error('Only regular file modes are supported.')
      fingerprints.push(path, contentHash ?? 'deleted', mode, digest(patch))
      files.push({
        contentHash,
        mode,
        path,
        patch,
        status,
        partial:
          status === 'modified' &&
          chunks.hunks.length > 0 &&
          !patch.includes('new file mode') &&
          !patch.includes('old mode'),
        hunks: chunks.hunks,
      })
    }
    return {
      kind: 'inspection',
      root,
      branch,
      revision: digest(JSON.stringify(fingerprints)),
      files,
    }
  }
  private async prepare(
    sessionId: string,
    root: string,
    revision: string,
    selected: { path: string; hunks?: number[] }[],
  ) {
    const inspection = await this.inspect(root)
    if (inspection.revision !== revision)
      throw Error('The checkout changed. Refresh before selecting changes.')
    if (new Set(selected.map((file) => file.path)).size !== selected.length)
      throw Error('A file was selected more than once.')
    const scratch = await mkdtemp(join(tmpdir(), 'threadlight-prepare-'))
    const index = join(scratch, 'index')
    try {
      const base = (await git(root, ['rev-parse', 'HEAD'])).trim()
      await git(root, ['read-tree', base], index)
      for (const selection of selected) {
        const file = inspection.files.find((file) => file.path === selection.path)
        if (!file) throw Error('Selected file is no longer in this comparison.')
        const attributes = await git(root, [
          'check-attr',
          'filter',
          'working-tree-encoding',
          '--',
          file.path,
        ])
        if (
          attributes
            .split('\n')
            .filter(Boolean)
            .some((line) => !/: (unspecified|unset)$/.test(line))
        )
          throw Error('Custom file conversion is not supported in this workflow.')
        if (selection.hunks) {
          const hunks = [...new Set(selection.hunks)]
          if (!file.partial || !hunks.length || hunks.some((i) => i >= file.hunks.length))
            throw Error('Invalid section selection. Select the full file instead.')
          const patch =
            splitPatch(file.patch).header +
            hunks
              .sort((a, b) => a - b)
              .map((i) => file.hunks[i])
              .join('')
          const patchFile = join(scratch, 'selection.patch')
          await writeFile(patchFile, patch)
          await git(root, ['apply', '--cached', '--whitespace=nowarn', patchFile], index)
        } else if (file.status === 'deleted') {
          await git(root, ['update-index', '--force-remove', '--', file.path], index)
        } else {
          // Hash captured bytes, not a live path which another writer can change during Git add.
          const content = await readFile(join(root, file.path))
          if (digest(content) !== file.contentHash)
            throw Error('Selected file changed during preparation.')
          const captured = join(scratch, 'captured')
          await writeFile(captured, content)
          const blob = (
            await git(root, ['hash-object', '-w', '--path=' + file.path, '--', captured])
          ).trim()
          await git(
            root,
            ['update-index', '--add', '--cacheinfo', `${file.mode},${blob},${file.path}`],
            index,
          )
        }
      }
      const tree = (await git(root, ['write-tree'], index)).trim()
      const patch = await git(root, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--binary',
        base,
        tree,
      ])
      if (!patch) throw Error('The selection has no changes compared with the last commit.')
      if ((await this.inspect(root)).revision !== revision)
        throw Error('Files changed while preparing. Refresh and try again.')
      const packageText = await git(root, ['show', tree + ':package.json']).catch(() => '{}')
      const pkg = JSON.parse(packageText) as { scripts?: Record<string, string> }
      const plan: SavedPlan = {
        kind: 'plan',
        id: randomUUID(),
        sessionId,
        root,
        revision,
        tree,
        base,
        sourceBranch: inspection.branch,
        paths: selected.map((f) => f.path),
        patch,
        scripts: Object.keys(pkg.scripts ?? {}).filter(
          (s) =>
            /^[a-zA-Z0-9:_-]+$/.test(s) &&
            /^(test|check|verify|lint|typecheck|build)(:|$)|^(format|plugins):check$/.test(s) &&
            !/(^|:)watch(:|$)/.test(s),
        ),
        checks: [],
        validated: false,
      }
      await this.persist(plan)
      return this.publicPlan(plan)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
  private async validate(plan: SavedPlan, scripts: string[]) {
    if (scripts.some((script) => !plan.scripts.includes(script)))
      throw Error('Unknown project check.')
    plan.validated = false
    plan.checks = []
    await this.persist(plan)
    try {
      await git(plan.root, ['diff', '--check', plan.base, plan.tree])
      plan.checks.push({
        name: 'Patch whitespace',
        ok: true,
        output: 'No whitespace errors or added conflict markers.',
      })
    } catch (error) {
      plan.checks.push({
        name: 'Patch whitespace',
        ok: false,
        output: String(error).slice(0, 8000),
      })
    }
    if (scripts.length) {
      const scratch = await mkdtemp(join(tmpdir(), 'threadlight-check-'))
      const index = join(scratch, 'index')
      const checkout = join(scratch, 'source')
      const dependencies = join(checkout, 'node_modules')
      let linked = false
      try {
        await mkdir(checkout)
        await git(plan.root, ['read-tree', plan.tree], index)
        await git(
          plan.root,
          ['checkout-index', '--all', '--prefix=' + checkout.replaceAll('\\', '/') + '/'],
          index,
        )
        if (await lstat(join(plan.root, 'node_modules')).catch(() => null)) {
          if (await lstat(dependencies).catch(() => null))
            throw Error('Candidate contains node_modules; cannot attach local dependencies.')
          await symlink(
            join(plan.root, 'node_modules'),
            dependencies,
            process.platform === 'win32' ? 'junction' : 'dir',
          )
          linked = true
        }
        for (const script of [...new Set(scripts)]) {
          try {
            const output = await runProjectCheck(checkout, script, environment())
            plan.checks.push({
              name: 'npm run ' + script,
              ok: true,
              output,
            })
          } catch (error) {
            plan.checks.push({
              name: 'npm run ' + script,
              ok: false,
              output: String(error).slice(-8000),
            })
          }
        }
        try {
          await git(
            plan.root,
            ['--work-tree=' + checkout, 'diff', '--exit-code', plan.tree, '--'],
            index,
          )
        } catch {
          plan.checks.push({
            name: 'Candidate unchanged',
            ok: false,
            output:
              'A check modified tracked candidate files. The original candidate was not fully validated.',
          })
        }
      } finally {
        // Detach the junction itself before removing the disposable checkout on Windows.
        if (linked) await rm(dependencies, { recursive: false, force: true })
        await rm(scratch, { recursive: true, force: true })
      }
    }
    plan.validated = plan.checks.every((check) => check.ok)
    await this.persist(plan)
    return this.publicPlan(plan)
  }
  private async save(plan: SavedPlan, branch: string, message: string, acknowledge: boolean) {
    if (!plan.validated || !plan.checks.length || plan.checks.some((check) => !check.ok))
      throw Error('Run and pass the selected checks before saving.')
    if (plan.checks.length === 1 && !acknowledge)
      throw Error('No project checks were run. Acknowledge this before saving a local checkpoint.')
    if (branch.startsWith('-') || /\s/.test(branch) || hasControl(branch))
      throw Error('Choose a valid new branch name.')
    await git(plan.root, ['check-ref-format', '--branch', branch])
    const repository = (await findGitRepository(plan.root))!
    const hookConfig = (
      await git(plan.root, ['config', '--get', 'core.hooksPath']).catch(() => '')
    ).trim()
    const hooks = hookConfig ? resolve(plan.root, hookConfig) : join(repository.commonDir, 'hooks')
    const activeHooks = (await readdir(hooks).catch(() => [])).filter((name) =>
      ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit'].includes(name),
    )
    if (activeHooks.length)
      throw Error(
        'This repository has commit hooks. Use its normal commit workflow; guided hook execution is not supported yet.',
      )
    const ref = 'refs/heads/' + branch
    if (
      await git(plan.root, ['show-ref', '--verify', ref]).then(
        () => true,
        () => false,
      )
    )
      throw Error('That branch already exists. Choose a new branch; nothing was overwritten.')
    if (!plan.pending) {
      const signed =
        (
          await git(plan.root, ['config', '--bool', '--get', 'commit.gpgsign']).catch(() => '')
        ).trim() === 'true'
      const commit = (
        await git(plan.root, [
          'commit-tree',
          ...(signed ? ['-S'] : []),
          plan.tree,
          '-p',
          plan.base,
          '-m',
          message,
        ])
      ).trim()
      plan.pending = { branch, commit, message }
      await this.persist(plan)
    }
    if ((await this.inspect(plan.root)).revision !== plan.revision)
      throw Error('The checkout changed before saving. The destination branch was not created.')
    await git(plan.root, [
      'update-ref',
      '-m',
      'Threadlight reviewed change',
      ref,
      plan.pending.commit,
      '0'.repeat(plan.pending.commit.length),
    ])
    plan.receipt = { branch, commit: plan.pending.commit }
    await this.persist(plan)
    return this.publicPlan(plan)
  }
}
