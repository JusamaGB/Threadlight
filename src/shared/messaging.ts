/** A receipt describes provider acceptance, never just local IPC success. */
export type DeliveryPhase =
  | 'queued'
  | 'held'
  | 'submitting'
  | 'accepted'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'unknown'
  | 'cancelled'

export interface MessageOperation {
  id: string
  target: string
  text: string
  intent: 'send' | 'queue'
  phase: DeliveryPhase
  epoch: string
  turnId?: string
  reason?: string
  updatedAt: number
}

export interface ComposerDraft {
  text: string
  revision: number
  updatedAt: number
}

export type DraftResult = { ok: true; draft: ComposerDraft } | { ok: false; reason: string }

export const CODEX_DESKTOP_UNAVAILABLE =
  'Sending to this open Codex chat is not connected yet. Your draft stays here. Copy and open Codex to paste it there.'

export const MESSAGE_LIMIT = 16_000
