import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

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
  perplexity: (input) => ipcRenderer.invoke(IPC.perplexity, input),
  accountChats: (input) => ipcRenderer.invoke(IPC.accountChats, input),
  onSharedDeliveryStatus: (listener) => subscribe(IPC.sharedDeliveryStatus, listener),
  onPerplexity: (listener) => subscribe(IPC.perplexityChanged, listener),
  controlHello: () => ipcRenderer.invoke('control:hello'),
  controlPublish: (value) => ipcRenderer.send('control:publish', value),
  controlClaim: (command) => ipcRenderer.invoke('control:claim', command),
  onControlCommand: (listener) => subscribe('control:command', listener),
  newThread: (input) => ipcRenderer.invoke(IPC.newThread, input),
  composerAttachments: (input) => ipcRenderer.invoke(IPC.composerAttachments, input),
  composerFilePath: (file) => webUtils.getPathForFile(file),
  threadImage: (input) => ipcRenderer.invoke(IPC.threadImage, input),
  threadTimeline: (input) => ipcRenderer.invoke(IPC.threadTimeline, input),
  onThreadTimeline: (listener) => subscribe(IPC.threadTimelineChanged, listener),
  artifactPreview: (input) => ipcRenderer.invoke(IPC.artifactPreview, input),
  onArtifactPreviewEvent: (listener) => subscribe(IPC.artifactPreviewEvent, listener),
  artifacts: (threadId, action, id) => ipcRenderer.invoke(IPC.artifacts, threadId, action, id),
  onArtifactsChanged: (listener) => subscribe(IPC.artifactsChanged, listener),
  communicationRequest: (input) => ipcRenderer.invoke(IPC.communicationRequest, input),
  onCommunication: (listener) => subscribe(IPC.communicationChanged, listener),

  getAttentionMotion: () => ipcRenderer.invoke(IPC.getAttentionMotion),
  onAttentionMotion: (listener) => subscribe(IPC.attentionMotion, listener),

  getMotion: () => ipcRenderer.invoke(IPC.getMotion),
  setMotion: (snapshot) => ipcRenderer.send(IPC.motion, snapshot),
  onMotion: (listener) => subscribe(IPC.motion, listener),
  spacesRequest: (input) => ipcRenderer.invoke(IPC.spacesRequest, input),
  spacesLiveStart: (id, sdp, spaceId, discussionId) =>
    ipcRenderer.invoke(IPC.spacesLiveStart, id, sdp, spaceId, discussionId),
  spacesLiveStop: (id) => ipcRenderer.send(IPC.spacesLiveStop, id),
  onSpaces: (listener) => subscribe(IPC.spacesChanged, listener),
  spacesRespond: (ideaId, requestId, response) =>
    ipcRenderer.invoke(IPC.spacesRespond, ideaId, requestId, response),
  memoryRequest: (input) => ipcRenderer.invoke(IPC.memoryRequest, input),
  onMemory: (listener) => subscribe(IPC.memoryChanged, listener),
  memoryImport: (folderId) => ipcRenderer.invoke(IPC.memoryImport, folderId),
  memoryExport: () => ipcRenderer.invoke(IPC.memoryExport),
  memoryRestore: () => ipcRenderer.invoke(IPC.memoryRestore),
  getComposerDraft: (id) => ipcRenderer.invoke(IPC.getComposerDraft, id),
  saveComposerDraft: (id, text, revision) =>
    ipcRenderer.invoke(IPC.saveComposerDraft, id, text, revision),
  answerCodex: (id, holdId, answer) => ipcRenderer.invoke(IPC.answerCodex, id, holdId, answer),
  answerNativeCodexQuestion: (id, reference, answers) =>
    ipcRenderer.invoke(IPC.answerNativeCodexQuestion, id, reference, answers),
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),
  getSessions: () => ipcRenderer.invoke(IPC.getSessions),
  onSessions: (listener) => subscribe<Session[]>(IPC.sessionsChanged, listener),
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  onSnapshot: (listener) => subscribe<Snapshot>(IPC.snapshotChanged, listener),
  setTreeView: (view) => ipcRenderer.send(IPC.setTreeView, view),
  onPanelOpened: (listener) => subscribe<PanelOpened>(IPC.panelOpened, listener),
  onPanelPeek: (listener) => subscribe<boolean>(IPC.panelPeek, listener),
  onPanelControlHeld: (listener) => subscribe<boolean>(IPC.panelControlHeld, listener),
  nativeCodePan: process.platform === 'win32',
  onReferenceAnchor: (listener) => subscribe(IPC.referenceAnchor, listener),
  pinnedCode: (command) => ipcRenderer.invoke(IPC.pinnedCode, command),
  onPinsChanged: (listener) => subscribe(IPC.pinsChanged, listener),
  pinnedCodeSize: (visible, height) => ipcRenderer.send(IPC.pinnedCodeSize, visible, height),
  codePan: (id, active) => ipcRenderer.send(IPC.codePan, id, active),
  onCodePanMotion: (listener) => subscribe(IPC.codePanMotion, listener),
  onPanelNavigate: (listener) => subscribe<'back' | 'forward'>(IPC.panelNavigate, listener),
  setWorkspacePanel: (on) => ipcRenderer.invoke(IPC.workspacePanel, on),

  dotClick: () => ipcRenderer.send(IPC.dotClick),
  dotHover: () => ipcRenderer.send(IPC.dotHover),
  dotDrag: (dx, dy) => ipcRenderer.send(IPC.dotDrag, dx, dy),
  dotDragEnd: () => ipcRenderer.send(IPC.dotDragEnd),

  setCanvasExpanded: (on) => ipcRenderer.invoke(IPC.canvasExpanded, on),
  resizePanel: (height) => ipcRenderer.send(IPC.panelResize, height),
  closePanel: () => ipcRenderer.send(IPC.panelClose),
  leavePanel: () => ipcRenderer.send(IPC.panelLeave),
  onPanelPointerOutside: (listener) => subscribe<void>(IPC.panelPointerOutside, listener),
  setStayOpen: (on) => ipcRenderer.send(IPC.panelStayOpen, on),
  setWorkspaceWireControl: (bounds) => ipcRenderer.send(IPC.workspaceWireControl, bounds),
  setWorkspaceWireRegions: (regions) => ipcRenderer.send(IPC.workspaceWireRegions, regions),
  setWorkspaceWireGutter: (width) => ipcRenderer.invoke(IPC.workspaceWireGutter, width),
  setPanelLayout: (layout, animating) => ipcRenderer.invoke(IPC.panelLayout, layout, animating),
  openInClaude: (appId) => ipcRenderer.send(IPC.openInClaude, appId),
  restartApp: () => ipcRenderer.send(IPC.restartApp),
  ignoreNeedsInput: (sessionId, ignore) =>
    ipcRenderer.send(IPC.ignoreNeedsInput, sessionId, ignore),
  dismissCodexQuestion: (id, ref) => ipcRenderer.invoke(IPC.dismissCodexQuestion, id, ref),

  sendMessage: (sessionId, text, attachmentIds, mode) =>
    ipcRenderer.invoke(IPC.sendMessage, sessionId, text, attachmentIds, mode),
  codexQueue: (sessionId, command) => ipcRenderer.invoke(IPC.codexQueue, sessionId, command),
  getRelays: () => ipcRenderer.invoke(IPC.getRelays),
  answerQuestion: (sessionId, answers, holdId) =>
    ipcRenderer.invoke(IPC.answerQuestion, sessionId, answers, holdId),
  answerNextStep: (sessionId, choice, holdId) =>
    ipcRenderer.invoke(IPC.answerNextStep, sessionId, choice, holdId),
  answerApproval: (sessionId, choice, holdId) =>
    ipcRenderer.invoke(IPC.answerApproval, sessionId, choice, holdId),
  answerOffer: (sessionId, choice, holdId) =>
    ipcRenderer.invoke(IPC.answerOffer, sessionId, choice, holdId),
  releaseHold: (sessionId) => ipcRenderer.send(IPC.releaseHold, sessionId),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text).catch(() => false),
  getChanges: (sessionId) => ipcRenderer.invoke(IPC.getChanges, sessionId),
  changeWorkflow: (sessionId, command, rootId) =>
    ipcRenderer.invoke(IPC.changeWorkflow, sessionId, command, rootId),
  getWorktreeChanges: (sessionId, lens, rootId) =>
    ipcRenderer.invoke(IPC.getWorktreeChanges, sessionId, lens, rootId),
  getWorktreeFileDiff: (sessionId, path, revision) =>
    ipcRenderer.invoke(IPC.getWorktreeFileDiff, sessionId, path, revision),
  getLocalTracking: (sessionId, rootId) =>
    ipcRenderer.invoke(IPC.getLocalTracking, sessionId, rootId),
  configureLocalTracking: (sessionId, action, expectedPolicy, rootId) =>
    ipcRenderer.invoke(IPC.configureLocalTracking, sessionId, action, expectedPolicy, rootId),
  openWorktreeChangedFile: (sessionId, path, revision) =>
    ipcRenderer.send(IPC.openWorktreeChangedFile, sessionId, path, revision),
  getStepActivity: (sessionId, step) => ipcRenderer.invoke(IPC.getStepActivity, sessionId, step),
  getFileDiff: (sessionId, path, revision) =>
    ipcRenderer.invoke(IPC.getFileDiff, sessionId, path, revision),
  openChangedFile: (sessionId, path, revision) =>
    ipcRenderer.send(IPC.openChangedFile, sessionId, path, revision),
  getAgent: () => ipcRenderer.invoke(IPC.agentGet),
  agentAnnouncement: (id, command) => ipcRenderer.invoke(IPC.agentAnnouncement, id, command),
  onScreenVoice: (listener) => subscribe(IPC.screenVoiceEvent, listener),
  screenVoiceCommand: (id, action, sdp) =>
    ipcRenderer.invoke(IPC.screenVoiceCommand, id, action, sdp),
  agentLiveStart: (id, sdp) => ipcRenderer.invoke(IPC.agentLiveStart, id, sdp),
  agentLiveOpen: (id, text) => ipcRenderer.invoke(IPC.agentLiveOpen, id, text),
  readLiveRemainder: (session, token) => ipcRenderer.invoke(IPC.liveRemainder, session, token),
  reportLiveTiming: (event) => ipcRenderer.send(IPC.liveTiming, event),
  livePlaybackBoundary: (id, kind, turn) =>
    ipcRenderer.send(IPC.livePlaybackBoundary, id, kind, turn),
  agentLiveStop: (id) => ipcRenderer.send(IPC.agentLiveStop, id),
  onAgentLive: (listener) => subscribe<LiveVoiceEvent>(IPC.agentLiveEvent, listener),
  onAgent: (listener) => subscribe<AgentState>(IPC.agentChanged, listener),
  agentSend: (text) => ipcRenderer.invoke(IPC.agentSend, text),
  agentDecide: (id, allow) => ipcRenderer.send(IPC.agentDecide, id, allow),
  agentClose: () => ipcRenderer.send(IPC.agentClose),
  finishCallChat: (id, choice) => ipcRenderer.invoke(IPC.finishCallChat, id, choice),
  startAgentVoice: () => ipcRenderer.send(IPC.startAgentVoice),
  setLiveCallControls: (active) => ipcRenderer.send(IPC.liveCallControls, active),
  onLiveMuteShortcut: (listener) => subscribe(IPC.liveMuteShortcut, listener),
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

  onTalkToggle: (listener) =>
    subscribe<'brainstorm' | { liveSessionId: string } | undefined>(IPC.talkToggle, listener),
  reportVoiceShortcut: (stage, destination) =>
    ipcRenderer.send(IPC.voiceShortcutTrace, stage, destination),
  onTalkHold: (listener) => subscribe<'down' | 'up'>(IPC.talkHold, listener),
  setTalkState: (state) => ipcRenderer.send(IPC.talkState, state),
  onTalkState: (listener) => subscribe<TalkState>(IPC.talkState, listener),
  setOpenMicLive: (live) => ipcRenderer.send(IPC.openMicLive, live),
  onOpenMicLive: (listener) => subscribe<boolean>(IPC.openMicLive, listener),
  getOpenMicIndicator: () => ipcRenderer.invoke(IPC.openMicIndicator),
  setOpenMicLevel: (level) => ipcRenderer.send(IPC.openMicLevel, level),
  onOpenMicLevel: (listener) => subscribe<number>(IPC.openMicLevel, listener),
  publishSpokenReply: (reply) => ipcRenderer.send(IPC.spokenReply, reply),
  getSpokenReply: () => ipcRenderer.invoke(IPC.spokenReply),
  onSpokenReply: (listener) => subscribe(IPC.spokenReply, listener),
  setSpokenReplySize: (width, height) => ipcRenderer.send(IPC.spokenReplySize, width, height),
  setMicMenu: (open) => ipcRenderer.invoke(IPC.micMenu, open),
  micAction: (action) => ipcRenderer.send(IPC.micAction, action),
  onMicAction: (listener) => subscribe(IPC.micAction, listener),
  stopOpenMic: () => ipcRenderer.send(IPC.stopOpenMic),
  onStopOpenMic: (listener) => subscribe<void>(IPC.stopOpenMic, listener),
  openPanelQuietly: () => ipcRenderer.send(IPC.openPanelQuietly),
  getHotkeyProblem: () => ipcRenderer.invoke(IPC.getHotkeyProblem),
  onHotkeyProblem: (listener) => subscribe<string | null>(IPC.hotkeyProblem, listener),

  inspectKimiLocalRuntime: (setup) => ipcRenderer.invoke(IPC.inspectKimiLocalRuntime, setup),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  onSettings: (listener) => subscribe<Settings>(IPC.settingsChanged, listener),
  onOpenSettings: (listener) => subscribe<void>(IPC.openSettings, listener),
  onScreenHelpNotice: (listener) => subscribe(IPC.screenHelpNotice, listener),
  setHotkeyCapture: (capturing) => ipcRenderer.send(IPC.hotkeyCapture, capturing),
  resetDotPosition: () => ipcRenderer.send(IPC.resetDotPosition),
}

contextBridge.exposeInMainWorld('threadlight', api)
