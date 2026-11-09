import type { QueueCommand, QueueResult } from './codexQueue'
import type { ChangeWorkflowCommand, ChangeWorkflowReply } from './changeWorkflow'
import type { ChangeLens, TrackingAction, TrackingState } from './changes'
import type { AnnouncementCommand, AnnouncementReply } from './conversationEvents'
import type { ControlCommand, ControlHello, ControlPublication } from './appControl'
// The one contract between the UI (renderer) and the Node side (main).
// Channel names and payload types live here so both sides stay in step.

import type {
  AgentApp,
  AgentConversation,
  AgentItem,
  AgentState,
  AgentHistoryPage,
  AgentModel,
  AgentProvider,
  AgentResponse,
  AgentResult,
} from './agent'
import type { Settings, SettingsPatch } from './settings'
import type { KimiSetup, KimiRuntimeInspection } from './kimi'
import type { SttStatus } from './stt'
import type { Usage } from './usage'
import type { MemoryInput, MemoryReply, MemorySnapshot } from './memory'
import type { SpacesInput, SpacesReply, SpacesSnapshot } from './spaces'
import type {
  LiveVoiceEvent,
  LiveVoiceResult,
  ScreenVoiceEvent,
  ScreenVoiceCommand,
} from './liveVoice'
import type { MotionSnapshot } from './motion'
import type { AttentionMotion } from './attentionMotion'
import type { DraftResult } from './messaging'
import type {
  Changes,
  FileDiff,
  RelayStatus,
  Session,
  Snapshot,
  StepActivity,
  TreeView,
} from './types'

