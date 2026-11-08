import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { PinnedCodeStore } from '../src/main/pinnedCode'
import { replyFile, pinLabel, pinInfo } from '../src/shared/codeReference'

it('imports legacy snapshots once, retains per-entry identity, and checks content revisions after reload', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tl-pin-')), 'pins.json'),
    notify = vi.fn()
  const store = new PinnedCodeStore(path, notify)
  const legacy = { id: 'legacy', language: 'python', code: 'print(1)', title: 'Practice' }
  const init = { action: 'open', legacy: JSON.stringify([legacy]) }
  store.request(init)
  const file = { name: 'test.py', kind: 'reply', path: 'other/test.py' }
  for (const id of ['a', 'b'])
    store.request({
      action: 'add',
      file: { ...legacy, id, file: { ...file, path: id + '/test.py' } },
    })
  store.request({ action: 'fold', id: 'a', collapsed: true })
  expect(store.request({ action: 'select', id: 'b' }).selectedId).toBe('b')
  expect(store.replace('a', 1, 'updated').outcome).toBe('ok')
  expect(store.replace('a', 1, 'stale').outcome).toBe('conflict')
  expect(store.read('a', 0, 1).outcome).toBe('conflict')
  expect(store.read('a', 0, 2).data).toMatchObject({
    file: { path: 'a/test.py' },
    collapsed: true,
    code: 'updated',
  })
  expect(store.read('b', 0).data).toMatchObject({ code: 'print(1)', revision: 1 })
  expect(pinLabel(legacy)).toBe('Snippet · print(1)')
  expect(pinInfo(legacy)).toContain('Unnamed code snippet')
  expect(store.request({ action: 'remove', id: 'legacy' }).files).toHaveLength(2)
  expect(new PinnedCodeStore(path, vi.fn()).request(init).files.map((f) => f.id)).toEqual([
    'a',
    'b',
  ])
  expect(notify).toHaveBeenCalled()
})
it('retains independent immutable version lists including migrated versions and rejects stale writes', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tl-versions-')), 'pins.json')
  const store = new PinnedCodeStore(path, vi.fn())
  const a = { id: 'a', language: 'text', code: 'first', revision: 4 },
    b = { ...a, id: 'b', code: 'unrelated' }
  store.request({ action: 'open', legacy: JSON.stringify([a, b]) })
  expect(store.replace('a', 4, ' plus', 'append').data?.revision).toBe(5)
  store.request({ action: 'browse', id: 'a', revision: 4 })
  expect(store.replace('a', 5, 'third').outcome).toBe('ok')
  expect(store.replace('a', 4, 'stale').outcome).toBe('conflict')
  expect(store.replace('b', 4, 'new').outcome).toBe('ok')
  const reopened = new PinnedCodeStore(path, vi.fn())
  expect(reopened.read('a', 0).data).toMatchObject({
    revision: 4,
    latestRevision: 6,
    viewedRevision: 4,
    versions: [4, 5, 6],
    code: 'first',
  })
  expect(reopened.read('a', 0, 6, 5).data?.code).toBe('first plus')
  expect(reopened.read('a', 0, 6, 6).data?.code).toBe('third')
  expect(reopened.read('a', 0, 6, 1).outcome).toBe('not_found')
  expect(reopened.read('b', 0).data?.code).toBe('new')
  expect(JSON.stringify(reopened.list(0, 10))).not.toContain('first plus')
  for (let latest = 6; latest < 53; latest++)
    expect(reopened.replace('a', latest, String(latest)).outcome).toBe('ok')
  expect(reopened.replace('a', 53, 'lost').outcome).toBe('unavailable')
  expect(reopened.read('a', 0, 53, 4).data?.code).toBe('first')
})
it('preserves invalid legacy data and unreadable persisted content', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tl-pin-')), 'pins.json'),
    store = new PinnedCodeStore(path, vi.fn())
  expect(() => store.request({ action: 'open', legacy: '[{' })).toThrow()
  writeFileSync(path, 'broken')
  expect(() => store.request({ action: 'open' })).toThrow()
  expect(readFileSync(path, 'utf8')).toBe('broken')
})
it('uses explicitly named fences, without interpreting a prose title or a path as a filename', () => {
  expect(replyFile('filename="C:/a b/main.py"')).toEqual({
    name: 'main.py',
    path: 'C:/a b/main.py',
    kind: 'reply',
  })
  expect(replyFile('title="sample.py"')).toBeUndefined()
  expect(replyFile('title="example filename=fake.py here"')).toBeUndefined()
  expect(replyFile('/a/b/main.py')).toBeUndefined()
})
