import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC, type PanelOpened, type ThreadlightApi } from '../shared/ipc'
import type { Session } from '../shared/types'

// The renderer has no Node access. This object is the only door between them,
// and each method maps to exactly one IPC channel.

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ThreadlightApi = {
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),
  getSessions: () => ipcRenderer.invoke(IPC.getSessions),
  onSessions: (listener) => subscribe<Session[]>(IPC.sessionsChanged, listener),
  onPanelOpened: (listener) => subscribe<PanelOpened>(IPC.panelOpened, listener),

  dotClick: () => ipcRenderer.send(IPC.dotClick),
  dotDrag: (dx, dy) => ipcRenderer.send(IPC.dotDrag, dx, dy),
  dotDragEnd: () => ipcRenderer.send(IPC.dotDragEnd),

  resizePanel: (height) => ipcRenderer.send(IPC.panelResize, height),
  closePanel: () => ipcRenderer.send(IPC.panelClose),
  openInClaude: (appId) => ipcRenderer.send(IPC.openInClaude, appId),
}

contextBridge.exposeInMainWorld('threadlight', api)
