import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  inside,
  listChanges,
  parseUnifiedDiff,
  readFileDiff,
} from '../src/main/sessions/gitChanges'

describe('parseUnifiedDiff', () => {
  it('turns hunks into numbered context, removed and added lines', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,3 @@ heading',
      ' one',
      '-two',
      '+2',
      ' three',
      String.raw`\ No newline at end of file`,
      '',
    ].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([
      { type: 'hunk', text: 'heading' },
      { type: 'context', text: 'one', oldLine: 1, newLine: 1 },
      { type: 'remove', text: 'two', oldLine: 2 },
      { type: 'add', text: '2', newLine: 2 },
      { type: 'context', text: 'three', oldLine: 3, newLine: 3 },
    ])
  })
})

describe('inside', () => {
  it('keeps paths inside the repository', () => {
    expect(inside('Z:/repo', 'src/a.ts')).toBe(true)
    expect(inside('Z:/repo', '../other/secret.txt')).toBe(false)
    expect(inside('Z:/repo', 'C:/Windows/win.ini')).toBe(false)
    expect(inside('Z:/repo', '')).toBe(false)
  })
})

describe('a real repository', () => {
  it('lists changed, new and deleted files, and draws one file’s diff', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'threadlight-changes-'))
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', folder, ...args])
      git('init', '-q', '-b', 'main')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'Test')
      git('config', 'core.autocrlf', 'false')
      await writeFile(join(folder, 'a.txt'), 'one\ntwo\nthree\n')
      await writeFile(join(folder, 'gone.txt'), 'bye\n')
      git('add', '.')
      git('commit', '-qm', 'first')
      await writeFile(join(folder, 'a.txt'), 'one\n2\nthree\n')
      await writeFile(join(folder, 'new.txt'), 'x\ny\n')
      git('rm', '-q', 'gone.txt')

      expect(await listChanges(folder)).toEqual([
        { path: 'a.txt', status: 'modified', added: 1, removed: 1, binary: false },
        { path: 'gone.txt', status: 'deleted', added: 0, removed: 1, binary: false },
        { path: 'new.txt', status: 'added', added: 2, removed: 0, binary: false },
      ])
      const modified = await readFileDiff(folder, 'a.txt')
      expect(modified.kind === 'text' && modified.lines.map((l) => l.type)).toEqual([
        'hunk',
        'context',
        'remove',
        'add',
        'context',
      ])
      expect(await readFileDiff(folder, 'new.txt')).toEqual({
        kind: 'text',
        lines: [
          { type: 'add', text: 'x', newLine: 1 },
          { type: 'add', text: 'y', newLine: 2 },
        ],
      })
      expect(await readFileDiff(folder, '../outside.txt')).toEqual({ kind: 'unavailable' })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 60_000)
})
