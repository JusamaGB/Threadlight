export interface NewThreadRequest {
  operationId: string
  provider: 'codex' | 'claude'
  /** An explicitly selected workspace; null creates a fresh folder. */
  cwd: string | null
}

export type NewThreadResult =
  { ok: true; sessionId: string } | { ok: false; reason: string; sessionId?: string }
