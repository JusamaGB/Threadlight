import type { TalkState } from '../../shared/ipc'
import type { Provider } from '../../shared/types'
import { en } from '../i18n/en'
import styles from './Dot.module.css'

interface StatusDotProps {
  providers?: Provider[]
  /** True while any session is working: the dot turns red and pulses. */
  working: boolean
  /** While the talk hotkey records or transcribes, the dot shows that instead (blue). */
  talk?: TalkState
  /** The open mic is on: a thin blue ring, so a listening microphone is never a secret. */
  openMic?: boolean
}

/** The dot itself. The open panel hides it, so it only shows while the panel is closed. */
export function StatusDot({
  working,
  talk = 'idle',
  providers = ['claude'],
  openMic = false,
}: StatusDotProps) {
  const paused = providers.length === 0
  const provider = providers[0]
  const look = [
    talk !== 'idle' ? styles[talk] : paused ? styles.paused : working ? styles.working : '',
    openMic && talk === 'idle' ? styles.openMic : '',
  ].join(' ')
  const label =
    talk === 'listening'
      ? en.dot.listening
      : talk === 'transcribing'
        ? en.dot.transcribing
        : paused
          ? en.sources.paused
          : providers.length === 2
            ? working
              ? 'A Claude or Codex chat is working'
              : 'No Claude or Codex chat is working'
            : working
              ? provider === 'codex'
                ? 'A Codex chat is working'
                : en.dot.working
              : provider === 'codex'
                ? 'No Codex chat is working'
                : en.dot.idle
  return (
    <div className={styles.frame}>
      <div
        className={`${styles.dot} ${look}`}
        role="status"
        aria-label={openMic ? `${label}. ${en.dot.openMic}` : label}
      />
    </div>
  )
}

interface FloatingDotProps {
  providers?: Provider[]
  working: boolean
  talk: TalkState
  /** Settings → "Open the panel on": hover opens straight away, click only on a click. */
  openOn: 'hover' | 'click'
  openMic: boolean
}

/**
 * The floating dot window: opens the panel on hover (or only on click, if chosen in Settings).
 * It is moved by dragging the panel's header, since the panel covers it the moment it opens.
 */
export function FloatingDot({ working, talk, openOn, providers, openMic }: FloatingDotProps) {
  const open = () => window.threadlight.dotClick()
  const hover = openOn === 'hover' ? { onPointerEnter: open, onMouseMove: open } : {}
  return (
    <div className={styles.floating} {...hover} onClick={open}>
      <StatusDot working={working} talk={talk} providers={providers} openMic={openMic} />
    </div>
  )
}
