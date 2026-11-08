import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ChatDelivery } from './delivery'
import { IPC } from '../../shared/ipc'
import type { ChatSource } from '../../shared/accountChats'
import { AccountChats } from './service'
import { ChatGPTReader, PerplexityChatReader } from './adapters'

export function registerAccountChats(
  panel: BrowserWindow,
  contexts: () => Promise<{ id: string; title: string }[]>,
  enabled: (source: ChatSource) => boolean,
) {
  const service = new AccountChats({
    contexts,
    enabled,
    onSharedDelivery: (status) => {
      if (!panel.isDestroyed() && !panel.webContents.isDestroyed())
        panel.webContents.send(IPC.sharedDeliveryStatus, status)
    },
    delivery: new ChatDelivery(join(app.getPath('userData'), 'account-chat-delivery.json')),
    connect: (source, callerId) =>
      source === 'chatgpt' ? ChatGPTReader.connect(callerId!) : PerplexityChatReader.connect(),
  })
  ipcMain.handle(IPC.accountChats, (event, input: unknown) => {
    if (event.sender !== panel.webContents || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, reason: 'Chat access is only available in the main panel.' }
    return service.request(input)
  })
  return service
}
