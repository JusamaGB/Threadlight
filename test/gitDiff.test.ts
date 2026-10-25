import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { countChanges, GitDiffs, parseNumstat } from '../src/main/sessions/gitDiff'

describe('parseNumstat', () => {
  it('adds up every file, skipping binary ones', () => {
    expect(parseNumstat('3\t1\ta.ts\x0020\t0\tb.ts\x00-\t-\timage.png\x00')).toEqual({
      added: 23,
      removed: 1,
    })
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('GitDiffs', () => {
  it('counts a folder in the background, at most once per interval, and says when it changed', async () => {
    let time = 0
    const changes = vi.fn()
    const count = vi.fn(async () => ({ added: 2, removed: 1 }))
    const diffs = new GitDiffs(changes, () => time, count)
    expect(diffs.get('repo')).toBeNull() // first ask: counting starts
    await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(1))
    expect(diffs.get('repo')).toEqual({ added: 2, removed: 1 })
    expect(count).toHaveBeenCalledTimes(1) // not due again yet
    time = 5000
    diffs.get('repo')
    await vi.waitFor(() => expect(count).toHaveBeenCalledTimes(2))
    expect(changes).toHaveBeenCalledTimes(1) // same count: nothing to show
    expect(diffs.get('')).toBeNull()
  })
})

describe('countChanges', () => {
  it('counts changed and new lines against the last commit, and nothing outside git', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'threadlight-diff-'))
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', folder, ...args])
      git('init', '-q')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'Test')
      git('config', 'core.autocrlf', 'false')
      await writeFile(join(folder, 'a.txt'), 'one\ntwo\nthree\n')
      git('add', '.')
      git('commit', '-qm', 'first')
      expect(await countChanges(folder)).toEqual({ added: 0, removed: 0 })

      await writeFile(join(folder, 'a.txt'), 'one\n2\nthree\nfour\n') // 2 added, 1 removed
      await writeFile(join(folder, 'new.txt'), 'x\ny\n') // untracked: 2 added
      expect(await countChanges(folder)).toEqual({ added: 4, removed: 1 })

      git('add', '.')
      git('commit', '-qm', 'second')
      expect(await countChanges(folder)).toEqual({ added: 0, removed: 0 }) // resets on commit
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
    expect(await countChanges(tmpdir())).toBeNull()
  }, 30_000)
})
