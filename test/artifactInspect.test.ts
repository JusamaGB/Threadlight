import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
const ipc = vi.hoisted(() => ({ handle: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: ipc, dialog: { showOpenDialog: vi.fn() } }))
vi.mock('../src/main/artifactPreview', () => ({ registerArtifactPreview: vi.fn() }))
import { registerArtifacts } from '../src/main/artifactIntegration'
import { IPC } from '../src/shared/ipc'
const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
it('links a selected tool image once and makes its exact artifact readable in the same thread', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-inspect-'))
  roots.push(root)
  const image = join(root, 'selected.png')
  const data =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='
  await writeFile(image, Buffer.from(data, 'base64'))
  const panel = { isDestroyed: () => false, webContents: { mainFrame: {}, send: vi.fn() } }
  const inspect = registerArtifacts(
    panel as unknown as BrowserWindow,
    join(root, 'artifacts'),
    (id) => id === 'thread',
  )
  const id = await inspect('thread', image)
  expect(await inspect('thread', image)).toBe(id)
  const handler = ipc.handle.mock.calls.find(([channel]) => channel === IPC.artifacts)![1]
  const event = { sender: panel.webContents, senderFrame: panel.webContents.mainFrame }
  const list = await handler(event, 'thread', 'list')
  expect(list.items).toHaveLength(1)
  expect(list.items[0]).toMatchObject({
    id,
    title: 'selected.png',
    kind: 'image',
    source: 'reference',
  })
  const read = await handler(event, 'thread', 'read', id)
  expect(read.content).toBe('data:image/png;base64,' + data)
  expect((await handler(event, 'other', 'read', id)).ok).toBe(false)
  await expect(inspect('other', image)).rejects.toThrow('Thread unavailable')
  await expect(inspect('thread', join(root, 'missing.png'))).rejects.toThrow()
  expect((await handler(event, 'thread', 'list')).items).toHaveLength(1)
})
