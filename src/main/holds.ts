// Cards Threadlight is holding so the user can answer them here, through the plugin's hooks.
//
// Question cards: the AskUserQuestion hook posts the card and waits. Answering replies with the
// answers in the documented PreToolUse shape, and the session takes them exactly as if they
// were picked in Claude's own card.
// Next steps: the Stop hook posts the end of a turn that asked the user something, and waits.
// Answering replies with the documented `decision: "block"` and the answer as the reason, so
// the same turn carries on with it (Claude Code records it as "Stop hook feedback").
//
// While a hook waits, Claude does not show its own card (or finish the turn), so a hold must
// never outstay its welcome: it is let go (the hook gets an empty reply and Claude carries on as
// usual) the moment Threadlight closes, the user opens that thread in Claude or presses Answer in
// Claude, or HOLD_MS passes.

import type { NextStepAction } from '../shared/types'

/** The longest Claude's own card is held back. */
export const HOLD_MS = 60_000

/** Each answer as Claude expects it: keyed by the full question text. */
export type Answers = Record<string, string>

/** A next-step answer: one of its buttons (by label), or words of the user's own (Other). */
export type NextStepChoice = { label: string } | { text: string }

export type HoldKind = 'question' | 'next-step'

type Result = { ok: true } | { ok: false; reason: string }

interface Hold {
  kind: HoldKind
  sessionId: string
  /** A question card's own input, handed back with the answers added. */
  questions: { question: string }[]
  /** A next step's question and buttons, to word the answer and check the choice. */
  nextStep: { ask: string; actions: NextStepAction[] } | null
  startedAt: number
  releasesAt: number
  reply: (body: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

const MAX_ANSWER = 4000

export class Holds {
  private holds = new Map<string, Hold>()

  constructor(
    private readonly onChange: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Holds a question card posted by the hook. Returns false (and the hook should be answered
   * empty at once) when it is not a question card Threadlight understands.
   */
  holdQuestion(payload: unknown, reply: (body: string | null) => void): boolean {
    const event = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >
    const sessionId = typeof event['session_id'] === 'string' ? event['session_id'] : null
    const input = event['tool_input'] as { questions?: unknown } | undefined
    const questions = Array.isArray(input?.questions) ? input.questions : null
    const valid =
      event['tool_name'] === 'AskUserQuestion' &&
      sessionId !== null &&
      questions !== null &&
      questions.length > 0 &&
      questions.every(
        (q) =>
          typeof q === 'object' &&
          q !== null &&
          typeof (q as { question?: unknown }).question === 'string',
      )
    if (!valid) return false
    this.start('question', sessionId, reply, questions as { question: string }[], null)
    return true
  }

  /** Holds the end of a turn that asked the user something (its next-step box). */
  holdNextStep(
    sessionId: string,
    nextStep: { ask: string; actions: NextStepAction[] },
    reply: (body: string | null) => void,
  ): void {
    this.start('next-step', sessionId, reply, [], {
      ask: nextStep.ask,
      actions: nextStep.actions,
    })
  }

  /** What the session's hold is, and until when; null if nothing of it is held. */
  held(sessionId: string): { kind: HoldKind; startedAt: number; releasesAt: number } | null {
    const hold = this.holds.get(sessionId)
    return hold ? { kind: hold.kind, startedAt: hold.startedAt, releasesAt: hold.releasesAt } : null
  }

  sessionIds(): string[] {
    return [...this.holds.keys()]
  }

  /** Hands a question card's answers to its hook. Every answer must be for one of its questions. */
  answerQuestion(sessionId: string, answers: unknown): Result {
    const hold = this.holds.get(sessionId)
    if (hold?.kind !== 'question') return gone()
    const asked = new Set(hold.questions.map((q) => q.question))
    const given =
      typeof answers === 'object' && answers !== null ? Object.entries(answers as object) : []
    if (
      given.length === 0 ||
      !given.every(
        ([question, value]) =>
          asked.has(question) && typeof value === 'string' && value.length <= MAX_ANSWER,
      )
    ) {
      return { ok: false, reason: 'Those answers do not fit this question card.' }
    }
    this.finish(hold, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { questions: hold.questions, answers: Object.fromEntries(given) },
      },
    })
    return { ok: true }
  }

  /**
   * Hands a next step's answer to the Stop hook, so the turn carries on with it. A button is
   * named by its label and sends that button's own message, never text from the page.
   */
  answerNextStep(sessionId: string, choice: unknown): Result {
    const hold = this.holds.get(sessionId)
    const step = hold?.kind === 'next-step' ? hold.nextStep : null
    if (!hold || !step) return gone()
    const picked = typeof choice === 'object' && choice !== null ? (choice as NextStepChoice) : null
    let reason: string
    if (picked && 'label' in picked) {
      const action = step.actions.find((a) => a.label === picked.label && a.message !== null)
      if (!action) return { ok: false, reason: 'That answer is not one of the choices.' }
      reason = `The user answered your question "${step.ask}" in Threadlight, choosing "${action.label}": ${action.message}`
    } else if (picked && 'text' in picked && typeof picked.text === 'string') {
      const text = picked.text.trim()
      if (!text || text.length > MAX_ANSWER) return { ok: false, reason: 'Type an answer first.' }
      reason = `The user answered your question "${step.ask}" in Threadlight, in their own words: ${text}`
    } else {
      return { ok: false, reason: 'That answer is not one of the choices.' }
    }
    this.finish(hold, { decision: 'block', reason })
    return { ok: true }
  }

  /** Lets the card go: the hook answers empty and Claude carries on as usual. */
  release(sessionId: string): void {
    const hold = this.holds.get(sessionId)
    if (hold) this.finish(hold, null)
  }

  releaseAll(): void {
    for (const hold of [...this.holds.values()]) this.finish(hold, null)
  }

  /** The hook gave up waiting (its session was stopped, or curl timed out): forget it quietly. */
  dropped(reply: (body: string | null) => void): void {
    const hold = [...this.holds.values()].find((h) => h.reply === reply)
    if (!hold) return
    clearTimeout(hold.timer)
    this.holds.delete(hold.sessionId)
    this.onChange()
  }

  private start(
    kind: HoldKind,
    sessionId: string,
    reply: (body: string | null) => void,
    questions: { question: string }[],
    nextStep: Hold['nextStep'],
  ): void {
    this.release(sessionId) // a newer card replaces an older one from the same session
    const startedAt = this.now()
    this.holds.set(sessionId, {
      kind,
      sessionId,
      questions,
      nextStep,
      startedAt,
      releasesAt: startedAt + HOLD_MS,
      reply,
      timer: setTimeout(() => this.release(sessionId), HOLD_MS),
    })
    this.onChange()
  }

  private finish(hold: Hold, output: object | null): void {
    clearTimeout(hold.timer)
    this.holds.delete(hold.sessionId)
    hold.reply(output ? JSON.stringify(output) : null)
    this.onChange()
  }
}

function gone(): Result {
  return { ok: false, reason: 'This is no longer waiting here. Answer it in Claude.' }
}
