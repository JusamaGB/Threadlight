import { expect, it } from 'vitest'
import { compactDiffText, stackedDiffHunks } from '../src/renderer/lib/stackedDiff'
import type { DiffLine } from '../src/shared/types'

it('keeps separated edits, blank lines and source numbering in their original hunks', () => {
  const lines: DiffLine[] = [
    { type: 'hunk', text: 'first edit' },
    { type: 'context', text: '    kept', oldLine: 10, newLine: 10 },
    { type: 'remove', text: '      before', oldLine: 11 },
    { type: 'remove', text: '', oldLine: 12 },
    { type: 'add', text: '      after', newLine: 11 },
    { type: 'context', text: '    between', oldLine: 13, newLine: 12 },
    { type: 'remove', text: '    second removal', oldLine: 14 },
    { type: 'add', text: '    second addition', newLine: 13 },
    { type: 'hunk', text: 'later edit' },
    { type: 'add', text: '\t\tnew file section', newLine: 100001 },
  ]
  lines.forEach(Object.freeze)
  Object.freeze(lines)
  const hunks = stackedDiffHunks(lines)
  expect(hunks.map((hunk) => hunk.heading)).toEqual(['first edit', 'later edit'])
  expect(hunks.map((hunk) => hunk.groups.map((group) => group.type))).toEqual([
    ['context', 'remove', 'add', 'context', 'remove', 'add'],
    ['add'],
  ])
  expect(hunks.flatMap((hunk) => hunk.groups.flatMap((group) => group.lines))).toEqual(
    lines.filter((line) => line.type !== 'hunk'),
  )
  expect(hunks[0].indent).toBe('    ')
  expect(hunks[1].indent).toBe('\t\t')
  expect(hunks[1].groups[0].lines[0].newLine).toBe(100001)
  expect(compactDiffText(lines[2].text, hunks[0].indent)).toBe('  before')
  expect(lines[2].text).toBe('      before')
})

it('preserves indentation-only edits and never confuses tabs with spaces', () => {
  const whitespaceEdit = stackedDiffHunks([
    { type: 'remove', text: '  code', oldLine: 1 },
    { type: 'add', text: '    code', newLine: 1 },
  ])[0]
  expect(whitespaceEdit.indent).toBe('  ')
  expect(compactDiffText(whitespaceEdit.groups[0].lines[0].text, whitespaceEdit.indent)).toBe(
    'code',
  )
  expect(compactDiffText(whitespaceEdit.groups[1].lines[0].text, whitespaceEdit.indent)).toBe(
    '  code',
  )
  expect(
    stackedDiffHunks([
      { type: 'remove', text: '\tcode', oldLine: 1 },
      { type: 'add', text: '  code', newLine: 1 },
    ])[0].indent,
  ).toBe('')
  expect(compactDiffText(' \tcode', '\t')).toBe(' \tcode')
})

it('handles whole-file and whitespace-only patches without requiring hunk headers', () => {
  expect(stackedDiffHunks([])).toEqual([])
  expect(stackedDiffHunks([{ type: 'hunk', text: 'no source lines' }])).toEqual([])
  const lines: DiffLine[] = [
    { type: 'remove', text: '\t', oldLine: 1 },
    { type: 'add', text: '  ', newLine: 1 },
  ]
  expect(stackedDiffHunks(lines)[0].indent).toBe('')
  expect(stackedDiffHunks(lines)[0].groups.flatMap((group) => group.lines)).toEqual(lines)
})
