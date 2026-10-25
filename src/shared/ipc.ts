// The one contract between the UI (renderer) and the Node side (main).
// Channel names and payload types live here so both sides stay in step.

import type { Session } from './types'

export const IPC = {
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
}

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
}
