import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { Session } from '../shared/types'
import type { TimelineRequest } from '../shared/threadTimeline'
import { isObject } from './sessions/json'
import { sessionProvider } from '../shared/providers'
import type { ClaudePaths, CodexPaths } from './sessions/paths'
import { CodexReadAdapter } from './threadRead/codex'
import { ClaudeReadAdapter } from './threadRead/claude'
import { followCodexThread } from './codex/threadStream'
import { ThreadTimelineService } from './threadTimeline'
import { readTimelineImage } from './threadTimelineImage'

export function registerThreadTimeline(
  panel: BrowserWindow,
  paths: { claude: ClaudePaths; codex: CodexPaths },
  find: (id: string) => Session | null | undefined,
  transcript: (id: string) => string | null | undefined,
  inspectImage: (threadId: string, path: string) => Promise<string>,
): () => void {
  const adapters = {
    claude: new ClaudeReadAdapter(paths.claude),
    codex: new CodexReadAdapter(paths.codex),
  }
  const service = new ThreadTimelineService({
    allowed: (id) => !!find(id),
    read: async (id, cursor) => {
      const session = find(id)
      if (!session) throw Error('Thread unavailable')
      const provider = sessionProvider(id)
      return adapters[provider].read(
        {
          provider,
          nativeId: id.replace(/^codex:/, ''),
          title: session.title,
          titleSource: 'explicit',
          workspace: session.cwd,
          archived: 'unknown',
          lastActiveAt: session.lastActiveAt,
          locator: transcript(id) ?? undefined,
        },
        cursor,
      )
    },
    follow: followCodexThread,
    changed: (value) => {
      if (!panel.isDestroyed()) panel.webContents.send(IPC.threadTimelineChanged, value)
    },
  })
  ipcMain.handle(IPC.threadTimeline, (event, input: unknown) => {
    if (
      event.sender !== panel.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !isObject(input) ||
      typeof input.threadId !== 'string' ||
      !/^(codex:)?[\da-f-]{36}$/i.test(input.threadId) ||
      typeof input.subscriptionId !== 'string' ||
      !/^[\w-]{1,80}$/.test(input.subscriptionId) ||
      !['open', 'close', 'older'].includes(String(input.action))
    )
      return { ok: false, reason: 'Invalid thread view request.' }
    return service.request(input as TimelineRequest)
  })
  ipcMain.handle(IPC.threadImage, async (event, input: unknown) => {
    if (
      event.sender !== panel.webContents ||
      event.senderFrame !== panel.webContents.mainFrame ||
      !isObject(input) ||
      typeof input.threadId !== 'string' ||
      typeof input.itemId !== 'string' ||
      input.threadId.length > 100 ||
      input.itemId.length > 300 ||
      (input.action !== undefined && input.action !== 'inspect')
    )
      return { ok: false, reason: 'Invalid image request.' }
    const path = service.imagePath(input.threadId, input.itemId)
    if (!path) return { ok: false, reason: 'Image no longer available in this thread.' }
    const result = await readTimelineImage(path)
    if (service.imagePath(input.threadId, input.itemId) !== path)
      return { ok: false, reason: 'Thread view closed.' }
    if (result.ok && input.action === 'inspect') {
      try {
        return { ...result, artifactId: await inspectImage(input.threadId, path) }
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : 'Could not inspect this image.',
        }
      }
    }
    return result
  })
  const clear = () => service.close()
  panel.webContents.on('render-process-gone', clear)
  panel.webContents.on('did-start-loading', clear)
  panel.once('closed', clear)
  return () => {
    clear()
    ipcMain.removeHandler(IPC.threadTimeline)
    ipcMain.removeHandler(IPC.threadImage)
  }
}
