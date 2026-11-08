import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AgentResponse } from '../../shared/agent'
import { SpacesService } from './service'
import type { Settings } from '../../shared/settings'

export function registerSpaces(
  panel: BrowserWindow,
  service: SpacesService | null,
  issue: string,
  settings?: () => Settings,
) {
  const unavailable = () => ({ ok: false, reason: issue || 'Shared Spaces is unavailable.' })
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === panel.webContents && event.senderFrame === event.sender.mainFrame
  ipcMain.handle(
    IPC.spacesLiveStart,
    (event, id: unknown, sdp: unknown, spaceId: unknown, discussionId: unknown) =>
      trusted(event) && service && settings?.().voiceMode === 'gpt-live'
        ? service.startLive(id, sdp, spaceId, discussionId)
        : { ok: false, reason: 'Select GPT Live to start Brainstorm live audio.' },
  )
  ipcMain.on(IPC.spacesLiveStop, (event, id: unknown) => {
    if (trusted(event) && typeof id === 'string') void service?.stopLive(id)
  })
  panel.webContents.on('render-process-gone', () => void service?.stopLive())
  panel.webContents.on('did-start-loading', () => void service?.stopLive())
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
