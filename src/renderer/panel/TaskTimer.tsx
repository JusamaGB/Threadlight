import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { BackgroundTask } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { en } from '../i18n/en'
import { elapsedText } from '../../shared/elapsed'
import styles from './Panel.module.css'
import { usePanelRoom } from './room'

/** Space between the label and the pop-up, and between the pop-up and the window's edge. */
const GAP = 8
const EDGE = 4

/** Where the pop-up goes: beside the label's ends, level with the cursor. */
interface Anchor {
  left: number
  right: number
  y: number
}

interface TaskTimerProps {
  tasks: BackgroundTask[]
}

/**
 * Takes the place of a row's age while background tasks run: "Task 42s" for one, "Tasks ×3" for
 * several. Hovering lists each task and how long it has been running. Ticks every second on its
 * own, so the rest of the row does not re-render.
 */
export function TaskTimer({ tasks }: TaskTimerProps) {
  const now = useNow(1000)
  const [pointer, setPointer] = useState<Anchor | null>(null)
  const only = tasks.length === 1 ? tasks[0] : undefined

  return (
    <span
      data-tip-anchor=""
      className={styles.taskTimer}
      onMouseMove={(event) => {
        const { left, right } = event.currentTarget.getBoundingClientRect()
        setPointer({ left, right, y: event.clientY })
      }}
      onMouseLeave={() => setPointer(null)}
    >
      {only ? (
        <>
          {en.tasks.one} <span className={styles.taskTime}>{elapsedText(only.startedAt, now)}</span>
        </>
      ) : (
        en.tasks.many(tasks.length)
      )}
      {pointer && <TaskPopup tasks={tasks} pointer={pointer} now={now} />}
    </span>
  )
}

interface TaskPopupProps {
  tasks: BackgroundTask[]
  pointer: Anchor
  now: number
}

/**
 * Beside the label, level with the cursor and following it up and down: to the label's left
 * (it sits at the row's right end), or to its right when there is no room on the left. Fixed, so the
 * list's scrolling box cannot clip it; it asks the panel for room only if the card is shorter
 * than the pop-up itself.
 */
function TaskPopup({ tasks, pointer, now }: TaskPopupProps) {
  const popup = useRef<HTMLSpanElement>(null)
  const { opensDown, extra, reserve } = usePanelRoom()
  const [position, setPosition] = useState<{
    left: number
    top: number
    maxWidth: number
  } | null>(null)

  useLayoutEffect(() => {
    const element = popup.current
    const card = element?.closest('[data-card]')
    if (!element || !card) return
    const box = card.getBoundingClientRect()
    // Whichever side has more space; a long task name is cut short rather than covering the label.
    const onLeft = pointer.left >= window.innerWidth - pointer.right
    const maxWidth = onLeft
      ? pointer.left - GAP - EDGE
      : window.innerWidth - pointer.right - GAP - EDGE
    element.style.maxWidth = `${maxWidth}px` // before measuring, so the width is the capped one
    const { offsetWidth: width, offsetHeight: height } = element
    reserve(height + 2 * EDGE - box.height)
    // The window: the card plus the room granted, on the side the panel opens to.
    const top = opensDown ? box.top : box.top - extra
    const bottom = opensDown ? box.bottom + extra : box.bottom
    setPosition({
      left: onLeft ? pointer.left - GAP - width : pointer.right + GAP,
      maxWidth,
      top: Math.max(top + EDGE, Math.min(pointer.y - height / 2, bottom - height - EDGE)),
    })
  }, [pointer, opensDown, extra, reserve, tasks.length])

  // Give the room back once the pop-up closes.
  const release = useRef(reserve)
  useEffect(() => {
    release.current = reserve
  }, [reserve])
  useEffect(() => () => release.current(0), [])

  return (
    <span
      ref={popup}
      className={styles.taskPopup}
      role="tooltip"
      style={position ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      <span className={styles.taskHeading}>{en.tasks.heading}</span>
      {tasks.map((task) => (
        <span key={task.id} className={styles.taskLine}>
          <span className={styles.taskLabel}>{task.label}</span>
          <span className={styles.taskTime}>{elapsedText(task.startedAt, now)}</span>
        </span>
      ))}
    </span>
  )
}
