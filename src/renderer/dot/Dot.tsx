import type { TalkState } from '../../shared/ipc'
import { en } from '../i18n/en'
import styles from './Dot.module.css'

interface StatusDotProps {
  /** True while any session is working: the dot turns red and pulses. */
  working: boolean
  /** While the talk hotkey records or transcribes, the dot shows that instead (blue). */
  talk?: TalkState
}

/** The dot itself. The open panel hides it, so it only shows while the panel is closed. */
export function StatusDot({ working, talk = 'idle' }: StatusDotProps) {
  const look = talk !== 'idle' ? styles[talk] : working ? styles.working : ''
  const label =
    talk === 'listening'
      ? en.dot.listening
      : talk === 'transcribing'
        ? en.dot.transcribing
        : working
          ? en.dot.working
          : en.dot.idle
  return (
    <div className={styles.frame}>
      <div className={`${styles.dot} ${look}`} role="status" aria-label={label} />
    </div>
  )
}

/**
 * The floating dot window: hovering opens the panel straight away (a click too, as a fallback).
 * It is moved by dragging the panel's header, since the panel covers it the moment it is hovered.
 */
export function FloatingDot({ working, talk }: { working: boolean; talk: TalkState }) {
  const open = () => window.threadlight.dotClick()
  return (
    <div className={styles.floating} onPointerEnter={open} onMouseMove={open} onClick={open}>
      <StatusDot working={working} talk={talk} />
    </div>
  )
}
