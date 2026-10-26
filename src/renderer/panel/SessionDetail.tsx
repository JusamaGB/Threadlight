import { useState, type ReactNode } from 'react'

import { elapsedText } from '../../shared/elapsed'
import type { PlanItem, RelayStatus, Session } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { gitLine } from '../lib/git'
import { en } from '../i18n/en'
import { clip } from '../lib/format'
import { displayWindowsPath } from '../../shared/displayPath'

/** The reply as the row's line shows it (whitespace collapsed), to tell it is being written. */
const oneLineText = (text: string) => text.split(/\s+/).filter(Boolean).join(' ')
import { relayLine } from '../lib/relay'
import styles from './Panel.module.css'
import { StepView } from './StepView'
import { CodexPlan } from './CodexPlan'

const MARKS: Record<PlanItem['status'], string> = { completed: '✓', in_progress: '●', pending: '○' }

interface SessionDetailProps {
  session: Session
  relay: RelayStatus | undefined
  now: number
}

export function SessionDetail({ session, relay, now }: SessionDetailProps) {
  const done = session.plan.filter((item) => item.status === 'completed').length
  const active = session.state !== 'idle'
  const unavailable = session.provider === 'codex' && !session.tracked
  const status = unavailable
    ? 'Status unavailable'
    : en.state[session.state] + (session.tracked ? '' : ` · ${en.state.guessed}`)
  const cwd = session.provider === 'codex' ? displayWindowsPath(session.cwd) : session.cwd
  const message = relayLine(relay, now)
  // The plan step opened to show what was done on it, by its text.
  const [openStep, setOpenStep] = useState<string | null>(null)

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <span
          className={styles.status}
          data-state={unavailable ? 'unknown' : session.state}
          title={
            unavailable ? 'No current hook or verified Codex turn status is available.' : undefined
          }
        >
          {status}
        </span>
        {/* The workspace folder; Open ↗ sits on the row's top line instead. */}
        {session.cwd && (
          <span className={styles.cwd} title={cwd}>
            {cwd}
          </span>
        )}
      </div>
      {/* Where its git folder stands: branch, to push, behind main, worktrees. */}
      {session.git && <div className={styles.gitLine}>{gitLine(session.git)}</div>}

      {message && (
        <Section label={en.detail.yourMessage}>
          <p data-tone={message.tone}>{clip(message.text, 320)}</p>
        </Section>
      )}

      {session.lastPrompt && (
        <Section label={en.detail.asked}>
          <p className={styles.strong}>{clip(session.lastPrompt, 180)}</p>
        </Section>
      )}

      {session.provider === 'codex' && <CodexPlan session={session} />}
      {session.provider !== 'codex' && session.plan.length > 0 && (
        <Section label={en.detail.plan(done, session.plan.length)}>
          <ul className={styles.plan}>
            {session.plan.map((item, index) => (
              <li key={index} data-status={item.status}>
                <button
                  className={styles.planStep}
                  aria-expanded={openStep === item.content}
                  onClick={() => setOpenStep(openStep === item.content ? null : item.content)}
                >
                  {item.status === 'in_progress' ? (
                    // The step being worked on spins, as in Claude's own task list.
                    <span className={styles.mark} aria-label={en.detail.inProgress}>
                      <span className={styles.spinner} />
                    </span>
                  ) : (
                    <span className={styles.mark}>{MARKS[item.status]}</span>
                  )}
                  {item.content}
                </button>
                {openStep === item.content && (
                  <StepView
                    sessionId={session.id}
                    item={item}
                    cwd={session.cwd}
                    gitRoot={session.git?.root ?? null}
                    version={session.lastActiveAt}
                  />
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {active && (session.lastAction || session.thinking) && (
        <Section
          label={en.detail.now}
          extra={session.turnStartedAt !== null && <Elapsed since={session.turnStartedAt} />}
        >
          <p className={styles.strong}>
            {session.thinking ? en.detail.thinking : session.lastAction}
          </p>
        </Section>
      )}

      {session.recap ? (
        <Section label={en.detail.result}>
          <p>{clip(session.recap, 320)}</p>
        </Section>
      ) : (
        session.lastReply &&
        (!active || session.stage === oneLineText(session.lastReply)) && (
          // The whole reply, scrolling within the card; it is often the turn's only output.
          <Section label={en.detail.lastReply}>
            <p className={styles.reply}>{session.lastReply.trim()}</p>
          </Section>
        )
      )}
    </div>
  )
}

/** How long the current turn has been going, counting every second, as Claude's thread shows. */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000)
  return <span className={styles.elapsed}>{elapsedText(since, now)}</span>
}

function Section({
  label,
  extra,
  children,
}: {
  label: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>
        {label}
        {extra}
      </h3>
      {children}
    </section>
  )
}
