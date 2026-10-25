import type { ReactNode } from 'react'

import { elapsedText } from '../../shared/elapsed'
import type { PlanItem, RelayStatus, Session } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { gitLine } from '../lib/git'
import { en } from '../i18n/en'
import { clip } from '../lib/format'
import { relayLine } from '../lib/relay'
import styles from './Panel.module.css'

const MARKS: Record<PlanItem['status'], string> = { completed: '✓', in_progress: '●', pending: '○' }

interface SessionDetailProps {
  session: Session
  relay: RelayStatus | undefined
  now: number
}

export function SessionDetail({ session, relay, now }: SessionDetailProps) {
  const done = session.plan.filter((item) => item.status === 'completed').length
  const active = session.state !== 'idle'
  const status = en.state[session.state] + (session.tracked ? '' : ` · ${en.state.guessed}`)
  const message = relayLine(relay, now)

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <span className={styles.status} data-state={session.state}>
          {status}
        </span>
        {/* The workspace folder; Open ↗ sits on the row's top line instead. */}
        {session.cwd && (
          <span className={styles.cwd} title={session.cwd}>
            {session.cwd}
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

      {session.plan.length > 0 && (
        <Section label={en.detail.plan(done, session.plan.length)}>
          <ul className={styles.plan}>
            {session.plan.map((item, index) => (
              <li key={index} data-status={item.status}>
                {item.status === 'in_progress' ? (
                  // The step being worked on spins, as in Claude's own task list.
                  <span className={styles.mark} aria-label={en.detail.inProgress}>
                    <span className={styles.spinner} />
                  </span>
                ) : (
                  <span className={styles.mark}>{MARKS[item.status]}</span>
                )}
                {item.content}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {active && session.lastAction && (
        <Section label={en.detail.now}>
          <p className={styles.strong}>
            {session.lastAction}
            {session.turnStartedAt !== null && <Elapsed since={session.turnStartedAt} />}
          </p>
        </Section>
      )}

      {session.recap ? (
        <Section label={en.detail.result}>
          <p>{clip(session.recap, 320)}</p>
        </Section>
      ) : (
        !active &&
        session.lastReply && (
          <Section label={en.detail.lastReply}>
            <p>{clip(session.lastReply, 220)}</p>
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

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>{label}</h3>
      {children}
    </section>
  )
}
