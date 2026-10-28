import type { RelayStatus, Session } from '../../shared/types'
import { relayLine } from '../lib/relay'
import { attentionLine } from './AttentionCard'
import { ContextRing } from './ContextRing'
import styles from './Panel.module.css'

/** A read-only hold preview. The ordinary pages stay mounted underneath it. */
export function ActivePeek({
  sessions,
  relays,
  now,
}: {
  sessions: Session[]
  relays: Map<string, RelayStatus>
  now: number
}) {
  const active = sessions.filter(
    (s) =>
      s.state === 'working' || s.state === 'waiting' || s.unread || now - s.lastActiveAt < 30_000,
  )
  return (
    <section className={styles.peekView} aria-label="Temporary Active threads">
      <header className={styles.header}>
        <span className={styles.heading}>Active · {active.length}</span>
      </header>
      <div className={styles.peekList}>
        {!active.length && <p className={styles.empty}>No active threads</p>}
        {active.map((session) => (
          <div key={session.id} className={styles.row}>
            <div className={`${styles.rowButton} ${styles.peekRow}`}>
              <div className={styles.rowTop}>
                <span className={styles.dotSlot}>
                  <ContextRing
                    used={session.contextUsed}
                    wide={!!session.attention}
                    active={session.state === 'working'}
                    thinking={session.thinking}
                    unread={session.unread}
                  />
                </span>
                <span className={styles.title}>{session.title}</span>
              </div>
              <div className={styles.rowBottom}>
                <span className={styles.stage}>
                  {session.compacting && session.state === 'working'
                    ? session.stage
                    : ((relays.get(session.id)?.state === 'failed'
                        ? relayLine(relays.get(session.id), now)?.text
                        : null) ??
                      (session.attention && attentionLine(session.attention)) ??
                      session.stage)}
                </span>
                {session.attention && <span className={styles.needsYou}>Needs your input</span>}
              </div>
            </div>
            <div className={styles.artifactStrip} aria-hidden />
          </div>
        ))}
      </div>
    </section>
  )
}
