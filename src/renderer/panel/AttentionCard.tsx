import { useEffect, useRef, useState, type ReactNode } from 'react'

import type {
  Attention,
  CardQuestion,
  NextStepAction,
  RelayStatus,
  Session,
} from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { clip } from '../lib/format'
import styles from './Panel.module.css'

interface AttentionCardProps {
  session: Session
  attention: Attention
  /** The thread's background send, if one is under way or just finished. */
  relay: RelayStatus | undefined
  /** Opens Threadlight's composer on this thread, for an answer of your own (Other). */
  onCompose: () => void
}

/**
 * What an expanded thread shows while it waits on the user, drawn like the Claude app's own
 * question card: the question on top, radio rows for the answers (the recommended one picked
 * to start with), then the buttons. A next-step box's answers are sent to the thread from here;
 * a question card and an approval can only be answered inside Claude, so they open it there.
 */
export function AttentionCard({ session, attention, relay, onCompose }: AttentionCardProps) {
  const open = () => session.appId && window.threadlight.openInClaude(session.appId)
  switch (attention.kind) {
    case 'next-step':
      return (
        <NextStepCard
          session={session}
          attention={attention}
          relay={relay}
          onOpen={open}
          onCompose={onCompose}
        />
      )
    case 'question':
      return (
        <QuestionCard
          session={session}
          questions={attention.questions}
          answerableUntil={attention.answerableUntil}
          onOpen={open}
        />
      )
    case 'approval':
      return <ApprovalCard session={session} action={attention.action} onOpen={open} />
  }
}

