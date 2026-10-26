import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GitStates, readGitState } from '../src/main/sessions/gitDiff'
import { findGitRepository, gitPathKey } from '../src/main/sessions/gitRepository'
import { WorkQueue } from '../src/main/sessions/gitProcess'
import type { GitState, Session, Snapshot } from '../src/shared/types'

const state = (root: string): GitState => ({
  root,
  branch: 'main',
  files: 0,
  newFiles: 0,
  added: 0,
  removed: 0,
  ahead: 0,
  behind: 0,
  worktrees: [root],
})
const repository = (root: string) => ({
  root,
  gitDir: join(root, '.git'),
  commonDir: join(root, '.git'),
})
const session = (id: string, cwd: string): Session =>
  ({ id, cwd, git: null, gitFolders: [cwd] }) as Session
const snapshot = (sessions: Session[], lookupSessions: Session[] = []): Snapshot => ({
  sessions,
  lookupSessions,
  workspaces: [],
  allWorkspaces: [],
  currentWorkspace: null,
  currentThreadId: null,
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Git startup scheduling', () => {
  it('shares work across subfolders, publishes branch metadata before counts, and never demands lookup-only chats', async () => {
    const root = join(tmpdir(), 'not-created-git-latency')
    const complete = deferred<GitState | null>()
    const count = vi.fn(async (path: string, progress?: (value: GitState) => void) => {
      progress?.({ ...state(path), pending: true })
      return complete.promise
    })
    const locate = vi.fn(async () => repository(root))
    const states = new GitStates(() => {}, Date.now, count, locate)
    const input = snapshot(
      [session('a', join(root, 'src')), session('b', join(root, 'test'))],
      Array.from({ length: 200 }, (_, i) => session(`hidden-${i}`, join(root, `hidden-${i}`))),
    )
    try {
      states.annotate(input)
      await vi.waitFor(() => expect(count).toHaveBeenCalledTimes(1))
      expect(locate).toHaveBeenCalledTimes(2)
      const early = states.annotate(input)
      expect(early.sessions.every((item) => item.git?.branch === 'main' && item.git.pending)).toBe(
        true,
      )
      expect(early.lookupSessions?.every((item) => item.git === null)).toBe(true)
      complete.resolve({ ...state(root), added: 7, files: 1 })
      await vi.waitFor(() => expect(states.peek(join(root, 'src'))?.added).toBe(7))
      expect(states.peek(join(root, 'test'))?.added).toBe(7)
      expect(count).toHaveBeenCalledTimes(1)
    } finally {
      complete.resolve(state(root))
      await states.close()
    }
  })

  it('rechecks invalidation during a scan without overlapping refreshes or publishing the old result', async () => {
    const root = join(tmpdir(), 'not-created-git-invalidated')
    const first = deferred<GitState | null>()
    const count = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ ...state(root), added: 2 })
    const states = new GitStates(
      () => {},
      Date.now,
      count,
      async () => repository(root),
    )
    try {
      states.get(root)
      await vi.waitFor(() => expect(count).toHaveBeenCalledTimes(1))
      states.invalidate(root)
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(count).toHaveBeenCalledTimes(1)
      first.resolve({ ...state(root), added: 99 })
      await vi.waitFor(() => expect(states.peek(root)?.added).toBe(2))
      expect(count).toHaveBeenCalledTimes(2)
    } finally {
      first.resolve(state(root))
      await states.close()
    }
  })

  it('limits work globally and releases a slot after failure', async () => {
    const queue = new WorkQueue(4)
    let active = 0,
      peak = 0
    const release = deferred<void>()
    const runs = Array.from({ length: 30 }, (_, i) =>
      queue.run(async () => {
        active++
        peak = Math.max(peak, active)
        await release.promise
        active--
        if (i === 0) throw Error('unavailable repo')
      }),
    )
    await vi.waitFor(() => expect(active).toBe(4))
    release.resolve()
    expect(
      (await Promise.allSettled(runs)).filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    expect(peak).toBe(4)
  })
})

describe('repository identity and change notification', () => {
  it('preserves nested repositories and linked worktrees, and refreshes a branch on a filesystem event', async () => {
    const home = await mkdtemp(join(tmpdir(), 'threadlight-git-latency-'))
    const root = join(home, 'repo'),
      linked = join(home, 'linked'),
      nested = join(root, 'nested')
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, stdio: 'pipe' })
    let states: GitStates | undefined
    try {
      await mkdir(join(root, 'src'), { recursive: true })
      git(root, 'init', '-q', '-b', 'main')
      git(root, 'config', 'user.email', 'test@example.invalid')
      git(root, 'config', 'user.name', 'Test')
      await writeFile(join(root, 'file'), 'one\n')
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'baseline')
      git(root, 'worktree', 'add', '-qb', 'feature', linked)
      await mkdir(nested)
      git(nested, 'init', '-q')
      expect(gitPathKey((await findGitRepository(join(root, 'src')))!.root)).toBe(gitPathKey(root))
      expect(gitPathKey((await findGitRepository(nested))!.root)).toBe(gitPathKey(nested))
      const identity = (await findGitRepository(linked))!
      expect(gitPathKey(identity.root)).toBe(gitPathKey(linked))
      expect(identity.gitDir).not.toBe(identity.commonDir)
      const progress = vi.fn()
      expect((await readGitState(linked, progress))?.branch).toBe('feature')
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'feature', pending: true }),
      )
      const changed = vi.fn()
      states = new GitStates(changed)
      states.get(root)
      await vi.waitFor(() => expect(states!.peek(root)?.pending).toBeUndefined(), { timeout: 5000 })
      await vi.waitFor(() => expect(states!.peek(root)?.branch).toBe('main'), { timeout: 5000 })
      git(root, 'checkout', '-qb', 'changed')
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(expect.any(String), true), {
        timeout: 2500,
      })
      await vi.waitFor(() => expect(states!.peek(root)?.branch).toBe('changed'), { timeout: 5000 })
    } finally {
      await states?.close()
      await rm(home, { recursive: true, force: true })
    }
  }, 30_000)
})
