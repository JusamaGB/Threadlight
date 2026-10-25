import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC, type PanelOpened, type TalkState, type ThreadlightApi } from '../shared/ipc'
import type { SttStatus } from '../shared/stt'
import type { RelayStatus, Session } from '../shared/types'

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

  sendMessage: (sessionId, text) => ipcRenderer.invoke(IPC.sendMessage, sessionId, text),
  getRelays: () => ipcRenderer.invoke(IPC.getRelays),
  onRelays: (listener) => subscribe<RelayStatus[]>(IPC.relaysChanged, listener),

  getStt: () => ipcRenderer.invoke(IPC.getStt),
  onStt: (listener) => subscribe<SttStatus>(IPC.sttChanged, listener),
  downloadStt: () => ipcRenderer.send(IPC.sttDownload),
  transcribe: (audio) => ipcRenderer.invoke(IPC.transcribe, audio),

  onTalkToggle: (listener) => subscribe<void>(IPC.talkToggle, listener),
  setTalkState: (state) => ipcRenderer.send(IPC.talkState, state),
  onTalkState: (listener) => subscribe<TalkState>(IPC.talkState, listener),
  openPanelQuietly: () => ipcRenderer.send(IPC.openPanelQuietly),
  onHotkeyProblem: (listener) => subscribe<string | null>(IPC.hotkeyProblem, listener),
}

contextBridge.exposeInMainWorld('threadlight', api)
