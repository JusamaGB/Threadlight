export interface CodexQuestionRef {
  turnId: string
  itemId: string
  /** Binds the draft to the current wording and the still-unanswered parts of this item. */
  generation?: string
}

export type CodexQuestionResult = { ok: true } | { ok: false; reason: string; retryable: boolean }
