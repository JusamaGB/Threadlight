import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, open } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ComposerAttachmentStore } from '../src/main/messaging/attachments'
import { COMPOSER_FILE_LIMIT } from '../src/shared/composerAttachments'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
it('copies documents and pasted images, preserves drafts across restart, and isolates thread IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-attach-'))
  roots.push(root)
  const store = new ComposerAttachmentStore(join(root, 'attachments'))
  const file = join(root, 'report.pdf')
  await writeFile(file, '%PDF-synthetic')
  await store.add('codex:a', { name: 'report.pdf', path: file })
  await store.add('codex:a', { name: 'image.png', bytes: new Uint8Array([137, 80, 78, 71]) })
  const items = await store.list('codex:a')
  expect(items.map((item) => item.kind)).toEqual(['file', 'image'])
  expect(items.some((item) => 'path' in item)).toBe(false)
  await writeFile(file, 'changed original')
  const attached = await store.resolve(
    'codex:a',
    items.map((item) => item.id),
  )
  expect(await readFile(attached[0]!.path, 'utf8')).toBe('%PDF-synthetic')
  const restarted = new ComposerAttachmentStore(join(root, 'attachments'))
  expect(await restarted.list('codex:a')).toEqual(items)
  await expect(store.resolve('codex:b', [items[0]!.id])).rejects.toThrow('no longer available')
  await expect(store.resolve('codex:a', [items[0]!.id, items[0]!.id])).rejects.toThrow(
    'no longer available',
  )
  await store.remove('codex:a', [items[0]!.id])
  expect((await store.list('codex:a')).map((item) => item.id)).toEqual([items[1]!.id])
  // Accepted attachments remain readable by the native history after leaving the draft.
  expect(await readFile(attached[0]!.path, 'utf8')).toBe('%PDF-synthetic')
})
it('rejects folders and oversized files without adding them to the draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-attach-'))
  roots.push(root)
  const store = new ComposerAttachmentStore(join(root, 'attachments'))
  await expect(store.add('codex:a', { name: 'folder', path: root })).rejects.toThrow('Only files')
  const file = join(root, 'large.pdf')
  const handle = await open(file, 'w')
  await handle.truncate(COMPOSER_FILE_LIMIT + 1)
  await handle.close()
  await expect(store.add('codex:a', { name: 'large.pdf', path: file })).rejects.toThrow('512 MiB')
  expect(await store.list('codex:a')).toEqual([])
})
