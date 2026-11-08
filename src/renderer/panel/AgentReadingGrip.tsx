import { useLayoutEffect, useState, type RefObject } from 'react'
import { HeightGrip } from './PinResize'
import styles from './Panel.module.css'

const heightKey = 'threadlight.agent-reading-height'

export function savedReadingHeight() {
  try {
    const value = Number(localStorage.getItem(heightKey))
    if (Number.isSafeInteger(value) && value > 0) return value
  } catch {
    /* The current session can still resize without local storage. */
  }
  return undefined
}

export function AgentReadingGrip({
  log,
  upward,
  resize,
}: {
  log: RefObject<HTMLDivElement | null>
  upward: boolean
  resize: (height: number) => void
}) {
  const [bounds, setBounds] = useState({ actual: 0, max: 420 })
  useLayoutEffect(() => {
    const reader = log.current
    const card = reader?.closest<HTMLElement>('[data-card]')
    const agent = reader?.parentElement
    if (!reader || !card || !agent) return
    function measure() {
      if (!reader || !card || !agent || !agent.offsetHeight) return
      // Reserve the controls when the pin and status rows share a short window.
      const footer = agent.lastElementChild as HTMLElement
      const bottom =
        footer.getBoundingClientRect().bottom + parseFloat(getComputedStyle(footer).marginBottom)
      const controls =
        bottom -
        agent.getBoundingClientRect().top +
        parseFloat(getComputedStyle(agent).paddingBottom) -
        reader.offsetHeight
      agent.style.setProperty(
        '--agent-reader-min',
        Math.ceil(controls + Math.min(72, reader.scrollHeight)) + 'px',
      )
      const actual = reader.clientHeight
      const limit = parseFloat(getComputedStyle(card).maxHeight) || window.innerHeight
      const max = Math.max(0, Math.floor(limit - card.offsetHeight + actual))
      setBounds((old) => (old.actual === actual && old.max === max ? old : { actual, max }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    for (const sibling of agent.children) observer.observe(sibling)
    const room = new MutationObserver(measure)
    room.observe(card, { attributes: true, attributeFilter: ['style'] })
    return () => {
      observer.disconnect()
      room.disconnect()
      agent.style.removeProperty('--agent-reader-min')
    }
  }, [log])
  const min = Math.min(72, bounds.max)
  function adjust(value: number) {
    const next = Math.round(Math.max(min, Math.min(bounds.max, value)))
    resize(next)
    try {
      localStorage.setItem(heightKey, String(next))
    } catch {
      /* Use session height. */
    }
  }
  return (
    <HeightGrip
      className={styles.agentGrip}
      label="Resize Agent reading area"
      marker="data-agent-resizing"
      min={Math.min(min, bounds.actual)}
      max={bounds.max}
      height={bounds.actual}
      upward={upward}
      resize={adjust}
    />
  )
}
