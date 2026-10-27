import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AgentResponse } from '../../shared/agent'
import { SpacesService } from './service'

export function registerSpaces(panel: BrowserWindow, service: SpacesService | null, issue: string) {
  const unavailable = () => ({ ok: false, reason: issue || 'Shared Spaces is unavailable.' })
  ipcMain.handle(IPC.spacesRequest, (event, input: unknown) =>
    event.sender === panel.webContents && event.senderFrame === event.sender.mainFrame && service
      ? service.request(input)
      : unavailable(),
  )
  ipcMain.handle(
    IPC.spacesRespond,
    (event, ideaId: unknown, requestId: unknown, response: AgentResponse) =>
      event.sender === panel.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      service &&
      typeof ideaId === 'string' &&
      typeof requestId === 'string'
        ? service.respond(ideaId, requestId, response)
        : unavailable(),
  )
}