export const IPC = {
  perplexity: 'perplexity:request',
  accountChats: 'account-chats:request',
  sharedDeliveryStatus: 'account-chats:delivery-status',
  perplexityChanged: 'perplexity:changed',
  changeWorkflow: 'changes:workflow',
  newThread: 'threads:create',
  composerAttachments: 'composer:attachments',
  threadImage: 'thread-timeline:image',
  threadTimeline: 'thread-timeline:request',
  threadTimelineChanged: 'thread-timeline:changed',
  artifacts: 'artifacts:request',
  artifactsChanged: 'artifacts:changed',
  artifactPreview: 'artifacts:preview',
  artifactPreviewEvent: 'artifacts:preview-event',
  communicationRequest: 'communication:request',
  communicationChanged: 'communication:changed',

  attentionMotion: 'motion:attention',
  getAttentionMotion: 'motion:get-attention',

  spacesRequest: 'spaces:request',
  spacesChanged: 'spaces:changed',
  spacesRespond: 'spaces:respond',
  memoryRequest: 'memory:request',
  memoryChanged: 'memory:changed',
  memoryImport: 'memory:import',
  memoryExport: 'memory:export',
  memoryRestore: 'memory:restore',
  getSnapshot: 'sessions:get-snapshot',
  snapshotChanged: 'sessions:snapshot-changed',
  setTreeView: 'sessions:set-tree-view',
  inspectKimiLocalRuntime: 'kimi:inspect-local-runtime',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  settingsChanged: 'settings:changed',
  openSettings: 'settings:open',
  screenHelpNotice: 'screen-region:notice',
  hotkeyCapture: 'hotkey:capture',
  resetDotPosition: 'dot:reset-position',
  getStt: 'stt:get',
  sttChanged: 'stt:changed',
  sttDownload: 'stt:download',
  transcribe: 'stt:transcribe',
  talkToggle: 'talk:toggle',
  voiceShortcutTrace: 'talk:shortcut-trace',
  liveTiming: 'agent:live-timing',
  liveRemainder: 'agent:read-remaining',
  spacesLiveStart: 'spaces:live-start',
  spacesLiveStop: 'spaces:live-stop',
  talkHold: 'talk:hold',
  talkState: 'talk:state',
  openMicLive: 'talk:open-mic-live',
  openMicLevel: 'talk:open-mic-level',
  openMicIndicator: 'talk:open-mic-indicator',
  motion: 'motion:changed',
  getMotion: 'motion:get',
  stopOpenMic: 'talk:stop-open-mic',
  micMenu: 'talk:mic-menu',
  spokenReply: 'talk:spoken-reply',
  spokenReplySize: 'talk:spoken-reply-size',
  micAction: 'talk:mic-action',
  openPanelQuietly: 'panel:open-quietly',
  getHotkeyProblem: 'hotkey:current-problem',
  hotkeyProblem: 'hotkey:problem',
  sendMessage: 'relay:send',
  codexQueue: 'codex:queue',
  getComposerDraft: 'composer:draft-get',
  saveComposerDraft: 'composer:draft-save',
  getRelays: 'relay:get',
  relaysChanged: 'relay:changed',
  getVersion: 'app:get-version',
  getSessions: 'sessions:get',
  sessionsChanged: 'sessions:changed',
  dotClick: 'dot:click',
  dotDrag: 'dot:drag',
  dotDragEnd: 'dot:drag-end',
  dotHover: 'dot:hover',
  panelOpened: 'panel:opened',
  panelPeek: 'panel:peek',
  panelControlHeld: 'panel:control-held',
  codePan: 'panel:code-pan',
  codePanMotion: 'panel:code-pan-motion',
  pinnedCodeSize: 'panel:pinned-code-size',
  pinnedCode: 'panel:pinned-code',
  pinsChanged: 'panel:pins-changed',
  referenceAnchor: 'reference:anchor',
  panelNavigate: 'panel:navigate',
  workspacePanel: 'panel:workspace-layout',
  panelResize: 'panel:resize',
  canvasExpanded: 'panel:canvas-expanded',
  panelLayout: 'panel:layout',
  workspaceWireRegions: 'panel:wire-regions',
  workspaceWireGutter: 'panel:wire-gutter',
  panelClose: 'panel:close',
  panelLeave: 'panel:leave',
  panelPointerOutside: 'panel:pointer-outside',
  panelStayOpen: 'panel:stay-open',
  workspaceWireControl: 'panel:wire-control',
  openInClaude: 'claude:open-thread',
  ignoreNeedsInput: 'session:ignore-needs-input',
  dismissCodexQuestion: 'codex:dismiss-question',
  restartApp: 'app:restart',
  answerQuestion: 'hold:answer-question',
  answerNextStep: 'hold:answer-next-step',
  answerApproval: 'hold:answer-approval',
  answerOffer: 'hold:answer-offer',
  answerCodex: 'codex:answer',
  answerNativeCodexQuestion: 'codex:answer-native-question',
  releaseHold: 'hold:release',
  copyText: 'clipboard:copy',
  getChanges: 'changes:get',
  getLocalTracking: 'changes:tracking',
  configureLocalTracking: 'changes:configure-tracking',
  getWorktreeChanges: 'changes:worktree',
  getWorktreeFileDiff: 'changes:worktree-file',
  openWorktreeChangedFile: 'changes:worktree-open',
  getStepActivity: 'plan:step-activity',
  getFileDiff: 'changes:file',
  openChangedFile: 'changes:open',
  agentGet: 'agent:get',
  agentAnnouncement: 'agent:announcement',
  agentLiveStart: 'agent:live-start',
  agentLiveOpen: 'agent:live-open',
  agentLiveStop: 'agent:live-stop',
  livePlaybackBoundary: 'agent:live-playback-boundary',
  agentLiveEvent: 'agent:live-event',
  screenVoiceEvent: 'screen:voice-event',
  screenVoiceCommand: 'screen:voice-command',
  agentChanged: 'agent:changed',
  agentSend: 'agent:send',
  agentDecide: 'agent:decide',
  agentClose: 'agent:close',
  finishCallChat: 'agent:finish-call-chat',
  startAgentVoice: 'agent:start-voice',
  liveMuteShortcut: 'agent:mute-shortcut',
  liveCallControls: 'agent:live-controls',
  agentApps: 'agent:apps',
  agentHistory: 'agent:history',
  agentReadPast: 'agent:read-past',
  agentResume: 'agent:resume',
  agentModels: 'agent:models',
  agentRespond: 'agent:respond',
  agentInterrupt: 'agent:interrupt',
  agentReadPage: 'agent:read-page',
  usageGet: 'usage:get',
  usageChanged: 'usage:changed',
} as const

