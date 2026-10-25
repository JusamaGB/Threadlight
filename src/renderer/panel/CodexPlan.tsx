import type { Session } from '../../shared/types'
import styles from './Panel.module.css'

/** Safe, small plan formatting: text stays text, including any HTML in a plan. */
function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    )
}

export function CodexPlan({ session }: { session: Session }) {
  if (!session.plan.length && !session.planText) return null
  const done = session.plan.filter((step) => step.status === 'completed').length
  return (
    <section className={styles.section} aria-label="Codex plan">
      <h3 className={styles.sectionLabel}>
        {session.plan.length ? `Plan ${done}/${session.plan.length}` : 'Proposed plan'}
      </h3>
      {session.plan.length > 0 && (
        <ul className={styles.plan}>
          {session.plan.map((step, i) => (
            <li key={i} data-status={step.status}>
              <span className={styles.planStep}>
                <span className={styles.mark} aria-label={step.status.replace('_', ' ')}>
                  {step.status === 'in_progress' ? (
                    <span className={styles.spinner} />
                  ) : step.status === 'completed' ? (
                    '✓'
                  ) : (
                    '○'
                  )}
                </span>
                {step.content}
              </span>
            </li>
          ))}
        </ul>
      )}
      {session.planText && (
        <div className={styles.proposedPlan}>
          {session.planText.split('\n').map((line, i) => {
            if (!line.trim()) return null
            const heading = line.match(/^#{1,6}\s+(.+)/)
            if (heading) return <h4 key={i}>{inline(heading[1]!)}</h4>
            const bullet = line.match(/^\s*(?:[-*+] |\d+\. )(.+)/)
            return (
              <p key={i} className={bullet ? styles.planBullet : undefined}>
                {bullet ? '• ' : ''}
                {inline(bullet?.[1] ?? line)}
              </p>
            )
          })}
        </div>
      )}
    </section>
  )
}
