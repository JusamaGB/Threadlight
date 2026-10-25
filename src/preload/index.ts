import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import type { AgentState } from '../shared/agent'
import type { LiveVoiceEvent } from '../shared/liveVoice'

import { IPC, type PanelOpened, type TalkState, type ThreadlightApi } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import type { SttStatus } from '../shared/stt'
import type { RelayStatus, Session, Snapshot } from '../shared/types'
import type { Usage } from '../shared/usage'

// The renderer has no Node access. This object is the only door between them,
// and each method maps to exactly one IPC channel.

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ThreadlightApi = {
  memoryRequest: (input) => ipcRenderer.invoke(IPC.memoryRequest, input),
  onMemory: (listener) => subscribe(IPC.memoryChanged, listener),
  memoryImport: (folderId) => ipcRenderer.invoke(IPC.memoryImport, folderId),
  memoryExport: () => ipcRenderer.invoke(IPC.memoryExport),
  memoryRestore: () => ipcRenderer.invoke(IPC.memoryRestore),
  getComposerDraft: (id) => ipcRenderer.invoke(IPC.getComposerDraft, id),
  saveComposerDraft: (id, text, revision) =>
    ipcRenderer.invoke(IPC.saveComposerDraft, id, text, revision),
  answerCodex: (id, holdId, answer) => ipcRenderer.invoke(IPC.answerCodex, id, holdId, answer),
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),
  getSessions: () => ipcRenderer.invoke(IPC.getSessions),
  onSessions: (listener) => subscribe<Session[]>(IPC.sessionsChanged, listener),
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  onSnapshot: (listener) => subscribe<Snapshot>(IPC.snapshotChanged, listener),
  setTreeView: (view) => ipcRenderer.send(IPC.setTreeView, view),
  onPanelOpened: (listener) => subscribe<PanelOpened>(IPC.panelOpened, listener),

  dotClick: () => ipcRenderer.send(IPC.dotClick),
  dotHover: () => ipcRenderer.send(IPC.dotHover),
  dotDrag: (dx, dy) => ipcRenderer.send(IPC.dotDrag, dx, dy),
  dotDragEnd: () => ipcRenderer.send(IPC.dotDragEnd),

  resizePanel: (height) => ipcRenderer.send(IPC.panelResize, height),
  closePanel: () => ipcRenderer.send(IPC.panelClose),
  leavePanel: () => ipcRenderer.send(IPC.panelLeave),
  onPanelPointerOutside: (listener) => subscribe<void>(IPC.panelPointerOutside, listener),
  setStayOpen: (on) => ipcRenderer.send(IPC.panelStayOpen, on),
  openInClaude: (appId) => ipcRenderer.send(IPC.openInClaude, appId),

  sendMessage: (sessionId, text) => ipcRenderer.invoke(IPC.sendMessage, sessionId, text),
  getRelays: () => ipcRenderer.invoke(IPC.getRelays),
  answerQuestion: (sessionId, answers) =>
    ipcRenderer.invoke(IPC.answerQuestion, sessionId, answers),
  answerNextStep: (sessionId, choice) => ipcRenderer.invoke(IPC.answerNextStep, sessionId, choice),
  answerApproval: (sessionId, choice) => ipcRenderer.invoke(IPC.answerApproval, sessionId, choice),
  answerOffer: (sessionId, choice) => ipcRenderer.invoke(IPC.answerOffer, sessionId, choice),
  releaseHold: (sessionId) => ipcRenderer.send(IPC.releaseHold, sessionId),
  copyText: (text) => ipcRenderer.send(IPC.copyText, text),
  getChanges: (sessionId) => ipcRenderer.invoke(IPC.getChanges, sessionId),
  getStepActivity: (sessionId, step) => ipcRenderer.invoke(IPC.getStepActivity, sessionId, step),
  getFileDiff: (sessionId, path) => ipcRenderer.invoke(IPC.getFileDiff, sessionId, path),
  openChangedFile: (sessionId, path) => ipcRenderer.send(IPC.openChangedFile, sessionId, path),
  getAgent: () => ipcRenderer.invoke(IPC.agentGet),
  agentLiveStart: (id, sdp) => ipcRenderer.invoke(IPC.agentLiveStart, id, sdp),
  agentLiveOpen: (id, text) => ipcRenderer.invoke(IPC.agentLiveOpen, id, text),
  agentLiveStop: (id) => ipcRenderer.send(IPC.agentLiveStop, id),
  onAgentLive: (listener) => subscribe<LiveVoiceEvent>(IPC.agentLiveEvent, listener),
  onAgent: (listener) => subscribe<AgentState>(IPC.agentChanged, listener),
  agentSend: (text) => ipcRenderer.invoke(IPC.agentSend, text),
  agentDecide: (id, allow) => ipcRenderer.send(IPC.agentDecide, id, allow),
  agentClose: () => ipcRenderer.send(IPC.agentClose),
  agentApps: (provider) => ipcRenderer.invoke(IPC.agentApps, provider),
  agentModels: () => ipcRenderer.invoke(IPC.agentModels),
  agentRespond: (id, response) => ipcRenderer.invoke(IPC.agentRespond, id, response),
  agentInterrupt: () => ipcRenderer.invoke(IPC.agentInterrupt),
  agentReadPage: (id, cursor) => ipcRenderer.invoke(IPC.agentReadPage, id, cursor),
  agentHistory: () => ipcRenderer.invoke(IPC.agentHistory),
  agentReadPast: (id) => ipcRenderer.invoke(IPC.agentReadPast, id),
  agentResume: (id) => ipcRenderer.invoke(IPC.agentResume, id),
  onRelays: (listener) => subscribe<RelayStatus[]>(IPC.relaysChanged, listener),
  getUsage: () => ipcRenderer.invoke(IPC.usageGet),
  onUsage: (listener) => subscribe<Usage>(IPC.usageChanged, listener),

  getStt: () => ipcRenderer.invoke(IPC.getStt),
  onStt: (listener) => subscribe<SttStatus>(IPC.sttChanged, listener),
  downloadStt: () => ipcRenderer.send(IPC.sttDownload),
  transcribe: (audio) => ipcRenderer.invoke(IPC.transcribe, audio),

  onTalkToggle: (listener) => subscribe<void>(IPC.talkToggle, listener),
  onTalkHold: (listener) => subscribe<'down' | 'up'>(IPC.talkHold, listener),
  setTalkState: (state) => ipcRenderer.send(IPC.talkState, state),
  onTalkState: (listener) => subscribe<TalkState>(IPC.talkState, listener),
  setOpenMicLive: (live) => ipcRenderer.send(IPC.openMicLive, live),
  onOpenMicLive: (listener) => subscribe<boolean>(IPC.openMicLive, listener),
  getOpenMicIndicator: () => ipcRenderer.invoke(IPC.openMicIndicator),
  setOpenMicLevel: (level) => ipcRenderer.send(IPC.openMicLevel, level),
  onOpenMicLevel: (listener) => subscribe<number>(IPC.openMicLevel, listener),
  stopOpenMic: () => ipcRenderer.send(IPC.stopOpenMic),
  onStopOpenMic: (listener) => subscribe<void>(IPC.stopOpenMic, listener),
  openPanelQuietly: () => ipcRenderer.send(IPC.openPanelQuietly),
  onHotkeyProblem: (listener) => subscribe<string | null>(IPC.hotkeyProblem, listener),

  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  onSettings: (listener) => subscribe<Settings>(IPC.settingsChanged, listener),
  onOpenSettings: (listener) => subscribe<void>(IPC.openSettings, listener),
  setHotkeyCapture: (capturing) => ipcRenderer.send(IPC.hotkeyCapture, capturing),
  resetDotPosition: () => ipcRenderer.send(IPC.resetDotPosition),
}

contextBridge.exposeInMainWorld('threadlight', api)
