import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'

import { matchThread, parseVoiceCommand } from '../../shared/match'
import type { Session } from '../../shared/types'
import { Composer } from '../composer/Composer'
import { useDotDrag } from '../hooks/useDotDrag'
import { useNow } from '../hooks/useNow'
import { useRelays } from '../hooks/useRelays'
import { useSessions } from '../hooks/useSessions'
import { useSettings } from '../hooks/useSettings'
import { useStt } from '../hooks/useStt'
import { useVoice } from '../hooks/useVoice'
import { en } from '../i18n/en'
import { SettingsView } from '../settings/SettingsView'
import { ContextMenu, type MenuItem } from './ContextMenu'
import styles from './Panel.module.css'
import { SessionRow } from './SessionRow'

type View = 'active' | 'all'

/** How long the panel takes to fade out once the pointer leaves it. Matches `.closing` in the CSS. */
const FADE_MS = 150
/** After a voice send is answered, an untouched panel turns back into the dot. */
const VOICE_CLOSE_AFTER_MS = 4000
const isActive = (s: Session) => s.state === 'working' || s.state === 'waiting'

interface MenuState {
  x: number
  y: number
  session: Session
}

interface ComposeState {
  sessionId: string
  initialText?: string
  countdownSeconds?: number
}

export function Panel() {
  const sessions = useSessions()
  const relays = useRelays()
  const stt = useStt()
  const settings = useSettings()
  const now = useNow()
  const [view, setView] = useState<View>('active')
  /** The settings list takes over the panel's card while this is true. */
  const [showSettings, setShowSettings] = useState(false)
  const [version, setVersion] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** The composer is hidden while this is null. */
  const [compose, setCompose] = useState<ComposeState | null>(null)
  /** Speech that needs a thread picked before it can be sent. */
  const [picking, setPicking] = useState<{ text: string; heardThread: string | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null)
  const [maxHeight, setMaxHeight] = useState(800)
  const [heard, setHeard] = useState<{ text: string; n: number } | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [cancelToken, setCancelToken] = useState(0)
  const [closing, setClosing] = useState(false)
  /** Double-clicking the header's bare space keeps the panel up as a slim bar between hovers. */
  const [semiOpen, setSemiOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const fade = useRef<number | undefined>(undefined)
  const drag = useDotDrag()

  // Who started the recording decides what happens with the words.
  const startedBy = useRef<'hotkey' | 'mic' | null>(null)
  const countdownUntil = useRef(0)
  /** The thread a voice send went to, until it is answered. */
  const [voiceSendId, setVoiceSendId] = useState<string | null>(null)
  const sessionsRef = useRef(sessions)
  const settingsRef = useRef(settings)
  useEffect(() => {
    sessionsRef.current = sessions
    settingsRef.current = settings
  }, [sessions, settings])

  const limitHandler = useRef<() => void>(() => {})
  const voice = useVoice(useCallback(() => limitHandler.current(), []))

  // A hover or click opens the panel fresh on Active; the talk hotkey keeps what it just filled in.
  useEffect(
    () =>
      window.threadlight.onPanelOpened(({ maxHeight, fresh }) => {
        setMaxHeight(maxHeight)
        window.clearTimeout(fade.current)
        setClosing(false)
        setCollapsed(false)
        if (!fresh) return
        setView('active')
        setExpanded(null)
        setMenu(null)
        setCompose(null)
        setPicking(null)
        setNotice(null)
        setSemiOpen(false)
        setShowSettings(false)
      }),
    [],
  )
  useEffect(() => window.threadlight.onHotkeyProblem(setHotkeyProblem), [])
  useEffect(() => window.threadlight.onOpenSettings(() => setShowSettings(true)), [])
  useEffect(() => {
    void window.threadlight.getVersion().then(setVersion)
  }, [])

  // The dot shows the talk hotkey's progress.
  useEffect(() => window.threadlight.setTalkState(voice.state), [voice.state])

  // The window is sized to the card, so the card reports its height whenever it changes.
  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      window.threadlight.resizePanel(element.getBoundingClientRect().height),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menu) setMenu(null)
      else window.threadlight.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  /** Turns finished speech into a composer for the right thread, or asks which thread. */
  const finishTalk = useCallback(async () => {
    let text: string
    try {
      text = (await voice.stop()).trim()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
      window.threadlight.openPanelQuietly()
      return
    } finally {
      startedBy.current = null
    }
    if (!text) return // nothing said: the dot just goes back to normal
    const command = parseVoiceCommand(text)
    const candidates = sessionsRef.current.map((s) => ({ id: s.id, title: s.title }))
    const match = command ? matchThread(command.thread, candidates) : null
    setNotice(null)
    setShowSettings(false)
    if (command && match) {
      // Voice sends always count down first, so a misheard sentence can be stopped.
      const seconds = settingsRef.current?.voiceCountdownSeconds ?? 3
      setPicking(null)
      setCompose({ sessionId: match.id, initialText: command.message, countdownSeconds: seconds })
      countdownUntil.current = Date.now() + seconds * 1000
      setVoiceSendId(match.id)
    } else {
      setCompose(null)
      setPicking({ text: command?.message ?? text, heardThread: command?.thread ?? null })
      setView('all')
    }
    window.threadlight.openPanelQuietly()
  }, [voice])

  const micToggle = useCallback(async () => {
    setVoiceError(null)
    if (voice.state === 'idle') {
      try {
        startedBy.current = 'mic'
        await voice.start()
      } catch {
        startedBy.current = null
        setVoiceError(en.voice.micBlocked)
      }
    } else if (voice.state === 'listening') {
      try {
        const text = (await voice.stop()).trim()
        if (text) setHeard((previous) => ({ text, n: (previous?.n ?? 0) + 1 }))
        else setVoiceError(en.voice.nothingHeard)
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : String(error))
      } finally {
        startedBy.current = null
      }
    }
  }, [voice])

  // The talk hotkey: start, stop-and-send, or cancel a countdown in progress.
  const onTalk = useCallback(async () => {
    if (Date.now() < countdownUntil.current) {
      countdownUntil.current = 0
      setCancelToken((n) => n + 1)
      return
    }
    if (voice.state === 'listening') {
      if (startedBy.current === 'hotkey') await finishTalk()
      else await micToggle()
      return
    }
    if (voice.state !== 'idle') return
    if (stt.state !== 'ready') {
      setNotice(en.voice.hotkeyNeedsModel)
      window.threadlight.openPanelQuietly()
      return
    }
    try {
      startedBy.current = 'hotkey'
      await voice.start()
    } catch {
      startedBy.current = null
      setNotice(en.voice.micBlocked)
      window.threadlight.openPanelQuietly()
    }
  }, [voice, stt.state, finishTalk, micToggle])

  useEffect(() => window.threadlight.onTalkToggle(() => void onTalk()), [onTalk])
  useEffect(() => {
    limitHandler.current = () => void (startedBy.current === 'hotkey' ? finishTalk() : micToggle())
  }, [finishTalk, micToggle])

  // Once a voice send is answered, an untouched panel goes back to being the dot.
  const voiceRelay = voiceSendId ? relays.get(voiceSendId) : undefined
  const voiceDone = voiceRelay?.state === 'replied' || voiceRelay?.state === 'failed'
  useEffect(() => {
    if (!voiceDone) return
    const timer = window.setTimeout(() => {
      setVoiceSendId(null)
      if (!document.hasFocus()) window.threadlight.closePanel()
    }, VOICE_CLOSE_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [voiceDone])

  const closeComposer = () => {
    setCompose(null)
    // Opened by voice and never clicked: nothing else will close it.
    if (!document.hasFocus()) window.threadlight.closePanel()
  }

  // The panel only shows while the pointer is over it: leaving fades it out, coming back cancels.
  // Semi-open, leaving shrinks it to the header bar instead, and hovering the bar expands it.
  const leave = () => {
    if (drag.isDragging()) return
    // Never hide the panel while the microphone is open or a voice send is counting down:
    // the recording or the send would carry on with nothing on screen to show or stop it.
    if (voice.state !== 'idle' || Date.now() < countdownUntil.current) return
    if (semiOpen) {
      setMenu(null)
      setCollapsed(true)
      return
    }
    setClosing(true)
    window.clearTimeout(fade.current)
    fade.current = window.setTimeout(() => window.threadlight.closePanel(), FADE_MS)
  }
  const enter = () => {
    window.clearTimeout(fade.current)
    setClosing(false)
    setCollapsed(false)
  }
  const toggleSemiOpen = (event: MouseEvent) => {
    if (event.target !== event.currentTarget) return
    setSemiOpen(!semiOpen)
    window.threadlight.setSemiOpen(!semiOpen)
  }

  const active = sessions.filter(isActive).length
  // The thread being written to stays listed even after it goes idle.
  const shown =
    view === 'all' ? sessions : sessions.filter((s) => isActive(s) || s.id === compose?.sessionId)
  const target = sessions.find((s) => s.id === compose?.sessionId)

  const openMenu = (event: MouseEvent, session: Session) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, session })
  }
  const menuItems = (session: Session): MenuItem[] => [
    { label: en.menu.compose, onSelect: () => setCompose({ sessionId: session.id }) },
    {
      label: en.menu.openInClaude,
      disabled: !session.appId,
      onSelect: () => session.appId && window.threadlight.openInClaude(session.appId),
    },
  ]

  const onRowClick = (session: Session) => {
    if (picking) {
      // Picking a thread for speech that did not name one clearly.
      setCompose({ sessionId: session.id, initialText: picking.text })
      setPicking(null)
      return
    }
    setExpanded(expanded === session.id ? null : session.id)
  }

  return (
    <div
      ref={card}
      className={[styles.card, closing && styles.closing, collapsed && styles.collapsed]
        .filter(Boolean)
        .join(' ')}
      style={{ maxHeight }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <header className={styles.header} onDoubleClick={toggleSemiOpen} {...drag.handlers}>
        {showSettings ? (
          <>
            <button
              className={styles.back}
              onClick={() => setShowSettings(false)}
              aria-label={en.settings.back}
              title={en.settings.back}
            >
              ‹
            </button>
            <span className={styles.heading}>{en.settings.title}</span>
          </>
        ) : (
          <>
            <span className={styles.heading}>{en.panel.activeCount(active)}</span>
            {/* The recent count opens the full list and closes it again. */}
            <button
              className={styles.recent}
              aria-pressed={view === 'all'}
              title={view === 'all' ? en.panel.hideRecent : en.panel.showRecent}
              onClick={() => setView(view === 'active' ? 'all' : 'active')}
            >
              {en.panel.recentCount(sessions.length)}
            </button>
            <button
              className={styles.gear}
              onClick={() => setShowSettings(true)}
              aria-label={en.settings.open}
              title={en.settings.open}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6.6 1h2.8l.4 2 1.3.7 1.9-.7 1.4 2.4-1.5 1.3v1.6l1.5 1.3-1.4 2.4-1.9-.7-1.3.7-.4 2H6.6l-.4-2-1.3-.7-1.9.7L1.6 9.6l1.5-1.3V6.7L1.6 5.4 3 3l1.9.7L6.2 3z" />
                <circle cx="8" cy="8" r="2.2" />
              </svg>
            </button>
          </>
        )}
      </header>

      {showSettings && settings && <SettingsView settings={settings} stt={stt} version={version} />}

      {/* Kept mounted (just hidden) while settings show, so a half-typed message survives. */}
      <div className={styles.sessions} hidden={showSettings}>
        {(hotkeyProblem || notice) && <p className={styles.notice}>{notice ?? hotkeyProblem}</p>}
        {picking && (
          <div className={styles.picking}>
            <span className={styles.pickPrompt}>
              {picking.heardThread ? en.voice.noMatch(picking.heardThread) : en.voice.pickThread}
            </span>
            <span className={styles.pickText}>“{picking.text}”</span>
          </div>
        )}

        <div className={styles.list}>
          {shown.length === 0 && (
            <p className={styles.empty}>
              {view === 'active'
                ? en.panel.nothingWorking
                : en.panel.noSessions(settings?.listWindowHours ?? 24)}
            </p>
          )}
          {shown.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              relay={relays.get(session.id)}
              composing={session.id === compose?.sessionId}
              now={now}
              expanded={!picking && expanded === session.id}
              onToggle={() => onRowClick(session)}
              onContextMenu={(event) => openMenu(event, session)}
            />
          ))}
        </div>

        {target && compose && (
          <Composer
            key={`${target.id}:${compose.initialText ?? ''}`}
            session={target}
            relay={relays.get(target.id)}
            stt={stt}
            voiceState={voice.state}
            level={voice.level}
            onMic={() => void micToggle()}
            heard={heard}
            voiceError={voiceError}
            initialText={compose.initialText}
            countdownSeconds={compose.countdownSeconds}
            cancelToken={cancelToken}
            onClose={closeComposer}
          />
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.session)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
