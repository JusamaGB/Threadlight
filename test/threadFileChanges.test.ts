import { expect, it } from 'vitest'
import { projectFileChanges } from '../src/main/codex/threadFileChanges'
import { projectStream } from '../src/main/codex/threadStreamState'
import { conversationRows } from '../src/shared/threadActivity'
const change = (path: string, diff?: string, type = 'update') => ({ path, diff, kind: { type } })
it('counts each native edit without counting unified diff headers as content', () => {
  const result = projectFileChanges([
    change('a.ts', '--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,0 @@\n-one\n-two\n-three\n'),
    change('b.ts', '@@ -1,2 +1,1 @@\n-old\n-old2\n+new\n'),
  ])
  expect(result.files.map((f) => [f.added, f.removed])).toEqual([
    [0, 3],
    [1, 2],
  ])
  expect(result.count).toBe(2)
})
it('supports whole-file creation/deletion and distinguishes unavailable counts from zero', () => {
  const result = projectFileChanges([
    change('new', 'one\ntwo\n', 'add'),
    change('gone', 'old\n', 'delete'),
    change('renamed', ''),
    change('unknown'),
    change('binary', '\0'),
  ])
  expect(result.files.map((f) => [f.added, f.removed])).toEqual([
    [2, 0],
    [0, 1],
    [0, 0],
    [null, null],
    [null, null],
  ])
  expect(result.files[4]?.diff).toBeUndefined()
})
it('bounds preview payloads while counting the full diff', () => {
  const diff = '@@ -0,0 +1,20000 @@\n' + '+new\n'.repeat(20000)
  const result = projectFileChanges(Array.from({ length: 110 }, (_, i) => change(`${i}.ts`, diff)))
  expect(result.count).toBe(110)
  expect(result.files).toHaveLength(100)
  expect(result.files[0]).toMatchObject({ added: 20000, removed: 0, previewTruncated: true })
  expect(result.files.reduce((n, f) => n + (f.diff?.length ?? 0), 0)).toBeLessThanOrEqual(64000)
})
it('retains a separate visible card for each edit and updates the same native ID in place', () => {
  const first = {
    id: 'edit1',
    type: 'fileChange',
    status: 'completed',
    changes: [change('same.ts', '@@ -1 +1 @@\n-old\n+new\n')],
  }
  const second = {
    ...first,
    id: 'edit2',
    changes: [change('same.ts', '@@ -1 +1,2 @@\n-new\n+newer\n+extra\n')],
  }
  const items = projectStream({
    turns: [{ turnId: 'turn', status: 'completed', items: [first, second] }],
  })
  expect(conversationRows(items).map((r) => [r.type, r.id])).toEqual([
    ['message', 'edit1'],
    ['message', 'edit2'],
  ])
  expect(items.map((i) => i.fileChanges?.[0]?.added)).toEqual([1, 2])
  const failed = projectStream({
    turns: [{ turnId: 'turn', status: 'completed', items: [{ ...first, status: 'failed' }] }],
  })
  expect(failed[0]).toMatchObject({ text: 'Could not edit 1 file', failed: true })
})
