import { useEffect, useState } from 'react'

import { elapsedText } from '../../shared/elapsed'
import type { PlanStatus, StepActivity } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { clip } from '../lib/format'
import styles from './Panel.module.css'

interface StepViewProps {
  sessionId: string
  step: string
  status: PlanStatus
  /** The thread's working folder, so file paths read short. */
  cwd: string | null
  /** Changes whenever the thread does something, so a step in progress keeps up. */
  version: number
}

/**
 * What a thread did on one plan step, under the step when it is clicked: how long it took, the
 * files it changed, the commands it ran (✗ for a failed one), the other tools it used and what
 * it last said. Read from the thread's transcript each time it changes.
 */
export function StepView({ sessionId, step, status, cwd, version }: StepViewProps) {
  const now = useNow(1000)
  const [activity, setActivity] = useState<StepActivity | null | undefined>(undefined)

  useEffect(() => {
    if (status === 'pending') return
    let live = true
    void window.threadlight.getStepActivity(sessionId, step).then((found) => {
      if (live) setActivity(found)
    })
    return () => {
      live = false
    }
  }, [sessionId, step, status, version])

  if (status === 'pending') return <p className={styles.stepNote}>{en.step.notStarted}</p>
  if (activity === undefined) return <p className={styles.stepNote}>{en.step.reading}</p>
  if (activity === null) return <p className={styles.stepNote}>{en.step.unreadable}</p>

  const { startedAt, endedAt, files, commands, tools, said } = activity
  const empty = !files.length && !commands.length && !tools.length && !said.length
  const time =
    startedAt === null
      ? null
      : endedAt !== null
        ? en.step.took(elapsedText(startedAt, endedAt))
        : status === 'in_progress'
          ? en.step.running(elapsedText(startedAt, now))
          : null

  return (
    <div className={styles.step}>
      {time && <p className={styles.stepNote}>{time}</p>}
      {empty && <p className={styles.stepNote}>{en.step.nothing}</p>}
      {files.length > 0 && (
        <ul className={styles.stepList} aria-label={en.step.files}>
          {files.map((file) => (
            <li key={file.path} title={file.path}>
              <span className={styles.stepName}>{shortPath(file.path, cwd)}</span>
              {file.added > 0 && <span className={styles.added}>+{file.added}</span>}
              {file.removed > 0 && <span className={styles.removed}>−{file.removed}</span>}
            </li>
          ))}
        </ul>
      )}
      {commands.length > 0 && (
        <ul className={styles.stepList} aria-label={en.step.commands}>
          {commands.map((command, index) => (
            <li key={index} title={command.command} data-failed={command.failed || undefined}>
              <span className={styles.stepMark}>
                {command.failed === null ? '…' : command.failed ? '✗' : '✓'}
              </span>
              <span className={styles.stepName}>{command.label}</span>
            </li>
          ))}
        </ul>
      )}
      {tools.length > 0 && (
        <p className={styles.stepNote}>
          {tools
            .map((tool) => (tool.count > 1 ? `${tool.name} ×${tool.count}` : tool.name))
            .join(' · ')}
        </p>
      )}
      {said.length > 0 && <p className={styles.stepSaid}>{clip(said[said.length - 1]!, 320)}</p>}
    </div>
  )
}

/** A path inside the thread's folder, from there; anything else by its last two parts. */
function shortPath(path: string, cwd: string | null): string {
  const norm = path.replaceAll('\\', '/')
  const root = cwd?.replaceAll('\\', '/').replace(/\/+$/, '')
  if (root && norm.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return norm.slice(root.length + 1)
  }
  return norm.split('/').slice(-2).join('/')
}
