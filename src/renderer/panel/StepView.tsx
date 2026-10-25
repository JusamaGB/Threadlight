import { useEffect, useState } from 'react'

import { elapsedText } from '../../shared/elapsed'
import type { PlanItem, StepActivity } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { clip } from '../lib/format'
import { fileRows, type FileRow } from '../../shared/stepFiles'
import styles from './Panel.module.css'

interface StepViewProps {
  sessionId: string
  item: PlanItem
  /** The thread's working folder, so file paths read short. */
  cwd: string | null
  /** Changes whenever the thread does something, so a step in progress keeps up. */
  version: number
}

/**
 * What a thread did on one plan step, under the step when it is clicked: why the step is there,
 * how long it took, its files (the ones planned next to the ones changed), the commands it ran
 * (✗ for a failed one), the other tools it used and what it last said. Read from the thread's
 * transcript each time it changes.
 */
export function StepView({ sessionId, item, cwd, version }: StepViewProps) {
  const { content: step, status } = item
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

  const why = item.why && <p className={styles.stepWhy}>{item.why}</p>
  const planned = item.files ?? []
  if (status === 'pending') {
    return (
      <div className={styles.step}>
        {why}
        <FileList rows={fileRows(planned, [], cwd)} cwd={cwd} pending />
        <p className={styles.stepNote}>{en.step.notStarted}</p>
      </div>
    )
  }
  if (activity === undefined) return <p className={styles.stepNote}>{en.step.reading}</p>
  if (activity === null) return <p className={styles.stepNote}>{en.step.unreadable}</p>

  const { startedAt, endedAt, files, commands, tools, said } = activity
  const rows = fileRows(planned, files, cwd)
  const empty = !rows.length && !commands.length && !tools.length && !said.length
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
      {why}
      {time && <p className={styles.stepNote}>{time}</p>}
      {empty && <p className={styles.stepNote}>{en.step.nothing}</p>}
      <FileList rows={rows} cwd={cwd} pending={false} />
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

/**
 * The step's files. Without a plan for them, just what changed. With one: ✓ planned and changed,
 * ○ planned and not changed (yet), + changed without being planned.
 */
function FileList({
  rows,
  cwd,
  pending,
}: {
  rows: FileRow[]
  cwd: string | null
  pending: boolean
}) {
  if (!rows.length) return null
  const anyPlanned = rows.some((row) => row.planned)
  const mark = (row: FileRow) =>
    !anyPlanned ? null : row.planned ? (row.changed ? '✓' : '○') : '+'
  const tip = (row: FileRow) =>
    !anyPlanned
      ? row.path
      : `${row.path}\n${
          row.planned
            ? row.changed
              ? en.step.plannedChanged
              : pending
                ? en.step.planned
                : en.step.plannedUnchanged
            : en.step.unplanned
        }`
  return (
    <ul className={styles.stepList} aria-label={en.step.files}>
      {rows.map((row) => (
        <li
          key={row.path}
          title={tip(row)}
          data-unplanned={anyPlanned && !row.planned ? '' : undefined}
          data-untouched={row.planned && !row.changed ? '' : undefined}
        >
          {anyPlanned && <span className={styles.stepMark}>{mark(row)}</span>}
          <span className={styles.stepName}>{shortPath(row.path, cwd)}</span>
          {row.changed && row.changed.added > 0 && (
            <span className={styles.added}>+{row.changed.added}</span>
          )}
          {row.changed && row.changed.removed > 0 && (
            <span className={styles.removed}>−{row.changed.removed}</span>
          )}
        </li>
      ))}
    </ul>
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