export interface PanelOpened {
  /** Explicit waveform click. Ordinary resize or quiet opens preserve the current route. */
  fromMic?: boolean
  canvasSize?: { width: number; height: number }

  /** Tallest the panel may grow on this display; the list scrolls beyond it. */
  maxHeight: number
  /** Grows down from the dot (top half of the screen), or up from it (bottom half). */
  opensDown: boolean
  /** Start fresh on click; preserve state for quiet opens and position/layout updates. */
  fresh: boolean
}

/** Where the talk hotkey's recording is, shown on the dot. */
export type TalkState = 'idle' | 'listening' | 'transcribing'

/** What the preload script exposes on `window.threadlight`. */
export interface ReferenceAnchor {
  right: boolean
  bottom: boolean
  width: number
  height: number
}

export interface ThreadlightApi {
  perplexity(
    input: import('./perplexity').PerplexityCommand,
  ): Promise<import('./perplexity').PerplexityReply>
  accountChats(
    input: import('./accountChats').ChatCommand,
  ): Promise<import('./accountChats').ChatReply>
  onSharedDeliveryStatus(
    listener: (status: import('./accountChats').SharedDeliveryStatus) => void,
  ): () => void
  onPerplexity(listener: () => void): () => void
  controlHello: () => Promise<ControlHello | null>
  controlPublish: (value: ControlPublication) => void
  controlClaim: (command: ControlCommand) => Promise<boolean>
  onControlCommand: (listener: (command: ControlCommand) => void) => () => void
  newThread(
    input: import('./newThread').NewThreadRequest,
  ): Promise<import('./newThread').NewThreadResult>
  composerAttachments(
    input: import('./composerAttachments').ComposerAttachmentsRequest,
  ): Promise<import('./composerAttachments').ComposerAttachmentsReply>
  composerFilePath(file: File): string
  threadImage(
    input: import('./threadTimeline').TimelineImageRequest,
  ): Promise<import('./threadTimeline').TimelineImageReply>
  threadTimeline(
    input: import('./threadTimeline').TimelineRequest,
  ): Promise<import('./threadTimeline').TimelineReply>
  onThreadTimeline(
    listener: (timeline: import('./threadTimeline').ThreadTimeline) => void,
  ): () => void
  answerNativeCodexQuestion(
    sessionId: string,
    reference: import('./codexQuestions').CodexQuestionRef,
    answers: string[],
  ): Promise<import('./codexQuestions').CodexQuestionResult>
  browserRequest(input: import('./browser').BrowserUiRequest): Promise<
    import('./browser').BrowserReply & {
      connections?: { id: string; label: string }[]
      hosted?: boolean
    }
  >
  onBrowserChanged(listener: (state: import('./browser').BrowserState) => void): () => void
  artifactPreview(
    input: import('./artifacts').ArtifactPreviewRequest,
  ): Promise<{ ok: boolean; reason?: string }>
  onArtifactPreviewEvent(
    listener: (event: import('./artifacts').ArtifactPreviewEvent) => void,
  ): () => void
  onArtifactsChanged(
    listener: (change: { threadId: string; items: import('./artifacts').ThreadArtifact[] }) => void,
  ): () => void
  artifacts(
    threadId: string,
    action: 'list' | 'link' | 'read' | 'copy',
    id?: string,
  ): Promise<import('./artifacts').ArtifactReply>
  communicationRequest(input: {
    action: string
    arguments?: unknown
    expectedRevision?: number
  }): Promise<import('./communication').CommunicationReply>
  onCommunication(listener: () => void): () => void

  getAttentionMotion(): Promise<AttentionMotion>
  onAttentionMotion(listener: (state: AttentionMotion) => void): () => void

