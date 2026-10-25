// Cards Threadlight is holding so the user can answer them here, through the plugin's hooks.
//
// Question cards: the AskUserQuestion hook posts the card and waits. Answering replies with the
// answers in the documented PreToolUse shape, and the session takes them exactly as if they
// were picked in Claude's own card.
// Next steps: the Stop hook posts the end of a turn that asked the user something, and waits.
// Answering replies with the documented `decision: "block"` and the answer as the reason, so
// the same turn carries on with it (Claude Code records it as "Stop hook feedback"). An app
// action (commit, open a PR…) is handed over as an instruction to do that itself.
// Approvals: the PermissionRequest hook posts a tool waiting for permission (a plan to approve
// included). Answering replies with the documented allow or deny decision.
// Session offers: the PreToolUse hook posts a start_session offer before the Claude app shows
// its New session / Do it here card. Answering denies that call with the choice as the reason,
// so the thread starts the session itself or does the work where it is.
//
// While a hook waits, Claude does not show its own card (or finish the turn). A hold lasts until
// it is answered here, or is let go (the hook gets an empty reply and Claude carries on as usual)
// the moment Threadlight closes, the user opens that thread in Claude or presses Answer in
// Claude, or HOLD_MS passes.

import type { NextStepAction } from '../shared/types'

/** The longest Claude's own card is held back; the hooks wait as long (hooks.json). */
export const HOLD_MS = 12 * 60 * 60 * 1000

/** Each answer as Claude expects it: keyed by the full question text. */
export type Answers = Record<string, string>

/** A next-step answer: one of its buttons (by label), or words of the user's own (Other). */
export type NextStepChoice = { label: string } | { text: string }

export type HoldKind = 'question' | 'next-step' | 'approval' | 'offer'

/** What a held card shows beyond its kind: an approval's tool and gist, or an offer's title. */
export interface HeldCard {
  kind: HoldKind
  startedAt: number
  releasesAt: number
  /** An approval's tool (Bash, Edit, ExitPlanMode…). */
  tool: string | null
  /** An approval's command, file or plan; an offer's title. */
  detail: string | null
}

/** What each app action asks the thread to do itself, when picked in Threadlight. */
const APP_ACTIONS: Record<string, string> = {
  commit: 'commit the changes now',
  create_pr: 'push the branch and open a pull request now',
  merge: 'merge the pull request now',
  fix_ci: 'fix the failing CI checks now',
  address_comments: 'address the review comments now',
  resolve_conflicts: 'resolve the merge conflicts now',
  verify: 'verify the change works now, and report what you saw',
  archive: 'say this thread is ready to archive (the user archives it in Claude)',
  new_session: 'propose that work as a new session now',
}

type Result = { ok: true } | { ok: false; reason: string }

interface Hold {
  kind: HoldKind
  sessionId: string
  /** A question card's own input, handed back with the answers added. */
  questions: { question: string }[]
  /** A next step's question and buttons, to word the answer and check the choice. */
  nextStep: { ask: string; actions: NextStepAction[] } | null
  tool: string | null
  detail: string | null
  startedAt: number
  releasesAt: number
  reply: (body: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

const MAX_ANSWER = 4000

/**
 * Added to a next-step answer. The turn carries on rather than a new message arriving, so the
 * Claude app keeps showing the answered box until the thread draws a new one.
 */
const REFRESH_BOX =
  ' When you have done that, if you have the wrap_up tool, call it again so the Claude app replaces the box the user just answered with where things stand now.'

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
    this.start('question', sessionId, reply, { questions: questions as { question: string }[] })
    return true
  }

  /**
   * Holds a tool waiting for permission (PermissionRequest), a plan to approve or a session to
   * start included. A question card has a hold of its own, so it is left alone here. (An offer
   * is held before this, and never reaches it unless it was let go.)
   */
  holdApproval(payload: unknown, reply: (body: string | null) => void): boolean {
    const event = asObject(payload)
    const sessionId = typeof event['session_id'] === 'string' ? event['session_id'] : null
    const tool = typeof event['tool_name'] === 'string' ? event['tool_name'] : null
    if (!sessionId || !tool || tool === 'AskUserQuestion') return false
    this.start('approval', sessionId, reply, {
      tool,
      detail: describeTool(asObject(event['tool_input'])),
    })
    return true
  }

  /** Holds a start_session offer (PreToolUse), before the Claude app shows its own card. */
  holdOffer(payload: unknown, reply: (body: string | null) => void): boolean {
    const event = asObject(payload)
    const sessionId = typeof event['session_id'] === 'string' ? event['session_id'] : null
    const tool = typeof event['tool_name'] === 'string' ? event['tool_name'] : ''
    const input = asObject(event['tool_input'])
    const title = typeof input['title'] === 'string' ? input['title'].trim() : ''
    // Only an offer's first call shows a card; the brief that follows it does not.
    const offer = input['initiation'] === 'offer' && input['proposal_id'] === undefined
    if (!sessionId || !isStartSession(tool) || !offer || !title) return false
    this.start('offer', sessionId, reply, { detail: title.slice(0, 300) })
    return true
  }

