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
import type { SttStatus } from './stt'
import type { Usage } from './usage'
import type { MemoryInput, MemoryReply, MemorySnapshot } from './memory'
import type { SpacesInput, SpacesReply, SpacesSnapshot } from './spaces'
import type { LiveVoiceEvent, LiveVoiceResult } from './liveVoice'
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
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  settingsChanged: 'settings:changed',
  openSettings: 'settings:open',
  hotkeyCapture: 'hotkey:capture',
  resetDotPosition: 'dot:reset-position',
  getStt: 'stt:get',
  sttChanged: 'stt:changed',
  sttDownload: 'stt:download',
  transcribe: 'stt:transcribe',
  talkToggle: 'talk:toggle',
  talkHold: 'talk:hold',
  talkState: 'talk:state',
  openMicLive: 'talk:open-mic-live',
  openMicLevel: 'talk:open-mic-level',
  openMicIndicator: 'talk:open-mic-indicator',
  motion: 'motion:changed',
  getMotion: 'motion:get',
  stopOpenMic: 'talk:stop-open-mic',
  openPanelQuietly: 'panel:open-quietly',
  hotkeyProblem: 'hotkey:problem',
  sendMessage: 'relay:send',
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
  panelResize: 'panel:resize',
  panelClose: 'panel:close',
  panelLeave: 'panel:leave',
  panelPointerOutside: 'panel:pointer-outside',
  panelStayOpen: 'panel:stay-open',
  workspaceWireControl: 'panel:wire-control',
  openInClaude: 'claude:open-thread',
  answerQuestion: 'hold:answer-question',
  answerNextStep: 'hold:answer-next-step',
  answerApproval: 'hold:answer-approval',
  answerOffer: 'hold:answer-offer',
  answerCodex: 'codex:answer',
  releaseHold: 'hold:release',
  copyText: 'clipboard:copy',
  getChanges: 'changes:get',
  getStepActivity: 'plan:step-activity',
  getFileDiff: 'changes:file',
  openChangedFile: 'changes:open',
  agentGet: 'agent:get',
  agentLiveStart: 'agent:live-start',
  agentLiveOpen: 'agent:live-open',
  agentLiveStop: 'agent:live-stop',
  agentLiveEvent: 'agent:live-event',
  agentChanged: 'agent:changed',
  agentSend: 'agent:send',
  agentDecide: 'agent:decide',
  agentClose: 'agent:close',
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
export interface ThreadlightApi {
  getAttentionMotion(): Promise<AttentionMotion>
  onAttentionMotion(listener: (state: AttentionMotion) => void): () => void
  getMotion(): Promise<MotionSnapshot>
  setMotion(snapshot: MotionSnapshot): void
  onMotion(listener: (snapshot: MotionSnapshot) => void): () => void
  spacesRequest(input: SpacesInput): Promise<SpacesReply>
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

  dotClick(): void
  dotHover(): void
  /** Total pointer movement since the drag started, in screen pixels. */
  dotDrag(dx: number, dy: number): void
  dotDragEnd(): void

  resizePanel(height: number): void
  closePanel(): void
  leavePanel(): void
  onPanelPointerOutside(listener: () => void): () => void
  /** While on, clicking elsewhere does not close the panel (the active or full list pinned open). */
  setStayOpen(on: boolean): void
  setWorkspaceWireControl(bounds: { top: number; height: number } | null): void
  openInClaude(appId: string): void

  /** Relays `text` to a session in the background. Resolves once accepted, not when replied. */
  sendMessage(
    sessionId: string,
    text: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  getRelays(): Promise<RelayStatus[]>
  /**
   * Answers a question card Threadlight is holding, keyed by each question's text (see
   * questionHolds.ts). Refused once the hold has ended: then it is answered in Claude.
   */
  answerQuestion(
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /**
   * Answers a next step Threadlight is holding: one of its buttons (by label) or words of the
   * user's own. The turn carries on with it. Refused once the hold has ended.
   */
  answerNextStep(
    sessionId: string,
    choice: { label: string } | { text: string },
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Allows or denies a tool Threadlight is holding for approval. Refused once let go. */
  answerApproval(
    sessionId: string,
    choice: { allow: true } | { allow: false; message?: string },
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Answers a held New session / Do it here offer. Refused once let go. */
  answerOffer(
    sessionId: string,
    choice: 'new-session' | 'here',
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Lets a held card go, so the Claude app carries on with it as usual. */
  releaseHold(sessionId: string): void

  /** Puts text on the clipboard (for an answer to paste into Claude). */
  copyText(text: string): void

  /** A thread's changed files since the last commit (the Changes view); null outside git. */
  getChanges(sessionId: string): Promise<Changes | null>
  /** What a thread did on one of its plan steps (named by its text); null if unreadable. */
  getStepActivity(sessionId: string, step: string): Promise<StepActivity | null>
  /** One changed file's diff, fetched when it is opened. */
  getFileDiff(sessionId: string, path: string): Promise<FileDiff>
  /** Opens a changed file in its own app. */
  openChangedFile(sessionId: string, path: string): void

  /** The agent conversation Threadlight hosts (agentRun.ts). */
  getAgent(): Promise<AgentState>
  agentLiveStart(sessionId: string, sdp: string): Promise<LiveVoiceResult>
  agentLiveOpen(sessionId: string, text: string): Promise<AgentResult>
  agentLiveStop(sessionId: string): void
  onAgentLive(listener: (event: LiveVoiceEvent) => void): () => void
  onAgent(listener: (state: AgentState) => void): () => void
  /** Sends a message, starting a new conversation if none is open. */
  agentSend(text: string): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Allows or denies the tool call waiting for approval. */
  agentDecide(id: string, allow: boolean): void
  /** Ends the conversation. */
  agentClose(): void
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
  onTalkToggle(listener: () => void): () => void
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
  stopOpenMic(): void
  onStopOpenMic(listener: () => void): () => void
  /** Shows the panel without taking focus, keeping what the panel has filled in. */
  openPanelQuietly(): void
  /** The talk hotkey could not be registered (another app has it), or null when it is fine. */
  onHotkeyProblem(listener: (problem: string | null) => void): () => void

  getSettings(): Promise<Settings>
  /** Saves a change. Refused (with a reason) if invalid, or e.g. the hotkey is taken. */
  updateSettings(
    patch: SettingsPatch,
  ): Promise<{ ok: true; settings: Settings } | { ok: false; reason: string }>
  onSettings(listener: (settings: Settings) => void): () => void
  /** The tray's "Settings" item: the panel switches to its settings view. Panel window only. */
  onOpenSettings(listener: () => void): () => void
  /** Pauses the talk hotkey while a new one is being typed in, so it can be captured. */
  setHotkeyCapture(capturing: boolean): void
  resetDotPosition(): void
}
