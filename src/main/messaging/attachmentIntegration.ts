import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { isObject } from '../sessions/json'
import { ComposerAttachmentStore } from './attachments'
import type { ComposerFileInput } from '../../shared/composerAttachments'

export function registerComposerAttachments(
  panel: BrowserWindow,
  store: ComposerAttachmentStore,
  allowed: (id: string) => boolean,
) {
  ipcMain.handle(IPC.composerAttachments, async (event, input: unknown) => {
    if (
      event.sender !== panel.webContents ||
      event.senderFrame !== panel.webContents.mainFrame ||
      !isObject(input) ||
      typeof input.threadId !== 'string' ||
      !allowed(input.threadId)
    )
      return { ok: false, reason: 'That Codex chat is unavailable.' }
    try {
      const id = input.threadId
      if (input.action === 'pick') {
        const chosen = await dialog.showOpenDialog(panel, {
          properties: ['openFile', 'multiSelections'],
        })
        for (const path of chosen.filePaths) {
          if (!allowed(id)) throw Error('That Codex chat is unavailable.')
          await store.add(id, { path, name: path.split(/[\\/]/).at(-1)! })
        }
      } else if (input.action === 'add') {
        if (
          !isObject(input.file) ||
          typeof input.file.name !== 'string' ||
          input.file.name.length > 1000 ||
          (input.file.path !== undefined &&
            (typeof input.file.path !== 'string' || input.file.path.length > 32000)) ||
          (input.file.bytes !== undefined && !(input.file.bytes instanceof Uint8Array))
        )
          throw Error('Invalid attachment.')
        await store.add(id, input.file as ComposerFileInput)
      } else if (input.action === 'remove') {
        if (typeof input.id !== 'string') throw Error('Invalid attachment.')
        await store.remove(id, [input.id])
      } else if (input.action !== 'list') throw Error('Invalid attachment action.')
      return { ok: true, items: await store.list(id) }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Could not attach this file.',
      }
    }
  })
}