  /** Holds the end of a turn that asked the user something (its next-step box). */
  holdNextStep(
    sessionId: string,
    nextStep: { ask: string; actions: NextStepAction[] },
    reply: (body: string | null) => void,
  ): void {
    this.start('next-step', sessionId, reply, {
      nextStep: { ask: nextStep.ask, actions: nextStep.actions },
    })
  }

  /** What the session's hold is, and until when; null if nothing of it is held. */
  held(sessionId: string): HeldCard | null {
    const hold = this.holds.get(sessionId)
    if (!hold) return null
    const { kind, startedAt, releasesAt, tool, detail } = hold
    return { kind, startedAt, releasesAt, tool, detail }
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
   * named by its label and sends that button's own message, never text from the page; an app
   * action's button asks the thread to do that action itself.
   */
  answerNextStep(sessionId: string, choice: unknown): Result {
    const hold = this.holds.get(sessionId)
    const step = hold?.kind === 'next-step' ? hold.nextStep : null
    if (!hold || !step) return gone()
    const picked = typeof choice === 'object' && choice !== null ? (choice as NextStepChoice) : null
    let reason: string
    if (picked && 'label' in picked) {
      const action = step.actions.find((a) => a.label === picked.label)
      const todo = action?.appAction ? APP_ACTIONS[action.appAction] : undefined
      if (action && action.message !== null) {
        reason = `The user answered your question "${step.ask}" in Threadlight, choosing "${action.label}": ${action.message}`
      } else if (action && todo) {
        reason = `The user answered your question "${step.ask}" in Threadlight, choosing "${action.label}" (the Claude app's ${action.appAction} button, which Threadlight cannot press), so ${todo}.`
      } else {
        return { ok: false, reason: 'That answer is not one of the choices.' }
      }
    } else if (picked && 'text' in picked && typeof picked.text === 'string') {
      const text = picked.text.trim()
      if (!text || text.length > MAX_ANSWER) return { ok: false, reason: 'Type an answer first.' }
      reason = `The user answered your question "${step.ask}" in Threadlight, in their own words: ${text}`
    } else {
      return { ok: false, reason: 'That answer is not one of the choices.' }
    }
    this.finish(hold, { decision: 'block', reason: reason + REFRESH_BOX })
    return { ok: true }
  }

  /** Allows or denies a held approval, in the PermissionRequest hook's documented shape. */
  answerApproval(sessionId: string, choice: unknown): Result {
    const hold = this.holds.get(sessionId)
    if (hold?.kind !== 'approval') return gone()
    const picked = asObject(choice)
    if (picked['allow'] === true) {
      this.finish(hold, {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
      })
      return { ok: true }
    }
    if (picked['allow'] !== false) return { ok: false, reason: 'Pick Allow or Deny.' }
    const words = typeof picked['message'] === 'string' ? picked['message'].trim() : ''
    if (words.length > MAX_ANSWER) return { ok: false, reason: 'That reason is too long.' }
    const message = words
      ? `The user denied this in Threadlight, saying: ${words}`
      : 'The user denied this in Threadlight.'
    this.finish(hold, {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message },
      },
    })
    return { ok: true }
  }

  /**
   * Answers a held session offer. The Claude app's card is never shown: the call is denied with
   * the user's choice as the reason, and the thread acts on it.
   */
  answerOffer(sessionId: string, choice: unknown): Result {
    const hold = this.holds.get(sessionId)
    if (hold?.kind !== 'offer') return gone()
    if (choice !== 'new-session' && choice !== 'here') {
      return { ok: false, reason: 'Pick New session or Do it here.' }
    }
    const title = hold.detail ?? ''
    const reason =
      choice === 'new-session'
        ? `The user answered this offer in Threadlight, choosing "New session" (the Claude app's offer card was not shown). Start it now: call start_session again with initiation "user_asked", title "${title}", and a full prompt and background.`
        : `The user answered this offer in Threadlight, choosing "Do it here": do "${title}" in this session yourself, and do not offer it again.`
    this.finish(hold, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
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
    card: Partial<Pick<Hold, 'questions' | 'nextStep' | 'tool' | 'detail'>>,
  ): void {
    this.release(sessionId) // a newer card replaces an older one from the same session
    const startedAt = this.now()
    this.holds.set(sessionId, {
      kind,
      sessionId,
      questions: card.questions ?? [],
      nextStep: card.nextStep ?? null,
      tool: card.tool ?? null,
      detail: card.detail ?? null,
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

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** The Claude app's start_session tool, under whatever its server is named. */
function isStartSession(tool: string): boolean {
  return /^mcp__.*session__start_session$/.test(tool)
}

/** The gist of what a tool wants to do: its command, plan, file or address. */
export function describeTool(input: Record<string, unknown>): string | null {
  const first = ['command', 'plan', 'file_path', 'notebook_path', 'url', 'pattern', 'path']
    .map((key) => input[key])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '')
  if (first) return first.trim().slice(0, MAX_ANSWER)
  const json = JSON.stringify(input)
  return json === '{}' ? null : json.slice(0, 300)
}
