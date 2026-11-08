import type { TalkState } from '../../shared/ipc'
import type { Provider } from '../../shared/types'
import { en } from '../i18n/en'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { IDLE_MOTION, type MotionSnapshot } from '../../shared/motion'
import { useDotDrag } from '../hooks/useDotDrag'
import { SpokenReplyBody, usePillReply } from './SpokenReply'
import { ContextMenu } from '../panel/ContextMenu'
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
  if (openMic) return <LiveMicPill micLevel={micLevel} motion={motion} />
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

function LiveMicPill({ micLevel, motion }: { micLevel: number; motion: MotionSnapshot }) {
  const open = () => window.threadlight.dotClick()
  const wave = useRef<HTMLButtonElement>(null)
  const drag = useDotDrag(true)
  const finishDrag = drag.handlers.onPointerUp
  const hoverTimer = useRef<number | undefined>(undefined)
  const cancelHover = useCallback(() => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = undefined
  }, [])
  const lastPressPoint = useRef<{ x: number; y: number } | null>(null)
  const menuPending = useRef(false)
  const request = useRef(0)
  const [menu, setMenu] = useState<{ x: number; y: number; menuY: number } | null>(null)
  const reply = usePillReply()
  const expanded = reply.available && !menu
  const pill = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState({ width: 92, height: 0 })
  const measureBody = useCallback((width: number, height: number) => {
    setBody((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    )
  }, [])
  const [renderedWidth, setRenderedWidth] = useState(92)
  useLayoutEffect(() => {
    const el = pill.current
    if (!el || menu) return
    const size = () => {
      const { width, height } = el.getBoundingClientRect()
      setRenderedWidth(width)
      window.threadlight.setSpokenReplySize(width, height)
    }
    size()
    const observer = new ResizeObserver(size)
    observer.observe(el)
    const restoreSize = () => {
      if (!document.hidden) size()
    }
    document.addEventListener('visibilitychange', restoreSize)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', restoreSize)
    }
  }, [menu])
  const closeMenu = useCallback(() => {
    request.current++
    menuPending.current = false
    setMenu(null)
    void window.threadlight.setMicMenu(false)
  }, [])
  const showMenu = async () => {
    cancelHover()
    if (drag.isDragging()) finishDrag()
    menuPending.current = true
    const next = ++request.current
    const position = await window.threadlight.setMicMenu(true)
    if (request.current === next) {
      menuPending.current = !!position
      setMenu(position)
    }
  }
  useEffect(() => {
    const reset = () => {
      cancelHover()
      finishDrag()
      closeMenu()
    }
    const onHide = () => {
      if (document.hidden) reset()
    }
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', onHide)
      reset()
    }
  }, [cancelHover, closeMenu, finishDrag])
  return (
    <>
      <div
        ref={pill}
        className={styles.micPill}
        data-unfolded={expanded || undefined}
        data-full-width={Math.abs(renderedWidth - body.width) < 0.5 || undefined}
        data-menu={!!menu || undefined}
        data-agent-working={motion.agentWorking || undefined}
        data-provider={motion.provider}
        data-speaking={motion.output.level > 0.012 || undefined}
        style={
          {
            left: menu?.x,
            top: menu?.y,
            '--reply-height': body.height + 'px',
            '--reply-width': body.width + 'px',
            '--speech-level': Math.min(1, motion.output.level * 3),
          } as CSSProperties
        }
        role="group"
        onContextMenuCapture={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void showMenu()
        }}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            event.stopPropagation()
            void showMenu()
          }
        }}
        aria-label={en.openMic.pill}
      >
        <button
          className={styles.micWave}
          ref={wave}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          {...drag.handlers}
          onPointerEnter={(event) => {
            const last = lastPressPoint.current
            if (
              event.buttons ||
              event.pointerType === 'touch' ||
              menuPending.current ||
              drag.isDragging()
            )
              return
            // Native window movement can cross the cursor without a new user gesture.
            if (last && last.x === event.screenX && last.y === event.screenY) return
            cancelHover()
            // Allow a primary press to capture this window before hover replaces it.
            hoverTimer.current = window.setTimeout(() => {
              if (!menuPending.current && !drag.isDragging() && !document.hidden)
                window.threadlight.dotHover()
            }, 240)
          }}
          onPointerLeave={(event) => {
            cancelHover()
            const last = lastPressPoint.current
            if (
              !drag.isDragging() &&
              last &&
              (last.x !== event.screenX || last.y !== event.screenY)
            )
              lastPressPoint.current = null
          }}
          onPointerDown={(event) => {
            cancelHover()
            lastPressPoint.current = { x: event.screenX, y: event.screenY }
            drag.handlers.onPointerDown(event)
          }}
          onPointerUp={(event) => {
            lastPressPoint.current = { x: event.screenX, y: event.screenY }
            drag.handlers.onPointerUp()
          }}
          onClick={(event) => {
            if (event.detail === 0) open()
          }}
          aria-description={[
            motion.inputMuted ? 'Microphone muted' : 'Microphone open',
            motion.output.level > 0.012 && 'Agent speaking',
            motion.agentWorking && 'Agent working',
          ]
            .filter(Boolean)
            .join('. ')}
          aria-label={
            motion.inputMuted ? 'Live microphone muted. Open voice panel' : en.openMic.showThreads
          }
          title="Hover to open the call. Drag to move. Right-click for call actions."
        >
          <ElectricMotion
            snapshot={
              motion.mode === 'idle' && !motion.inputMuted && micLevel > motion.input.level
                ? { ...motion, input: { ...motion.input, level: micLevel } }
                : motion
            }
            provider={motion.provider}
            waveformOnly
            label={
              motion.output.level > 0.012
                ? 'Agent speaking'
                : motion.inputMuted
                  ? 'Live microphone muted'
                  : motion.agentWorking
                    ? 'Listening · Agent working'
                    : 'Listening'
            }
          />
        </button>
        {reply.shown && (
          <SpokenReplyBody
            reply={reply.shown}
            expanded={expanded}
            measure={measureBody}
            dismiss={() => {
              reply.dismiss()
              wave.current?.focus({ preventScroll: true })
            }}
          />
        )}
      </div>
      {menu && (
        <ContextMenu
          label="Voice call actions"
          x={2}
          y={menu.menuY}
          onClose={() => {
            closeMenu()
            wave.current?.focus()
          }}
          items={[
            {
              label: motion.listeningPaused ? 'Resume listening' : 'Pause listening',
              onSelect: () =>
                window.threadlight.micAction(motion.listeningPaused ? 'resume' : 'pause'),
            },
            ...(motion.output.level > 0.012
              ? [
                  {
                    label: 'Stop speaking',
                    onSelect: () => window.threadlight.micAction('stopSpeaking'),
                  },
                ]
              : []),
            { label: 'Hang up', onSelect: () => window.threadlight.stopOpenMic() },
          ]}
        />
      )}
    </>
  )
}
