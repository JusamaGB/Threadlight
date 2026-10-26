import type { TalkState } from '../../shared/ipc'
import type { Provider } from '../../shared/types'
import { en } from '../i18n/en'
import { VoiceWave } from '../composer/VoiceWave'
import { IDLE_MOTION, type MotionSnapshot } from '../../shared/motion'
import { ElectricMotion } from '../motion/ElectricMotion'
import styles from './Dot.module.css'

interface StatusDotProps {
  providers?: Provider[]
  /** True while any session is working: the filaments form a Catherine wheel. */
  working: boolean
  /** While the talk hotkey records or transcribes, the dot shows that instead (blue). */
  talk?: TalkState
  /** The open mic is on: a thin blue ring, so a listening microphone is never a secret. */
  openMic?: boolean
  motion?: MotionSnapshot
}

/** The dot itself. The open panel hides it, so it only shows while the panel is closed. */
export function StatusDot({
  working,
  talk = 'idle',
  providers = ['claude'],
  openMic = false,
  motion = IDLE_MOTION,
}: StatusDotProps) {
  const paused = providers.length === 0
  const provider = providers[0]
  const look = [
    paused && motion.mode === 'idle' ? styles.paused : '',
    openMic && talk === 'idle' ? styles.openMic : '',
  ].join(' ')
  const monitoringLabel =
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
  const label =
    motion.input.level > 0.035 && motion.output.level > 0.035
      ? 'You and agent speaking'
      : motion.output.level > 0.035
        ? 'Agent speaking'
        : motion.input.level > 0.035
          ? 'You speaking'
          : motion.mode === 'thinking'
            ? 'Agent thinking'
            : motion.mode === 'waiting'
              ? 'Agent waiting for you'
              : motion.mode === 'error'
                ? 'Needs attention'
                : monitoringLabel
  return (
    <div className={styles.frame}>
      <div
        className={`${styles.motion} ${look}`}
        role="status"
        aria-label={openMic ? `${label}. ${en.dot.openMic}` : label}
      >
        <ElectricMotion
          label={label}
          snapshot={{
            ...motion,
            mode:
              talk !== 'idle'
                ? talk
                : motion.mode !== 'idle'
                  ? motion.mode
                  : working
                    ? 'thinking'
                    : 'idle',
          }}
        />
      </div>
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
  micLevel: number
  motion?: MotionSnapshot
}

/**
 * The floating dot window: opens the panel on hover (or only on click, if chosen in Settings).
 * It is moved by dragging the panel's header, since the panel covers it the moment it opens.
 */
export function FloatingDot({
  working,
  talk,
  openOn,
  providers,
  openMic,
  micLevel,
  motion = IDLE_MOTION,
}: FloatingDotProps) {
  const open = () => window.threadlight.dotClick()
  if (openMic)
    return (
      <div className={styles.micPill} role="group" aria-label={en.openMic.pill}>
        <button
          className={styles.micWave}
          onClick={open}
          aria-label={en.openMic.showThreads}
          title={en.openMic.showThreads}
        >
          {motion.mode === 'idle' ? (
            <VoiceWave level={micLevel} />
          ) : (
            <ElectricMotion
              snapshot={motion}
              label={
                motion.output.level > 0.035
                  ? 'Agent speaking'
                  : motion.mode === 'thinking'
                    ? 'Thinking'
                    : 'Listening'
              }
            />
          )}
        </button>
        <button
          className={styles.micStop}
          onClick={() => window.threadlight.stopOpenMic()}
          aria-label={en.openMic.stop}
          title={en.openMic.stop}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect width="10" height="10" rx="1.5" fill="currentColor" />
          </svg>
        </button>
      </div>
    )
  const hoverOpen = () => window.threadlight.dotHover()
  const hover = openOn === 'hover' ? { onPointerEnter: hoverOpen, onMouseMove: hoverOpen } : {}
  return (
    <div className={styles.floating} {...hover} onClick={open}>
      <StatusDot
        working={working}
        talk={talk}
        providers={providers}
        openMic={openMic}
        motion={motion}
      />
    </div>
  )
}
