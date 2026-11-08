import { execFileSync } from 'node:child_process'
import { linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ignoreSpaceFolder } from '../src/main/spaces/gitignore'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox
beforeEach(async () => {
  box = await sandbox()
})
afterEach(() => box.cleanup())

it('Git ignores only the chosen directory from a nested workspace, even after earlier negation rules', () => {
  execFileSync('git', ['init', '--quiet', box.root])
  const workspace = join(box.root, 'nested'),
    file = join(workspace, '.gitignore')
  mkdirSync(workspace)
  const original = Buffer.from(
    '\uFEFF# Existing\r\n/shared-spaces/private/\r\n!/shared-spaces/private/\r\n',
  )
  writeFileSync(file, original)
  ignoreSpaceFolder(workspace, 'private')
  const bytes = readFileSync(file)
  expect(bytes.subarray(0, original.length)).toEqual(original)
  ignoreSpaceFolder(workspace, 'private')
  expect(readFileSync(file)).toEqual(bytes)
  const ignored = execFileSync('git', ['-C', box.root, 'check-ignore', '--stdin'], {
    input:
      'nested/shared-spaces/private/notes/idea.md\nnested/shared-spaces/public/notes/idea.md\nshared-spaces/private/notes/idea.md\n',
    encoding: 'utf8',
  })
  expect(ignored.trim()).toBe('nested/shared-spaces/private/notes/idea.md')
})

it('creates a missing ignore file without needing a Git repository', () => {
  ignoreSpaceFolder(box.root, 'new-space')
  expect(readFileSync(join(box.root, '.gitignore'), 'utf8')).toBe('/shared-spaces/new-space/\n')
})

it('preserves non-UTF8 and linked files and rejects path injection', () => {
  const file = join(box.root, '.gitignore'),
    original = Buffer.from('\uFEFF# utf16', 'utf16le')
  writeFileSync(file, original)
  expect(() => ignoreSpaceFolder(box.root, 'notes')).toThrow('UTF-8')
  expect(readFileSync(file)).toEqual(original)
  linkSync(file, join(box.root, 'linked-copy'))
  expect(() => ignoreSpaceFolder(box.root, 'notes')).toThrow('unlinked')
  expect(readFileSync(file)).toEqual(original)
  expect(() => ignoreSpaceFolder(box.root, '../outside')).toThrow('Invalid')
})
