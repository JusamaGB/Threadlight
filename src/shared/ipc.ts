// The one contract between the UI (renderer) and the Node side (main).
// Channel names and payload types live here so both sides stay in step.

import type { Settings, SettingsPatch } from './settings'
import type { SttStatus } from './stt'
import type { RelayStatus, Session, Snapshot, TreeView } from './types'

export const IPC = {
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
  openPanelQuietly: 'panel:open-quietly',
  hotkeyProblem: 'hotkey:problem',
  sendMessage: 'relay:send',
  getRelays: 'relay:get',
  relaysChanged: 'relay:changed',
  getVersion: 'app:get-version',
  getSessions: 'sessions:get',
  sessionsChanged: 'sessions:changed',
  dotClick: 'dot:click',
  dotDrag: 'dot:drag',
  dotDragEnd: 'dot:drag-end',
  panelOpened: 'panel:opened',
  panelResize: 'panel:resize',
  panelClose: 'panel:close',
  panelStayOpen: 'panel:stay-open',
  openInClaude: 'claude:open-thread',
} as const

export interface PanelOpened {
  /** Tallest the panel may grow on this display; the list scrolls beyond it. */
  maxHeight: number
  /** Grows down from the dot (top half of the screen), or up from it (bottom half). */
  opensDown: boolean
  /** Opened by a click: start fresh on the Active view. False when the talk hotkey opened it. */
  fresh: boolean
}

/** Where the talk hotkey's recording is, shown on the dot. */
export type TalkState = 'idle' | 'listening' | 'transcribing'

/** What the preload script exposes on `window.threadlight`. */
export interface ThreadlightApi {
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
  /** Total pointer movement since the drag started, in screen pixels. */
  dotDrag(dx: number, dy: number): void
  dotDragEnd(): void

  resizePanel(height: number): void
  closePanel(): void
  /** While on, clicking elsewhere does not close the panel (the active or full list pinned open). */
  setStayOpen(on: boolean): void
  openInClaude(appId: string): void

  /** Relays `text` to a session in the background. Resolves once accepted, not when replied. */
  sendMessage(
    sessionId: string,
    text: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  getRelays(): Promise<RelayStatus[]>
  onRelays(listener: (statuses: RelayStatus[]) => void): () => void

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
