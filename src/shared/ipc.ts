// The one contract between the UI (renderer) and the Node side (main).
// Channel names and payload types live here so both sides stay in step.

import type { SttStatus } from './stt'
import type { RelayStatus, Session } from './types'

export const IPC = {
  getStt: 'stt:get',
  sttChanged: 'stt:changed',
  sttDownload: 'stt:download',
  transcribe: 'stt:transcribe',
  talkToggle: 'talk:toggle',
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
  openInClaude: 'claude:open-thread',
} as const

export interface PanelOpened {
  /** Tallest the panel may grow on this display; the list scrolls beyond it. */
  maxHeight: number
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
  onPanelOpened(listener: (info: PanelOpened) => void): () => void

  dotClick(): void
  /** Total pointer movement since the drag started, in screen pixels. */
  dotDrag(dx: number, dy: number): void
  dotDragEnd(): void

  resizePanel(height: number): void
  closePanel(): void
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
  /** Tells the dot what the talk recording is doing. */
  setTalkState(state: TalkState): void
  onTalkState(listener: (state: TalkState) => void): () => void
  /** Shows the panel without taking focus, keeping what the panel has filled in. */
  openPanelQuietly(): void
  /** The talk hotkey could not be registered (another app has it), or null when it is fine. */
  onHotkeyProblem(listener: (problem: string | null) => void): () => void
}
