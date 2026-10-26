import { useRef, useState } from 'react'

import type { BackgroundTask } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { elapsedText } from '../../shared/elapsed'
import styles from './Panel.module.css'
import { hasDockedHover, HoverInfo, type HoverPoint } from './HoverInfo'
import { useHelpMode } from './helpMode'

interface TaskTimerProps {
  tasks: BackgroundTask[]
}

/** A ticking task label; its hover chip lists each task without re-rendering the whole row. */
export function TaskTimer({ tasks }: TaskTimerProps) {
  const mode = useHelpMode()
  const now = useNow(1000)
  const anchor = useRef<HTMLSpanElement>(null)
  const [pointer, setPointer] = useState<HoverPoint | null>(null)
  const [previousMode, setPreviousMode] = useState(mode)
  if (previousMode !== mode) {
    setPreviousMode(mode)
    setPointer(null)
  }
  const only = tasks.length === 1 ? tasks[0] : undefined

  return (
    <span
      ref={anchor}
      data-tip-anchor=""
      className={styles.taskTimer}
      onMouseMove={(event) => {
        const { left, top } = event.currentTarget.getBoundingClientRect()
        setPointer({
          x: event.clientX - left,
          y: event.clientY - top,
          screenX: event.screenX,
          screenY: event.screenY,
        })
      }}
      onMouseLeave={() => {
        if (!hasDockedHover(anchor.current)) setPointer(null)
      }}
      onMouseDown={() => setPointer(null)}
    >
      {only ? (
        <>
          {en.tasks.one} <span className={styles.taskTime}>{elapsedText(only.startedAt, now)}</span>
        </>
      ) : (
        en.tasks.many(tasks.length)
      )}
      {pointer && mode !== 'off' && (
        <HoverInfo
          anchor={anchor}
          point={pointer}
          className={styles.taskPopup}
          onDismiss={() => setPointer(null)}
        >
          <span className={styles.taskHeading}>{en.tasks.heading}</span>
          {tasks.map((task) => (
            <span key={task.id} className={styles.taskLine}>
              <span className={styles.taskLabel}>{task.label}</span>
              <span className={styles.taskTime}>{elapsedText(task.startedAt, now)}</span>
            </span>
          ))}
        </HoverInfo>
      )}
    </span>
  )
}