  getMotion(): Promise<MotionSnapshot>
  setMotion(snapshot: MotionSnapshot): void
  onMotion(listener: (snapshot: MotionSnapshot) => void): () => void
  spacesRequest(input: SpacesInput): Promise<SpacesReply>
  spacesLiveStart(
    sessionId: string,
    sdp: string,
    spaceId: string,
    discussionId: string | null,
  ): Promise<LiveVoiceResult>
  spacesLiveStop(sessionId: string): void
  onSpaces(listener: (snapshot: SpacesSnapshot) => void): () => void
  spacesRespond(ideaId: string, requestId: string, response: AgentResponse): Promise<AgentResult>
  memoryRequest(input: MemoryInput): Promise<MemoryReply>
  onMemory(listener: (snapshot: MemorySnapshot) => void): () => void
  memoryImport(folderId: string): Promise<MemoryReply>
  memoryExport(): Promise<MemoryReply>
  memoryRestore(): Promise<MemoryReply>
  getComposerDraft(sessionId: string): Promise<DraftResult>
  saveComposerDraft(sessionId: string, text: string, revision: number): Promise<DraftResult>
  answerCodex(
    sessionId: string,
    holdId: string,
    answer: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  getVersion(): Promise<string>
  getSessions(): Promise<Session[]>
  /** Called whenever the session list changes. Returns an unsubscribe function. */
  onSessions(listener: (sessions: Session[]) => void): () => void
  /** Recent sessions plus the workspace tree. */
  getSnapshot(): Promise<Snapshot>
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void
  /** Which workspaces are open; their threads are read and sent in the next snapshot. */
  setTreeView(view: TreeView): void
  onPanelOpened(listener: (info: PanelOpened) => void): () => void
  onPanelPeek(listener: (peek: boolean) => void): () => void
  onPanelControlHeld(listener: (held: boolean) => void): () => void
  nativeCodePan: boolean
  pinnedCode(command: import('./pinnedCode').PinCommand): Promise<import('./pinnedCode').PinState>
  onPinsChanged(listener: (state: import('./pinnedCode').PinState) => void): () => void
  pinnedCodeSize(visible: boolean, height: number): void
  onReferenceAnchor(listener: (anchor: ReferenceAnchor) => void): () => void
  codePan(id: string, active: boolean): void
  onCodePanMotion(
    listener: (motion: { id: string; dx: number; dy: number; end?: boolean }) => void,
  ): () => void
  onPanelNavigate(
    listener: (direction: import('./navigationHistory').NavigationDirection) => void,
  ): () => void
  /** Workspace can use the whole display work area; returns current available height. */
  setWorkspacePanel(on: boolean): Promise<PanelOpened | null>

  dotClick(): void
  dotHover(): void
  /** Total pointer movement since the drag started, in screen pixels. */
  dotDrag(dx: number, dy: number): void
  dotDragEnd(): void

  setCanvasExpanded(on: boolean): Promise<{ width: number; height: number } | null>
  resizePanel(height: number): void
  closePanel(): void
  leavePanel(): void
  onPanelPointerOutside(listener: () => void): () => void
  /** While on, clicking elsewhere does not close the panel (the active or full list pinned open). */
  setStayOpen(on: boolean): void
  setWorkspaceWireControl(bounds: { top: number; height: number } | null): void
  /** The thin clickable strips along each wire; everything else in the gutter passes clicks through. */
  setWorkspaceWireRegions(regions: { x: number; y: number; width: number; height: number }[]): void
  setWorkspaceWireGutter(width: number): Promise<{ cardWidth: number } | null>
  /** Widens or narrows the panel window. Resolves with the card width the layout gives. `animating`
   * keeps the gutter from passing clicks through while the card and rows move. */
  setPanelLayout(layout: 'single' | 'dual', animating?: boolean): Promise<{ cardWidth: number }>
  openInClaude(appId: string): void
  /** Sets a thread's pending request aside (or back) in Threadlight only; nothing reaches the app. */
  ignoreNeedsInput(sessionId: string, ignore: boolean): void
  dismissCodexQuestion(
    sessionId: string,
    ref: import('./codexQuestions').CodexQuestionRef,
  ): Promise<boolean>
  /** Closes Threadlight and starts it again: settings and threads are untouched. */
  restartApp(): void

  /** Relays `text` to a session in the background. Resolves once accepted, not when replied. */
  sendMessage(
    sessionId: string,
    text: string,
    attachmentIds?: string[],
    mode?: 'auto' | 'queue' | 'steer',
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  codexQueue(sessionId: string, command: QueueCommand): Promise<QueueResult>
  getRelays(): Promise<RelayStatus[]>
  /**
   * Answers a question card Threadlight is holding, keyed by each question's text (see
   * questionHolds.ts). Refused once the hold has ended: then it is answered in Claude.
   */
  answerQuestion(
    sessionId: string,
    answers: Record<string, string>,
    holdId?: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /**
   * Answers a next step Threadlight is holding: one of its buttons (by label) or words of the
   * user's own. The turn carries on with it. Refused once the hold has ended.
   */
  answerNextStep(
    sessionId: string,
    choice: { label: string } | { text: string },
    holdId?: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Allows or denies a tool Threadlight is holding for approval. Refused once let go. */
  answerApproval(
    sessionId: string,
    choice: { allow: true } | { allow: false; message?: string },
    holdId?: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Answers a held New session / Do it here offer. Refused once let go. */
  answerOffer(
    sessionId: string,
    choice: 'new-session' | 'here',
    holdId?: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Lets a held card go, so the Claude app carries on with it as usual. */
  releaseHold(sessionId: string): void

  /** Puts text on the clipboard (for an answer to paste into Claude). */
  copyText(text: string): Promise<boolean>

  /** This thread's own recorded changes; null when its history is unavailable. */
  getChanges(sessionId: string): Promise<Changes | null>
  changeWorkflow(
    sessionId: string,
    command: ChangeWorkflowCommand,
    rootId?: string,
  ): Promise<ChangeWorkflowReply>
  /** All current changes against HEAD in the thread's detected Git worktree. */
  getWorktreeChanges(sessionId: string, lens?: ChangeLens, rootId?: string): Promise<Changes | null>
  getWorktreeFileDiff(sessionId: string, path: string, revision?: string): Promise<FileDiff>
  getLocalTracking(sessionId: string, rootId?: string): Promise<TrackingState | null>
  configureLocalTracking(
    sessionId: string,
    action: TrackingAction,
    expectedPolicy: number,
    rootId?: string,
  ): Promise<TrackingState>
  openWorktreeChangedFile(sessionId: string, path: string, revision?: string): void
  /** What a thread did on one of its plan steps (named by its text); null if unreadable. */
  getStepActivity(sessionId: string, step: string): Promise<StepActivity | null>
  /** One changed file's diff, fetched when it is opened. */
  getFileDiff(sessionId: string, path: string, revision?: string): Promise<FileDiff>
  /** Opens a changed file in its own app. */
  openChangedFile(sessionId: string, path: string, revision?: string): void

  /** The agent conversation Threadlight hosts (agentRun.ts). */
  getAgent(): Promise<AgentState>
  agentAnnouncement(sessionId: string, command: AnnouncementCommand): Promise<AnnouncementReply>
  onScreenVoice(listener: (event: ScreenVoiceEvent) => void): () => void
  screenVoiceCommand(
    id: string,
    action: ScreenVoiceCommand,
    sdp?: string,
  ): Promise<LiveVoiceResult | AgentResult>
  agentLiveStart(sessionId: string, sdp: string): Promise<LiveVoiceResult>
  agentLiveOpen(sessionId: string, text: string): Promise<AgentResult>
  readLiveRemainder(session: string, token: string): Promise<import('./agent').AgentResult>
  reportLiveTiming(event: import('./liveTiming').LiveTiming): void
  livePlaybackBoundary(
    sessionId: string,
    kind: import('./liveVoice').PlaybackBoundary,
    turnId: string,
    transcript?: string,
  ): void
  agentLiveStop(sessionId: string): void
  onAgentLive(listener: (event: LiveVoiceEvent) => void): () => void
  onAgent(listener: (state: AgentState) => void): () => void
  /** Sends a message, starting a new conversation if none is open. */
  agentSend(text: string): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Allows or denies the tool call waiting for approval. */
  agentDecide(id: string, allow: boolean): void
  /** Ends the conversation. */
  agentClose(): void
  finishCallChat(id: string, choice: 'archive' | 'fresh'): Promise<import('./agent').AgentResult>
  startAgentVoice(): void
  setLiveCallControls(active: boolean): void
  onLiveMuteShortcut(listener: () => void): () => void
  /** The connected apps the agent could use (for the Settings switches). */
  agentApps(provider?: AgentProvider): Promise<AgentApp[]>
  agentModels(): Promise<{ models: AgentModel[]; error: string | null }>
  agentRespond(id: string, response: AgentResponse): Promise<AgentResult>
  agentInterrupt(): Promise<AgentResult>
  agentReadPage(id: string, cursor?: string | null): Promise<AgentHistoryPage>
  /** Past conversations, newest first (agentHistory.ts). */
  agentHistory(): Promise<AgentConversation[]>
  /** One past conversation's lines, to read. */
  agentReadPast(id: string): Promise<AgentItem[]>
  /** Continues a past conversation: it becomes the current one. */
  agentResume(id: string): Promise<{ ok: true } | { ok: false; reason: string }>
  onRelays(listener: (statuses: RelayStatus[]) => void): () => void

  /** The plan's usage limits as last read (usage.ts); checks again when the reading is old. */
  getUsage(): Promise<Usage | null>
  onUsage(listener: (usage: Usage) => void): () => void

  getStt(): Promise<SttStatus>
  onStt(listener: (status: SttStatus) => void): () => void
  /** The user agreed to download the speech model. */
  downloadStt(): void
  /** 16 kHz mono samples in, text out. */
  transcribe(audio: Float32Array): Promise<string>

  /** The talk hotkey was pressed (start or stop recording). Panel window only. */
  onTalkToggle(
    listener: (destination?: 'brainstorm' | { liveSessionId: string }) => void,
  ): () => void
  reportVoiceShortcut(
    stage:
      'request' | 'microphone-requested' | 'listening' | 'blocked' | 'no-project' | 'needs-stt',
    destination: 'agent' | 'brainstorm',
  ): void
  /** Press-and-hold mode: the talk hotkey went down, or was released. Panel window only. */
  onTalkHold(listener: (phase: 'down' | 'up') => void): () => void
  /** Tells the dot what the talk recording is doing. */
  setTalkState(state: TalkState): void
  onTalkState(listener: (state: TalkState) => void): () => void
  /** The open mic is listening (the panel tells the floating indicator). */
  setOpenMicLive(live: boolean): void
  onOpenMicLive(listener: (live: boolean) => void): () => void
  getOpenMicIndicator(): Promise<{ live: boolean; level: number }>
  setOpenMicLevel(level: number): void
  onOpenMicLevel(listener: (level: number) => void): () => void
  publishSpokenReply(reply: import('./spokenReply').SpokenReply | null): void
  getSpokenReply(): Promise<import('./spokenReply').SpokenReply | null>
  onSpokenReply(listener: (reply: import('./spokenReply').SpokenReply | null) => void): () => void
  setSpokenReplySize(width: number, height: number): void
  setMicMenu(open: boolean): Promise<{ x: number; y: number; menuY: number } | null>
  micAction(action: 'pause' | 'resume' | 'stopSpeaking'): void
  onMicAction(listener: (action: 'pause' | 'resume' | 'stopSpeaking') => void): () => void
  stopOpenMic(): void
  onStopOpenMic(listener: () => void): () => void
  /** Shows the panel without taking focus, keeping what the panel has filled in. */
  openPanelQuietly(): void
  /** The talk hotkey could not be registered (another app has it), or null when it is fine. */
  getHotkeyProblem(): Promise<string | null>
  onHotkeyProblem(listener: (problem: string | null) => void): () => void

  /** Explicit local metadata inspection only; never launches a runtime. */
  inspectKimiLocalRuntime(setup: KimiSetup): Promise<KimiRuntimeInspection>
  getSettings(): Promise<Settings>
  /** Saves a change. Refused (with a reason) if invalid, or e.g. the hotkey is taken. */
  updateSettings(
    patch: SettingsPatch,
  ): Promise<{ ok: true; settings: Settings } | { ok: false; reason: string }>
  onSettings(listener: (settings: Settings) => void): () => void
  /** The tray's "Settings" item: the panel switches to its settings view. Panel window only. */
  onOpenSettings(listener: () => void): () => void
  onScreenHelpNotice(listener: (event: { message: string; open: boolean }) => void): () => void
  /** Pauses the talk hotkey while a new one is being typed in, so it can be captured. */
  setHotkeyCapture(capturing: boolean): void
  resetDotPosition(): void
}
