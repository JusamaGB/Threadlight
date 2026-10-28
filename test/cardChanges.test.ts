import { expect, it } from 'vitest'
import { cardDiffLines } from '../src/shared/cardChanges'
import type { TimelineFileChange } from '../src/shared/threadTimeline'

const file = (diff?: string, extra: Partial<TimelineFileChange> = {}): TimelineFileChange => ({
  path: 'src/shared.ts',
  added: 1,
  removed: 1,
  diff,
  ...extra,
})

it('draws only the selected recorded edit, even when another card changes the same file', () => {
  const first = file('@@ -10,2 +10,2 @@\n unchanged\n-before\n+first edit\n')
  const next = file('@@ -11 +11 @@\n-first edit\n+later edit\n')
  expect(cardDiffLines(first)).toEqual([
    { type: 'hunk', text: '' },
    { type: 'context', text: 'unchanged', oldLine: 10, newLine: 10 },
    { type: 'remove', text: 'before', oldLine: 11 },
    { type: 'add', text: 'first edit', newLine: 11 },
  ])
  expect(
    cardDiffLines(next)
      ?.filter((line) => line.type === 'add')
      .map((line) => line.text),
  ).toEqual(['later edit'])
  expect(cardDiffLines(first)?.some((line) => line.text === 'later edit')).toBe(false)
})

it('supports native whole-file additions and deletions with their original line numbers', () => {
  expect(cardDiffLines(file('one\r\ntwo\r\n', { added: 2, removed: 0 }))).toEqual([
    { type: 'add', text: 'one', newLine: 1 },
    { type: 'add', text: 'two', newLine: 2 },
  ])
  expect(cardDiffLines(file('gone\n', { added: 0, removed: 1 }))).toEqual([
    { type: 'remove', text: 'gone', oldLine: 1 },
  ])
})

it('distinguishes unavailable, empty and binary event evidence without consulting current files', () => {
  expect(cardDiffLines(file())).toBeNull()
  expect(cardDiffLines(file(''))).toEqual([])
  expect(cardDiffLines(file('binary\0data'))).toBeNull()
  expect(cardDiffLines(file('unrecognised patch', { added: null, removed: null }))).toBeNull()
})
