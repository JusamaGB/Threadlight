// Question cards Threadlight is holding for the user to answer here.
//
// When a session asks a question card (AskUserQuestion), the plugin's hook posts it to the hook
// server and waits for the reply. While it waits, the Claude app does not show its own card, so
// a hold must never outstay its welcome: it is let go (the hook gets an empty reply and Claude
// shows its card as usual) the moment Threadlight closes, the user opens that thread in Claude
// or presses Answer in Claude, or HOLD_MS passes. Answering here replies with the answers in the
// documented PreToolUse shape, and the session takes them exactly as if picked in Claude.

/** The longest Claude's own card is held back. */
export const HOLD_MS = 60_000

/** Each answer as Claude expects it: keyed by the full question text. */
export type Answers = Record<string, string>

interface Hold {
  sessionId: string
  /** The tool's own input, handed back with the answers added. */
  questions: { question: string }[]
  startedAt: number
  releasesAt: number
  reply: (body: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

export class QuestionHolds {
  private holds = new Map<string, Hold>()

  constructor(
    private readonly onChange: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Holds a question card posted by the hook. Returns false (and the hook should be answered
   * empty at once) when it is not a question card Threadlight understands.
   */
  hold(payload: unknown, reply: (body: string | null) => void): boolean {
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

    this.release(sessionId) // a newer card replaces an older one from the same session
    const startedAt = this.now()
    const hold: Hold = {
      sessionId,
      questions: questions as { question: string }[],
      startedAt,
      releasesAt: startedAt + HOLD_MS,
      reply,
      timer: setTimeout(() => this.release(sessionId), HOLD_MS),
    }
    this.holds.set(sessionId, hold)
    this.onChange()
    return true
  }

  /** When the session's card is being held here, and until when. */
  held(sessionId: string): { startedAt: number; releasesAt: number } | null {
    const hold = this.holds.get(sessionId)
    return hold ? { startedAt: hold.startedAt, releasesAt: hold.releasesAt } : null
  }

  sessionIds(): string[] {
    return [...this.holds.keys()]
  }

  /** Hands the answers to the waiting hook. Every answer must be for one of the questions. */
  answer(sessionId: string, answers: unknown): { ok: true } | { ok: false; reason: string } {
    const hold = this.holds.get(sessionId)
    if (!hold)
      return { ok: false, reason: 'This question is no longer waiting here. Answer it in Claude.' }
    const asked = new Set(hold.questions.map((q) => q.question))
    const given =
      typeof answers === 'object' && answers !== null ? Object.entries(answers as object) : []
    if (
      given.length === 0 ||
      !given.every(
        ([question, value]) =>
          asked.has(question) && typeof value === 'string' && value.length <= 4000,
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

  /** Lets the card go: the hook answers empty and Claude shows its own card. */
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

  private finish(hold: Hold, output: object | null): void {
    clearTimeout(hold.timer)
    this.holds.delete(hold.sessionId)
    hold.reply(output ? JSON.stringify(output) : null)
    this.onChange()
  }
}
