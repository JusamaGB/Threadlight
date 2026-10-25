import { basename, join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { backup } from 'node:sqlite'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { MEMORY_ATTACHMENT_LIMIT, type MemoryReply } from '../../shared/memory'
import { MemoryStore, MemoryError } from './store'
import { MemoryServer } from './server'
import { MemoryDispatcher, type MemoryDelivery } from './dispatcher'

import { attachmentMime } from './attachments'
import { exportDestination } from './backup'

export async function startMemory(
  directory: string,
  panel: BrowserWindow,
  delivery: MemoryDelivery,
) {
  let store: MemoryStore | null = null
  let server: MemoryServer | null = null
  let issue = ''
  try {
    store = new MemoryStore(join(directory, 'shared-memory', 'memory.sqlite'))
    server = new MemoryServer(store)
    await server.start()
  } catch (error) {
    issue = error instanceof Error ? error.message : 'Shared memory is unavailable.'
  }
  const snapshot = () => {
    if (!store) throw new Error(issue)
    return { ...store.snapshot(), endpoint: server?.endpoint ?? null }
  }
  if (store)
    store.onChange = () => {
      if (!panel.isDestroyed()) panel.webContents.send(IPC.memoryChanged, snapshot())
    }
  const safely = async (fn: () => unknown | Promise<unknown>): Promise<MemoryReply> => {
    try {
      const value = await fn()
      return { ok: true, value, snapshot: snapshot() }
    } catch (error) {
      return {
        ok: false,
        code: error instanceof MemoryError ? error.code : 'memory_error',
        reason: error instanceof Error ? error.message : 'Shared memory operation failed.',
      }
    }
  }
  const ours = (sender: Electron.WebContents) => {
    if (sender !== panel.webContents)
      throw new MemoryError('permission_denied', 'This action belongs to the Threadlight panel.')
    if (!store) throw new Error(issue)
    return store
  }
  ipcMain.handle(IPC.memoryRequest, (event, input: unknown) =>
    safely(() => ours(event.sender).execute(input)),
  )
  ipcMain.handle(IPC.memoryImport, (event, folderId: unknown) =>
    safely(async () => {
      const memory = ours(event.sender)
      if (typeof folderId !== 'string') throw new Error('Choose a destination folder.')
      const choice = await dialog.showOpenDialog(panel, {
        title: 'Add to shared memory',
        properties: ['openFile'],
        filters: [
          {
            name: 'Documents and images',
            extensions: ['txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'pdf'],
          },
        ],
      })
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true }
      const file = choice.filePaths[0]
      const info = await stat(file)
      if (!info.isFile() || info.size > MEMORY_ATTACHMENT_LIMIT)
        throw new Error('Choose a file no larger than 10 MiB.')
      const data = await readFile(file)
      return memory.importAttachment(folderId, basename(file), attachmentMime(data, file), data)
    }),
  )
  ipcMain.handle(IPC.memoryExport, (event) =>
    safely(async () => {
      const memory = ours(event.sender)
      const choice = await dialog.showSaveDialog(panel, {
        title: 'Export shared memory backup',
        defaultPath: 'threadlight-memory.sqlite',
        filters: [{ name: 'SQLite backup', extensions: ['sqlite'] }],
      })
      if (choice.canceled || !choice.filePath) return { cancelled: true }
      await backup(memory.databaseForBackup(), await exportDestination(choice.filePath, directory))
      return { exported: true }
    }),
  )
  ipcMain.handle(IPC.memoryRestore, (event) =>
    safely(async () => {
      const memory = ours(event.sender)
      const choice = await dialog.showOpenDialog(panel, {
        title: 'Restore shared memory',
        properties: ['openFile'],
        filters: [{ name: 'Threadlight SQLite backup', extensions: ['sqlite'] }],
      })
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true }
      const confirmation = await dialog.showMessageBox(panel, {
        type: 'warning',
        message: 'Replace shared memory with this backup?',
        detail:
          'A recovery backup will be saved first. Agent capabilities will be revoked and coordination paused. Native chats are unaffected.',
        buttons: ['Cancel', 'Restore'],
        defaultId: 0,
        cancelId: 0,
      })
      if (confirmation.response !== 1) return { cancelled: true }
      await backup(
        memory.databaseForBackup(),
        join(directory, 'shared-memory', 'before-restore-' + Date.now() + '.sqlite'),
      )
      return memory.restoreFrom(choice.filePaths[0])
    }),
  )
  const dispatcher = store
    ? new MemoryDispatcher(store, delivery, () => server?.endpoint ?? null)
    : null
  const timer = setInterval(() => {
    try {
      dispatcher?.tick()
    } catch (error) {
      console.error(
        'Shared-memory dispatcher:',
        error instanceof Error ? error.message : 'unavailable',
      )
    }
  }, 1500)
  return () => {
    clearInterval(timer)
    dispatcher?.close()
    server?.close()
    store?.close()
  }
}
