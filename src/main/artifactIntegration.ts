import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { realpath } from 'node:fs/promises'
import { IPC } from '../shared/ipc'
import { ArtifactStore, artifactContent, readArtifactBytes } from './artifacts'
import { registerArtifactPreview } from './artifactPreview'
import type { ThreadArtifact } from '../shared/artifacts'
import {
  ArtifactDiscovery,
  localArtifactPath,
  referenceAllowed,
  type ArtifactSource,
} from './artifactReferences'

export function registerArtifacts(
  panel: BrowserWindow,
  directory: string,
  hasThread: (id: string) => boolean,
  sourceFor?: (id: string) => ArtifactSource | null,
): void {
  const store = new ArtifactStore(directory)
  const discovery = new ArtifactDiscovery()
  const catalog = async (threadId: string) => {
    const saved = store.list(threadId)
    const source = sourceFor?.(threadId)
    // A temporary transcript outage must not replace the last catalog with an empty list.
    let found: Awaited<ReturnType<ArtifactDiscovery['scan']>> = {
      items: discovery.lastKnown(threadId),
    }
    try {
      if (source) found = await discovery.scan(threadId, source)
      else if (sourceFor) found.notice = 'The provider transcript is not available yet.'
    } catch {
      found.notice =
        'The provider transcript could not be read. Saved and manually linked files remain available.'
    }
    const byId = new Map(saved.map((item) => [item.id, item]))
    for (const item of found.items) if (!byId.has(item.id)) byId.set(item.id, item)
    return { items: [...byId.values()], notice: found.notice, source, saved }
  }
  const read = async (
    threadId: string,
    item: ThreadArtifact,
    list: Awaited<ReturnType<typeof catalog>>,
  ) => {
    if (item.source !== 'reference') return store.read(threadId, item.id)
    if (!item.path) throw new Error('The original file location is unavailable.')
    const manual = list.saved.some((saved) => saved.id === item.id && saved.source === 'reference')
    if (!manual && (!list.source || !(await referenceAllowed(item.path, list.source.roots))))
      throw new Error('The original file is outside this thread’s allowed locations.')
    if (item.kind === 'unsupported')
      throw new Error('This file format is not supported by the viewer yet.')
    try {
      const original = await realpath(item.path)
      if (!localArtifactPath(original, process.cwd()))
        throw new Error('The original file is no longer a supported local file.')
      if (!manual && (!list.source || !(await referenceAllowed(original, list.source.roots))))
        throw new Error('The original file is outside this thread’s allowed locations.')
      return artifactContent(await readArtifactBytes(original), item.path).content
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('The original file has moved or been deleted.', { cause: error })
      throw error
    }
  }
  registerArtifactPreview(panel, async (threadId, id) => {
    if (!hasThread(threadId)) throw new Error('Thread unavailable.')
    const list = await catalog(threadId)
    const item = list.items.find((item) => item.id === id)
    if (!item || item.kind !== 'html') throw new Error('HTML artifact not found in this thread.')
    return read(threadId, item, list)
  })
  ipcMain.handle(IPC.artifacts, async (event, threadId: unknown, action: unknown, id: unknown) => {
    if (
      event.sender !== panel.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof threadId !== 'string' ||
      !hasThread(threadId)
    )
      return { ok: false, reason: 'Thread unavailable.' }
    try {
      let list = await catalog(threadId)
      if (action === 'list') return { ok: true, items: list.items, notice: list.notice }
      if ((action === 'read' || action === 'copy') && typeof id === 'string') {
        const item = list.items.find((item) => item.id === id)
        if (!item) throw new Error('Artifact not found in this thread.')
        if (action === 'read')
          return {
            ok: true,
            items: list.items,
            content: await read(threadId, item, list),
            notice: list.notice,
          }
        if (item.source !== 'reference') {
          throw new Error('This artifact is already a saved copy.')
        }
        const content = await read(threadId, item, list)
        const data =
          item.kind === 'image'
            ? Buffer.from(content.slice(content.indexOf(',') + 1), 'base64')
            : Buffer.from(content, 'utf8')
        store.import(threadId, item.title, data)
      } else if (action === 'link') {
        const selection = await dialog.showOpenDialog(panel, {
          title: 'Link an original file to this thread',
          properties: ['openFile'],
          filters: [
            {
              name: 'Artifacts',
              extensions: [
                'png',
                'jpg',
                'jpeg',
                'webp',
                'html',
                'htm',
                'txt',
                'md',
                'pdf',
                'csv',
                'json',
                'docx',
                'xlsx',
                'pptx',
                'mp4',
              ],
            },
          ],
        })
        const selected = selection.filePaths[0]
        if (!selection.canceled && selected) {
          const local = localArtifactPath(selected, process.cwd())
          if (!local) throw new Error('Choose a supported local file.')
          const path = await realpath(local)
          if (!localArtifactPath(path, process.cwd()))
            throw new Error('Choose a local file, not a remote or device path.')
          store.link(threadId, path)
        }
      } else throw new Error('Unknown artifact action.')
      list = await catalog(threadId)
      if (!panel.isDestroyed())
        panel.webContents.send(IPC.artifactsChanged, { threadId, items: list.items })
      return { ok: true, items: list.items, notice: list.notice }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Could not load artifact.',
      }
    }
  })
}
