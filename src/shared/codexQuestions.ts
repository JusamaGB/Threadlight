export interface CodexQuestionRef {
  turnId: string
  itemId: string
}

export type CodexQuestionResult = { ok: true } | { ok: false; reason: string; retryable: boolean }