/** Ctrl+Enter presses the card's main button, as in Claude (but not while typing). */
function useCtrlEnter(action: () => void) {
  const latest = useRef(action)
  useEffect(() => {
    latest.current = action
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing in the composer is left alone; the card's own Other box counts as the card.
      const target = event.target instanceof HTMLElement ? event.target : null
      const typing = target?.closest('textarea, input') && !target.closest('[data-answer]')
      if (event.key !== 'Enter' || !event.ctrlKey || typing) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * The end-of-turn question, answered whichever way can reach the thread:
 * - Threadlight holds the turn's end (`answerableUntil`): Send hands the picked answer (or
 *   Other's own words) back, and the same turn carries on with it.
 * - Claude has the thread open but nothing is held (it started before the plugin's Stop hook):
 *   a background send would be refused, so the answer is copied and the thread opened, to paste.
 * - Otherwise Send puts the answer's message into the thread in the background, and the card
 *   follows that send: locked while it goes, open again with the reason if it fails.
 */
function NextStepCard({
  session,
  attention,
  relay,
  onOpen,
  onCompose,
}: {
  session: Session
  attention: Extract<Attention, { kind: 'next-step' }>
  relay: RelayStatus | undefined
  onOpen: () => void
  onCompose: () => void
}) {
  const OTHER = -1
  const [picked, setPicked] = useState(0) // the first answer is the recommended one
  const [other, setOther] = useState('')
  const [sending, setSending] = useState(false)
  /** Handed back to the held turn, or copied: done from here. */
  const [done, setDone] = useState<'answered' | 'copied' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const action: NextStepAction | undefined = attention.actions[picked]
  const answerable = attention.answerableUntil !== null
  const copyAndOpen = !answerable && session.live
  // A background send in flight locks the card; a failed one says why and opens it again.
  const relaying = relay?.state === 'sending' || relay?.state === 'sent'
  const failed = relay?.state === 'failed' ? relay.detail : null
  const locked = done === 'answered' || relaying

  const go = async () => {
    if (sending || locked) return
    const own = picked === OTHER || !action
    // An app action (commit, open a PR…) can only be done in the Claude app itself.
    if (!own && action.message === null) return onOpen()
    if (copyAndOpen) {
      if (!own) window.threadlight.copyText(action.message!)
      setDone('copied')
      return onOpen() // Other: type it there
    }
    if (own && !answerable) return onCompose()
    if (own && !other.trim()) return setError(en.attention.typeOther)
    setSending(true)
    const result = answerable
      ? await window.threadlight.answerNextStep(
          session.id,
          own ? { text: other } : { label: action.label },
        )
      : await window.threadlight.sendMessage(session.id, action!.message!)
    setSending(false)
    if (result.ok && answerable) setDone('answered')
    setError(result.ok ? null : result.reason)
  }
  useCtrlEnter(() => void go())

  const own = picked === OTHER || !action
  const label = locked
    ? en.attention.sent
    : !own && action.message === null
      ? en.attention.doInClaude
      : copyAndOpen
        ? own
          ? en.attention.answerInClaude
          : en.attention.copyAndOpen
        : own && !answerable
          ? en.attention.writeReply
          : en.attention.send

  return (
    <div className={styles.qCard}>
      <div className={styles.qHead}>
        <div className={styles.qHeadText}>
          {attention.recap && <p className={styles.qRecap}>{clip(attention.recap, 320)}</p>}
          <p className={styles.qText}>{attention.ask}</p>
        </div>
      </div>
      {attention.actions.map((option, index) => (
        <OptionRow
          key={option.label}
          checked={picked === index}
          label={option.label + (option.message === null ? ' ↗' : '')}
          description={
            option.message !== null && option.message !== option.label ? option.message : ''
          }
          disabled={locked}
          onPick={() => setPicked(index)}
        />
      ))}
      <OptionRow
        checked={picked === OTHER}
        label={en.attention.other}
        description=""
        disabled={locked}
        onPick={() => setPicked(OTHER)}
      />
      {answerable && picked === OTHER && (
        <input
          className={styles.qOther}
          data-answer=""
          autoFocus
          disabled={locked}
          placeholder={en.attention.otherPlaceholder}
          value={other}
          onChange={(event) => {
            setOther(event.target.value)
            setError(null)
          }}
        />
      )}
      <Buttons>
        <MainButton label={label} disabled={sending || locked} onClick={() => void go()} />
        {(error ?? failed) && <p className={styles.qError}>{error ?? failed}</p>}
        {done === 'copied' && <p className={styles.qNote}>{en.attention.copied}</p>}
        {copyAndOpen && !done && <p className={styles.qNote}>{en.attention.openInClaudeNote}</p>}
        {attention.answerableUntil !== null && !locked && (
          <HoldNote until={attention.answerableUntil} kind="next-step" />
        )}
      </Buttons>
    </div>
  )
}

/**
 * The Claude app's question card, one question at a time with "‹ 1 of 2 ›" to move between
 * them, then Skip and Next. While Threadlight holds the card (`answerableUntil`), the picks are
 * collected across every question and Submit hands them all over at once, as the real answer.
 * Otherwise the paused turn takes its answer in Claude, so the last Next opens it there.
 */
function QuestionCard({
  session,
  questions,
  answerableUntil,
  onOpen,
}: {
  session: Session
  questions: CardQuestion[]
  answerableUntil: number | null
  onOpen: () => void
}) {
  const [index, setIndex] = useState(0)
  const [picks, setPicks] = useState<Record<number, string[]>>({})
  const [others, setOthers] = useState<Record<number, string>>({})
  const [skipped, setSkipped] = useState<Record<number, boolean>>({})
  const [sending, setSending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answerable = answerableUntil !== null
  const last = index === questions.length - 1

  const pickedFor = (i: number): string[] => {
    const recommended = questions[i]?.options.find((option) => option.recommended)?.label
    return picks[i] ?? (recommended ? [recommended] : [])
  }

  /** Every question's answer, keyed by its text; null (with the reason shown) if one is missing. */
  const collect = (skipping: Record<number, boolean>): Record<string, string> | null => {
    const answers: Record<string, string> = {}
    for (const [i, q] of questions.entries()) {
      if (skipping[i]) {
        answers[q.question] = en.attention.skipped
        continue
      }
      const chosen = pickedFor(i).map((label) =>
        label === en.attention.other ? (others[i] ?? '').trim() : label,
      )
      if (chosen.length === 0 || chosen.some((answer) => !answer)) {
        setIndex(i)
        setError(chosen.length === 0 ? en.attention.pickOne : en.attention.typeOther)
        return null
      }
      answers[q.question] = chosen.join(', ')
    }
    return answers
  }

  const submit = async (skipping: Record<number, boolean>) => {
    const answers = collect(skipping)
    if (!answers || sending) return
    setSending(true)
    const result = await window.threadlight.answerQuestion(session.id, answers)
    setSending(false)
    // On success the session carries on, and this card clears with the next scan.
    setSubmitted(result.ok)
    setError(result.ok ? null : result.reason)
  }

  const forward = (skip = false) => {
    if (submitted) return
    const skipping = { ...skipped, [index]: skip }
    setSkipped(skipping)
    setError(null)
    if (!last) return setIndex(index + 1)
    if (answerable) void submit(skipping)
    else onOpen()
  }
  useCtrlEnter(() => forward())

  const question = questions[index]
  if (!question) return null
  const picked = pickedFor(index)
  const pick = (label: string) => {
    const chosen = question.multiSelect
      ? picked.includes(label)
        ? picked.filter((p) => p !== label)
        : [...picked, label]
      : [label]
    setPicks({ ...picks, [index]: chosen })
    setError(null)
  }
  const rows = [
    ...question.options,
    { label: en.attention.other, description: '', recommended: false },
  ]

  return (
    <div className={styles.qCard}>
      <div className={styles.qHead}>
        <p className={`${styles.qText} ${styles.qHeadText}`}>{question.question}</p>
        {questions.length > 1 && (
          <span className={styles.qPager}>
            <button
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
              aria-label={en.attention.previous}
            >
              ‹
            </button>
            {en.attention.position(index + 1, questions.length)}
            <button
              disabled={last}
              onClick={() => setIndex(index + 1)}
              aria-label={en.attention.next}
            >
              ›
            </button>
          </span>
        )}
      </div>
      {rows.map((option) => (
        <OptionRow
          key={option.label}
          checked={picked.includes(option.label)}
          square={question.multiSelect}
          label={option.label + (option.recommended ? ` (${en.attention.recommended})` : '')}
          description={option.description}
          onPick={() => pick(option.label)}
        />
      ))}
      {answerable && picked.includes(en.attention.other) && (
        <input
          className={styles.qOther}
          data-answer=""
          autoFocus
          placeholder={en.attention.otherPlaceholder}
          value={others[index] ?? ''}
          onChange={(event) => {
            setOthers({ ...others, [index]: event.target.value })
            setError(null)
          }}
        />
      )}
      <Buttons>
        <button className={styles.qSkip} disabled={sending} onClick={() => forward(true)}>
          {en.attention.skip}
        </button>
        <MainButton
          label={
            submitted
              ? en.attention.sent
              : !last
                ? en.attention.next
                : answerable
                  ? en.attention.submit
                  : en.attention.answerInClaude
          }
          disabled={sending || submitted || (last && !answerable && !session.appId)}
          onClick={() => forward()}
        />
        {error && <p className={styles.qError}>{error}</p>}
        {answerableUntil !== null && !submitted && (
          <HoldNote until={answerableUntil} kind="question" />
        )}
      </Buttons>
    </div>
  )
}

/** While Threadlight holds the card: Claude carries on by itself after this many seconds. */
function HoldNote({ until, kind }: { until: number; kind: 'question' | 'next-step' }) {
  const now = useNow(1000)
  const seconds = Math.max(0, Math.ceil((until - now) / 1000))
  const note = kind === 'question' ? en.attention.holdNote : en.attention.holdStepNote
  return <p className={styles.qNote}>{note(seconds)}</p>
}

/** A tool waiting for approval: what it wants to do, answered in Claude. */
function ApprovalCard({
  session,
  action,
  onOpen,
}: {
  session: Session
  action: string | null
  onOpen: () => void
}) {
  useCtrlEnter(onOpen)
  return (
    <div className={styles.qCard}>
      <div className={styles.qHead}>
        <div className={styles.qHeadText}>
          <p className={styles.qText}>{en.attention.approval}</p>
          {action && <p className={styles.qRecap}>{action}</p>}
        </div>
      </div>
      <Buttons>
        <MainButton
          label={en.attention.answerInClaude}
          disabled={!session.appId}
          onClick={onOpen}
        />
      </Buttons>
    </div>
  )
}

function OptionRow(props: {
  checked: boolean
  disabled?: boolean
  square?: boolean
  label: string
  description: string
  onPick: () => void
}) {
  return (
    <button
      className={styles.qOption}
      role={props.square ? 'checkbox' : 'radio'}
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={props.onPick}
    >
      <span className={props.square ? `${styles.qMark} ${styles.square}` : styles.qMark} />
      <span className={styles.qBody}>
        <span className={styles.qLabel}>{props.label}</span>
        {props.description && <span className={styles.qDesc}>{props.description}</span>}
      </span>
    </button>
  )
}

function Buttons({ children }: { children: ReactNode }) {
  return <div className={styles.qButtons}>{children}</div>
}

/** The light button at the bottom, with the Ctrl ⏎ hint Claude's card shows. */
function MainButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={styles.qNext} disabled={props.disabled} onClick={props.onClick}>
      {props.label}
      <kbd className={styles.qKeys}>Ctrl</kbd>
      <kbd className={styles.qKeys}>⏎</kbd>
    </button>
  )
}

/** The line under a collapsed thread's title while it waits: what it is asking. */
export function attentionLine(attention: Attention): string | null {
  switch (attention.kind) {
    case 'next-step':
      return attention.ask
    case 'question':
      return attention.questions[0]?.question ?? null
    case 'approval':
      return null // the stage line already says "Needs approval · …"
  }
}
