import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  countChanges,
  GitStates,
  parseNumstat,
  parseWorktrees,
  readGitState,
} from '../src/main/sessions/gitDiff'
import type { GitState } from '../src/shared/types'

describe('parsing git', () => {
  it('adds up every file, skipping binary ones', () => {
    expect(parseNumstat('3\t1\ta.ts\x0020\t0\tb.ts\x00-\t-\timage.png\x00')).toEqual({
      added: 23,
      removed: 1,
    })
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0 })
  })

  it('lists worktrees, the main checkout first', () => {
    const porcelain =
      'worktree Z:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree Z:/repo-ui\nHEAD def\nbranch refs/heads/ui\n'
    expect(parseWorktrees(porcelain)).toEqual(['Z:/repo', 'Z:/repo-ui'])
  })
})

describe('GitStates', () => {
  it('counts a folder in the background, at most once per interval, and says when it changed', async () => {
    let time = 0
    const changes = vi.fn()
    const state: GitState = {
      root: 'repo',
      files: 1,
      newFiles: 0,
      added: 2,
      removed: 1,
      branch: 'main',
      ahead: 0,
      behind: 0,
      worktrees: [],
    }
    const count = vi.fn(async () => state)
    const states = new GitStates(changes, () => time, count)
    expect(states.get('repo')).toBeNull() // first ask: counting starts
    await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(1))
    expect(states.get('repo')).toEqual(state)
    expect(count).toHaveBeenCalledTimes(1) // not due again yet
    time = 5000
    states.get('repo')
    await vi.waitFor(() => expect(count).toHaveBeenCalledTimes(2))
    expect(changes).toHaveBeenCalledTimes(1) // same count: nothing to show
    expect(states.get('')).toBeNull()
  })
})

describe('a real repository', () => {
  it('counts changes, commits to push, commits behind main and worktrees', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'threadlight-git-'))
    const extra = `${folder}-wt`
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', folder, ...args])
      git('init', '-q', '-b', 'main')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'Test')
      git('config', 'core.autocrlf', 'false')
      await writeFile(join(folder, 'a.txt'), 'one\ntwo\nthree\n')
      git('add', '.')
      git('commit', '-qm', 'first')
      expect(await countChanges(folder)).toMatchObject({ added: 0, removed: 0, files: 0 })

      // A feature branch with two commits of its own, while main moves on by one.
      git('checkout', '-qb', 'feature')
      for (const n of [1, 2]) {
        await writeFile(join(folder, `f${n}.txt`), `${n}\n`)
        git('add', '.')
        git('commit', '-qm', `feature ${n}`)
      }
      git('checkout', '-q', 'main')
      await writeFile(join(folder, 'm.txt'), 'main\n')
      git('add', '.')
      git('commit', '-qm', 'main moves on')
      git('checkout', '-q', 'feature')
      git('worktree', 'add', '-q', extra, 'main')
      await writeFile(join(folder, 'a.txt'), 'one\n2\nthree\nfour\n') // 2 added, 1 removed

      const state = await readGitState(folder)
      expect(state).toMatchObject({
        added: 2,
        removed: 1,
        files: 1,
        newFiles: 0,
        branch: 'feature',
        ahead: 2,
        behind: 1,
      })
      expect(state?.worktrees).toHaveLength(2)
    } finally {
      await rm(extra, { recursive: true, force: true })
      await rm(folder, { recursive: true, force: true })
    }
    expect(await readGitState(tmpdir())).toBeNull()
  }, 60_000)
})
