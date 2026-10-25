import type { ReactNode } from 'react'

import type { PlanItem, Session } from '../../shared/types'
import { en } from '../i18n/en'
import { clip } from '../lib/format'
import styles from './Panel.module.css'

const MARKS: Record<PlanItem['status'], string> = { completed: '✓', in_progress: '●', pending: '○' }

export function SessionDetail({ session }: { session: Session }) {
  const done = session.plan.filter((item) => item.status === 'completed').length
  const active = session.state !== 'idle'
  const status = en.state[session.state] + (session.tracked ? '' : ` · ${en.state.guessed}`)
  const appId = session.appId

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <span className={styles.status} data-state={session.state}>
          {status}
        </span>
        {appId && (
          <button className={styles.link} onClick={() => window.threadlight.openInClaude(appId)}>
            {en.detail.open}
          </button>
        )}
      </div>
      {session.cwd && <div className={styles.cwd}>{session.cwd}</div>}

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
                <span className={styles.mark}>{MARKS[item.status]}</span>
                {item.content}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {active && session.lastAction && (
        <Section label={en.detail.now}>
          <p className={styles.strong}>{session.lastAction}</p>
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

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>{label}</h3>
      {children}
    </section>
  )
}
