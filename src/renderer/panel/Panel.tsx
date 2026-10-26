import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'

import { matchThread, parseVoiceCommand } from '../../shared/match'
import { DEFAULT_ENABLED_PROVIDERS, sessionProvider } from '../../shared/providers'
import type { Session, ThreadNode } from '../../shared/types'
import { Composer } from '../composer/Composer'
import { useDotDrag } from '../hooks/useDotDrag'
import { useAgent } from '../hooks/useAgent'
import { useNow } from '../hooks/useNow'
import { useRelays } from '../hooks/useRelays'
import { findInSnapshot } from '../../shared/snapshot'
import { useSnapshot } from '../hooks/useSnapshot'
import { useSettings } from '../hooks/useSettings'
import { useStt } from '../hooks/useStt'
import { useUsage } from '../hooks/useUsage'
import { useOpenMic } from '../hooks/useOpenMic'
import { useVoice } from '../hooks/useVoice'
import { useRecordedAgentVoice } from '../hooks/useRecordedAgentVoice'
import { MicSessionRouter, type MicRoute } from '../../shared/voiceCommands'
import { en } from '../i18n/en'
import { windowLabel } from '../lib/format'
import { SettingsView } from '../settings/SettingsView'
import { SharedSpacesView, type SpacesNavigation } from '../spaces/SharedSpacesView'
import { AgentView } from './AgentView'
import { ChangesView } from './ChangesView'
import { ContextMenu, type MenuItem } from './ContextMenu'
import styles from './Panel.module.css'
import { PanelRoomContext } from './room'
import { SessionRow } from './SessionRow'
import { CodexUsageBar, UsageBar } from './UsageBar'
import { WorkspacePicker } from './WorkspacePicker'
import { sameFolder, WorkspaceTree } from './WorkspaceTree'
import { motionMode } from '../../shared/motion'
import { useMotion } from '../hooks/useMotion'
import { VoicePresence } from '../motion/VoicePresence'
import { ElectricMotion } from '../motion/ElectricMotion'

type View = 'active' | 'all'

/** How long a double-click on the header waits to see whether it becomes a triple-click. */
const TRIPLE_CLICK_WAIT_MS = 250

type HoldMode = 'normal' | 'active' | 'pinned'
/** After a voice send is answered, an untouched panel turns back into the dot. */
const VOICE_CLOSE_AFTER_MS = 4000
const isActive = (s: Session) => s.state === 'working' || s.state === 'waiting'
/** A thread that has just gone idle stays in the Active list this long, so its reply can be read. */
const LINGER_MS = 30_000
const workspaceFolder = (id: string) =>
  id
    .replace(/^(claude|codex):/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()

/** While pinned, this icon takes the place of the thread count, next to the word "recent". */
function PinIcon() {
  return (
    <svg className={styles.pin} width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 1.5 14.5 5.5 12 6.5 9.5 9l.5 3.5-1.5 1.5-3-3-3.5 3.5-.5-.5L5.5 10.5l-3-3L4 6l3.5.5L10 4z" />
    </svg>
  )
}

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
  const snapshot = useSnapshot()
  const sessions = snapshot.sessions
  const relays = useRelays()
  const stt = useStt()
  const settings = useSettings()
  const enabled = settings?.enabledProviders ?? DEFAULT_ENABLED_PROVIDERS
  const provider = enabled.length === 2 ? 'both' : (enabled[0] ?? 'none')
  const providerCompose = useRef<Partial<Record<'claude' | 'codex', ComposeState | null>>>({})
  const previousProviders = useRef(enabled)
  // Ticks often enough for a thread to leave the Active list close to its 30 seconds.
  const now = useNow(5000)
  const [view, setView] = useState<View>('active')
  const usage = useUsage()
  /** The settings list takes over the panel's card while this is true. */
  const [showSettings, setShowSettings] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const spacesNavigation = useRef<SpacesNavigation>(null)
  /** The agent conversation takes over the card, like settings. */
  const [showAgent, setShowAgent] = useState(false)
  // The agent keeps working while another page shows; its button then says so.
  const agent = useAgent()
  const agentBusy =
    !showAgent &&
    (agent.status === 'starting' ||
      agent.status === 'working' ||
      agent.status === 'waiting' ||
      agent.status === 'stopping')
  /** The Changes view, for this thread's git folder: it takes over the card too. */
  const [changesFor, setChangesFor] = useState<string | null>(null)
  /** Choosing which workspace the Workspace list shows; takes over the card like settings. */
  const [pickingWorkspace, setPickingWorkspace] = useState(false)
  /** Open workspaces in the "All" list; null until changed means "just the current one". */
  const [openWorkspaces, setOpenWorkspaces] = useState<string[] | null>(null)
  /** Workspaces showing every thread, not just the most recent few. */
  const [moreWorkspaces, setMoreWorkspaces] = useState<string[]>([])
  const [version, setVersion] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [voiceSelection, setVoiceSelection] = useState<string | null>(null)
  const [voiceWorkspace, setVoiceWorkspace] = useState<string | null>(null)
  const voiceFocusPending = useRef<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** The list button's right-click menu of the other kinds of full list, where it opened. */
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null)
  const [sourceMenu, setSourceMenu] = useState<{
    x: number
    y: number
    anchor: HTMLElement
  } | null>(null)
  /** The composer is hidden while this is null. */
  const [compose, setCompose] = useState<ComposeState | null>(null)
  /** Speech that needs a thread picked before it can be sent. */
  const [picking, setPicking] = useState<{ text: string; heardThread: string | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null)
  const [maxHeight, setMaxHeight] = useState(800)
  const [opensDown, setOpensDown] = useState(true)
  /** Extra window height a pop-up asked for (see room.ts). */
  const [room, setRoom] = useState(0)
  const [heard, setHeard] = useState<{ text: string; n: number } | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceCaption, setVoiceCaption] = useState('')
  const [cancelToken, setCancelToken] = useState(0)
  /**
   * How the panel behaves when the pointer leaves. Normal: it closes. Double-click the
   * header's bare space to pin the active list open ("active"); triple-click to pin the full
   * list open ("pinned"). The same clicks again unpin it.
   */
  const [hold, setHold] = useState<HoldMode>('normal')
  const pendingDoubleClick = useRef<number | undefined>(undefined)
  const card = useRef<HTMLDivElement>(null)
  const drag = useDotDrag()

  /** Agent Toggle listens until the next press; selecting a target never opens the mic. */
  const [micLive, setMicLive] = useState(false)
  const openMicMode = settings?.voiceTarget === 'agent' && settings.talkMode === 'toggle'
  const openMicModeRef = useRef(openMicMode)
  useEffect(() => {
    openMicModeRef.current = openMicMode
    // Switching the setting off (or to Hold) closes a live mic, and it stays closed after.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!openMicMode) setMicLive(false)
  }, [openMicMode])
  const toggleLive = useCallback(() => setMicLive((live) => !live), [])

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
  const {
    send: sendAgentSpeech,
    close: closeAgentSpeech,
    error: recordedAgentError,
    draft: recordedAgentDraft,
  } = useRecordedAgentVoice(settings?.voiceTarget === 'agent')
  const cancelVoice = voice.cancel
  const recordingTarget = useRef<'agent' | 'thread'>('thread')
  const recordingAgent = useRef<'claude' | 'codex'>('claude')
  const recordingGeneration = useRef(0)
  const routeSentence = useRef<(route: MicRoute) => void>(() => {})
  const enabledKey = enabled.join()
  useEffect(() => {
    previousProviders.current = enabled
  }, [enabled])
  // Respond to the settings event as one transition, retaining targets for still-enabled apps.
  useEffect(
    () =>
      window.threadlight.onSettings((next) => {
        if (
          next.voiceTarget !== settingsRef.current?.voiceTarget ||
          next.talkMode !== settingsRef.current?.talkMode ||
          next.agentProvider !== settingsRef.current?.agentProvider
        ) {
          recordingGeneration.current++
          startedBy.current = null
          cancelVoice()
          setMicLive(false)
          void closeAgentSpeech()
          countdownUntil.current = 0
          setCancelToken((n) => n + 1)
        }
        const enabled = next.enabledProviders
        if (previousProviders.current.join() === enabled.join()) return
        if (compose)
          providerCompose.current[sessionProvider(compose.sessionId)] = {
            ...compose,
            countdownSeconds: undefined,
          }
        if (compose && enabled.includes(sessionProvider(compose.sessionId))) {
          setCompose({ ...compose, countdownSeconds: undefined })
        } else {
          const restored = !compose
            ? enabled
                .filter((p) => !previousProviders.current.includes(p))
                .map((p) => providerCompose.current[p])
                .find(Boolean)
            : null
          setCompose(restored ?? null)
        }
        previousProviders.current = enabled
        if (expanded && !enabled.includes(sessionProvider(expanded))) setExpanded(null)
        setMenu(null)
        setListMenu(null)
        setSourceMenu(null)
        setPicking(null)
        setChangesFor(null)

        setOpenWorkspaces(null)
        setMoreWorkspaces([])
        setHeard(null)
        countdownUntil.current = 0
        setCancelToken((n) => n + 1)
        // A saved voice countdown must never restart when a source is enabled again.
      }),
    [compose, expanded, cancelVoice, closeAgentSpeech],
  )

  // A hover or click opens the panel fresh on Active; the talk hotkey keeps what it just filled in.
  useEffect(
    () =>
      window.threadlight.onPanelOpened(({ maxHeight, opensDown, fresh }) => {
        setMaxHeight(maxHeight)
        setOpensDown(opensDown)
        if (!fresh) return
        window.clearTimeout(pendingDoubleClick.current)
        setView('active')
        setExpanded(null)
        setVoiceSelection(null)
        setVoiceWorkspace(null)
        voiceFocusPending.current = null
        setMenu(null)
        setListMenu(null)
        setSourceMenu(null)
        setCompose(null)
        setPicking(null)
        setNotice(null)
        setHold('normal')
        setShowSettings(false)
        setPickingWorkspace(false)
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

  // The window is sized to the card (plus any room a pop-up asked for), so the card reports its
  // height whenever it changes.
  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const resize = () =>
      window.threadlight.resizePanel(element.getBoundingClientRect().height + room)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [room])

  const panelRoom = useMemo(
    () => ({
      opensDown,
      extra: room,
      reserve: (px: number) => {
        const cardHeight = card.current?.getBoundingClientRect().height ?? 0
        setRoom(Math.round(Math.max(0, Math.min(px, maxHeight - cardHeight))))
      },
    }),
    [opensDown, room, maxHeight],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (sourceMenu) setSourceMenu(null)
      else if (listMenu) setListMenu(null)
      else if (menu) setMenu(null)
      else window.threadlight.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, listMenu, sourceMenu])

  /** Turns finished speech into a composer for the right thread, or asks which thread. */
  const finishTalk = useCallback(async () => {
    const mine = recordingGeneration.current
    const target = recordingTarget.current
    let text: string
    try {
      text = (await voice.stop()).trim()
    } catch (error) {
      if (mine === recordingGeneration.current) {
        setNotice(error instanceof Error ? error.message : String(error))
        window.threadlight.openPanelQuietly()
      }
      return
    } finally {
      startedBy.current = null
    }
    if (!text || mine !== recordingGeneration.current) return
    setVoiceCaption(text)
    if (target === 'agent') {
      const route = new MicSessionRouter().route(text, sessionsRef.current)
      if (route.kind !== 'agent') routeSentence.current(route)
      else {
        setNotice(null)
        setShowSettings(false)
        setPickingWorkspace(false)
        setChangesFor(null)
        setShowAgent(true)
        window.threadlight.openPanelQuietly()
        await sendAgentSpeech(route.text)
      }
      return
    }
    const command = parseVoiceCommand(text)
    const candidates = sessionsRef.current.map((s) => ({ id: s.id, title: s.title }))
    const match = command ? matchThread(command.thread, candidates) : null
    setNotice(null)
    setShowSettings(false)
    setShowAgent(false)
    setPickingWorkspace(false)
    setChangesFor(null)
    if (command && match) {
      // Voice sends count down first, so a misheard sentence can be stopped; on Hold they
      // wait in the composer until Send is clicked.
      const seconds = settingsRef.current?.voiceHold
        ? undefined
        : (settingsRef.current?.voiceCountdownSeconds ?? 5)
      setPicking(null)
      setCompose({ sessionId: match.id, initialText: command.message, countdownSeconds: seconds })
      countdownUntil.current = seconds ? Date.now() + seconds * 1000 : 0
      setVoiceSendId(match.id)
    } else {
      setCompose(null)
      setPicking({ text: command?.message ?? text, heardThread: command?.thread ?? null })
      setView('all')
    }
    window.threadlight.openPanelQuietly()
  }, [voice, sendAgentSpeech])

  const micToggle = useCallback(async () => {
    setVoiceError(null)
    if (voice.state === 'idle') {
      setVoiceCaption('')
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
        if (text) {
          setVoiceCaption(text)
          setHeard((previous) => ({ text, n: (previous?.n ?? 0) + 1 }))
        } else setVoiceError(en.voice.nothingHeard)
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : String(error))
      } finally {
        startedBy.current = null
      }
    }
  }, [voice])

  // The talk hotkey: start, stop-and-send, or cancel a countdown in progress.
  const onTalk = useCallback(async () => {
    // Closing the global mic also works while the composer is dictating or transcribing.
    if (micLive) {
      setMicLive(false)
      return
    }
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
    if (
      settingsRef.current?.voiceTarget !== 'agent' &&
      settingsRef.current?.enabledProviders.length === 0
    ) {
      setNotice(en.sources.paused)
      setShowSettings(true)
      window.threadlight.openPanelQuietly()
      return
    }
    if (stt.state !== 'ready') {
      setNotice(en.voice.hotkeyNeedsModel)
      window.threadlight.openPanelQuietly()
      return
    }
    // With the open mic on, the toggle opens and closes a live mic instead of one recording.
    if (openMicModeRef.current) {
      const mine = recordingGeneration.current
      await closeAgentSpeech()
      if (mine !== recordingGeneration.current || !openMicModeRef.current) return
      setVoiceCaption('')
      toggleLive()
      window.threadlight.openPanelQuietly()
      return
    }
    try {
      startedBy.current = 'hotkey'
      setVoiceCaption('')
      recordingTarget.current = settingsRef.current?.voiceTarget ?? 'thread'
      recordingAgent.current = agent.provider ?? settingsRef.current?.agentProvider ?? 'claude'
      await voice.start()
      window.threadlight.openPanelQuietly()
    } catch {
      startedBy.current = null
      setNotice(en.voice.micBlocked)
      window.threadlight.openPanelQuietly()
    }
  }, [
    micLive,
    voice,
    stt.state,
    finishTalk,
    micToggle,
    toggleLive,
    closeAgentSpeech,
    agent.provider,
  ])

  useEffect(() => window.threadlight.onTalkToggle(() => void onTalk()), [onTalk])

  // Press and hold: down starts (or cancels a countdown, as a toggle press would); up sends.
  // A quick tap can be released while the microphone is still opening; that is remembered and
  // the recording finishes as soon as it has started, rather than running on to the time limit.
  const holdReleased = useRef(false)
  const onHold = useCallback(
    async (phase: 'down' | 'up') => {
      if (phase === 'down') {
        holdReleased.current = false
        if (voice.state !== 'listening') await onTalk()
        if (holdReleased.current && startedBy.current === 'hotkey') await finishTalk()
        return
      }
      holdReleased.current = true
      if (voice.state === 'listening' && startedBy.current === 'hotkey') await finishTalk()
    },
    [voice.state, onTalk, finishTalk],
  )
  useEffect(() => window.threadlight.onTalkHold((phase) => void onHold(phase)), [onHold])
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
    if (compose) providerCompose.current[sessionProvider(compose.sessionId)] = null
    setCompose(null)
    // Opened by voice and never clicked: nothing else will close it.
    if (!document.hasFocus()) window.threadlight.closePanel()
  }

  // The panel only shows while the pointer is over it; no delayed close can race a re-entry.
  // Pinned (either list), leaving does nothing at all.
  const leave = useCallback(() => {
    if (drag.isDragging() || hold !== 'normal' || showMemory) return
    // Never hide the panel while the microphone is open or a voice send is counting down:
    // the recording or the send would carry on with nothing on screen to show or stop it.
    if (voice.state !== 'idle' || Date.now() < countdownUntil.current) return
    window.clearTimeout(pendingDoubleClick.current)
    window.threadlight.leavePanel()
  }, [drag, hold, showMemory, voice.state])
  useEffect(() => window.threadlight.onPanelPointerOutside(leave), [leave])
  const changeHold = (next: HoldMode) => {
    // Pinned holds the full list open, pinned active the active list; unpinning goes back to
    // the active list.
    setView(next === 'pinned' ? 'all' : 'active')
    setHold(next)
    window.threadlight.setStayOpen(next !== 'normal')
  }
  // Recent titles plus loaded workspace rows, including child threads. Deduplicate by ID.
  const voiceThreads = new Map(sessions.map((s) => [s.id, s]))
  const voiceFolders = new Map<string, string>()
  for (const workspace of snapshot.workspaces) {
    const collect = (nodes: ThreadNode[]) => {
      for (const node of nodes) {
        voiceThreads.set(node.session.id, node.session)
        voiceFolders.set(node.session.id, workspace.id)
        collect(node.children)
      }
    }
    collect(workspace.threads)
  }
  // Focus only after the chosen row has rendered; repeat commands never collapse it.
  useLayoutEffect(() => {
    if (!voiceFocusPending.current) return
    const row = [...document.querySelectorAll<HTMLElement>('[data-session-id]')].find(
      (element) => element.dataset.sessionId === voiceFocusPending.current,
    )
    const button = row?.querySelector<HTMLButtonElement>('button[aria-expanded]')
    if (!button) return
    button.focus({ preventScroll: true })
    button.scrollIntoView({ block: 'nearest' })
    voiceFocusPending.current = null
  })

  const handleSentence = (route: MicRoute) => {
    if (route.kind === 'agent') {
      void sendAgentSpeech(route.text)
      return
    }
    if (route.kind !== 'command' && route.kind !== 'unmatched') return
    setShowSettings(false)
    setShowAgent(false)
    setPickingWorkspace(false)
    setChangesFor(null)
    setPicking(null)
    window.threadlight.openPanelQuietly()
    changeHold('pinned')
    if (route.kind === 'unmatched') {
      setNotice(en.openMic.unmatched(route.text))
      return
    }
    const command = route.command
    if (command.kind === 'ambiguous') {
      setNotice(en.openMic.ambiguous(command.titles))
      return
    }
    setNotice(null)
    if (command.kind === 'open') {
      setVoiceSelection(null)
      setVoiceWorkspace(null)
      voiceFocusPending.current = null
      return
    }
    const selected = voiceThreads.get(command.threadId)
    if (!selected) return
    const folder =
      voiceFolders.get(selected.id) ??
      snapshot.workspaces.find((w) => sameFolder(w.id, selected.cwd))?.id ??
      null
    setVoiceSelection(selected.id)
    setVoiceWorkspace(folder)
    if (folder) {
      setOpenWorkspaces((open) => [...new Set([...(open ?? []), folder])])
      setMoreWorkspaces((more) => [...new Set([...more, folder])])
    }
    setExpanded(selected.id)
    setMenu(null)
    voiceFocusPending.current = selected.id
  }
  useEffect(() => {
    routeSentence.current = handleSentence
  })

  // The first completed sentence chooses a route until this microphone session closes.
  const {
    state: openMic,
    mode: micMode,
    level: openMicLevel,
    energy: openMicEnergy,
    outputEnergy,
    livePhase,
    liveError: continuousError,
    openingDraft: continuousDraft,
  } = useOpenMic({
    enabled: micLive && stt.state === 'ready',
    nativeLive: (agent.provider ?? settings?.agentProvider) === 'codex',
    paused: voice.state !== 'idle',
    threads: [...voiceThreads.values()],
    onStop: () => setMicLive(false),
    onConversation: () => {
      setShowSettings(false)
      setPickingWorkspace(false)
      setChangesFor(null)
      setShowAgent(true)
      window.threadlight.openPanelQuietly()
    },
    onSentence: handleSentence,
  })
  const liveError =
    settings?.voiceTarget === 'agent' ? (recordedAgentError ?? continuousError) : null
  const openingDraft = recordedAgentError ? recordedAgentDraft : continuousDraft
  const openMicListening = openMic === 'listening' || openMic === 'hearing'
  const visualMode = motionMode({
    recording: voice.state,
    microphone: openMicListening,
    agent: agent.status,
    waitingForReply:
      livePhase === 'waiting' ||
      !!sessions.find((s) => s.id === voiceSendId && s.state === 'working'),
    failed: !!liveError || openMic === 'blocked' || !!voiceError,
  })
  const motion = useMotion(
    visualMode,
    voice.state === 'listening' ? voice.energy : openMicEnergy,
    outputEnergy,
  )
  const lastVoiceItem = agent.items.findLast((item) => item.kind === 'you' || item.kind === 'agent')
  const motionCaption =
    voice.state !== 'idle'
      ? voiceCaption
      : showAgent
        ? lastVoiceItem?.text || openingDraft || voiceCaption
        : voiceCaption
  useEffect(() => window.threadlight.setOpenMicLive(openMicListening), [openMicListening])
  useEffect(() => window.threadlight.onStopOpenMic(() => setMicLive(false)), [])
  useEffect(() => {
    if (!openMicListening) return
    // The panel may be hidden, so use a timer rather than animation frames for the dot's meter.
    const timer = window.setInterval(
      () => window.threadlight.setOpenMicLevel(openMicLevel.current),
      50,
    )
    return () => {
      window.clearInterval(timer)
      window.threadlight.setOpenMicLevel(0)
    }
  }, [openMicListening, openMicLevel])

  // Clicks on the header's bare space: 2 pins the active list, 3 pins the full list. A triple-click arrives
  // as a double-click first, so the double waits a moment in case a third click follows.
  const onHeaderClick = (event: MouseEvent) => {
    if (event.target !== event.currentTarget) return
    if (event.detail === 2) {
      pendingDoubleClick.current = window.setTimeout(
        () => changeHold(hold === 'active' ? 'normal' : 'active'),
        TRIPLE_CLICK_WAIT_MS,
      )
    } else if (event.detail === 3) {
      window.clearTimeout(pendingDoubleClick.current)
      changeHold(hold === 'pinned' ? 'normal' : 'pinned')
    }
  }

  const active = sessions.filter(isActive).length
  // A thread that just went idle stays listed for a while, and the one being written to for as
  // long as the composer is open on it.
  const selectedByVoice = voiceSelection ? voiceThreads.get(voiceSelection) : undefined
  const listed =
    selectedByVoice && !sessions.some((s) => s.id === selectedByVoice.id)
      ? [selectedByVoice, ...sessions]
      : sessions
  const shown =
    view === 'all'
      ? listed
      : listed.filter(
          (s) => isActive(s) || now - s.lastActiveAt < LINGER_MS || s.id === compose?.sessionId,
        )
  // The composer's thread may come from the workspace tree, not just the recent list.
  const target = compose ? findInSnapshot(snapshot, compose.sessionId) : undefined

  // The full list: recent threads, or the same rows wrapped in workspaces (Settings → list).
  const listMode = settings?.listMode ?? 'recent'
  const tree =
    provider !== 'none' &&
    view === 'all' &&
    listMode !== 'recent' &&
    (!voiceSelection || voiceWorkspace !== null)
  // The Workspace list shows the chosen workspace, or (Follow Claude) the one last open in Claude.
  // A chosen folder that no longer has any threads falls back to following Claude.
  const chosen =
    (provider === 'both'
      ? settings?.combinedFocusWorkspace
      : provider === 'codex'
        ? settings?.codexFocusWorkspace
        : settings?.focusWorkspace) ?? null
  const focusId =
    voiceWorkspace ??
    (chosen && snapshot.allWorkspaces.some((w) => sameFolder(w.id, chosen))
      ? chosen
      : snapshot.currentWorkspace)
  const focus = focusId
    ? (snapshot.allWorkspaces.find((w) => sameFolder(w.id, focusId)) ?? {
        id: focusId,
        name: focusId.split(/[\\/]/).filter(Boolean).pop() ?? focusId,
      })
    : null
  const windowText = windowLabel(settings?.listWindowHours ?? 24)
  const focusGroups = snapshot.workspaces.filter(
    (w) =>
      focusId &&
      (provider === 'both'
        ? workspaceFolder(w.id) === workspaceFolder(focusId)
        : sameFolder(w.id, focusId)),
  )
  const focusGroupKeys = focusGroups.map((w) => w.id).join('\n')
  const treeFocus = focus ? { ...focus, ids: focusGroups.map((w) => w.id) } : null
  const pickerWorkspaces =
    provider === 'both'
      ? [
          ...new Map(
            snapshot.allWorkspaces.map((w) => [
              workspaceFolder(w.id),
              { ...w, name: w.name.replace(/^(Claude|Codex) · /, '') },
            ]),
          ).values(),
        ]
      : snapshot.allWorkspaces
  const pickerId = (id: string | null) =>
    id && provider === 'both'
      ? (pickerWorkspaces.find((w) => workspaceFolder(w.id) === workspaceFolder(id))?.id ?? id)
      : id
  const headerView = view === 'active' ? 'active' : listMode
  const viewLabel =
    headerView === 'active'
      ? 'Active'
      : headerView === 'recent'
        ? 'Recent'
        : headerView === 'workspace'
          ? 'Workspace'
          : 'All'
  const viewCount =
    headerView === 'active'
      ? active
      : headerView === 'workspace'
        ? focusGroups.reduce((count, group) => count + group.threadCount, 0)
        : headerView === 'all'
          ? snapshot.workspaces.length
          : sessions.length
  const workspaceName = focus?.name.replace(/^(Claude|Codex) · /, '') ?? 'Workspace'
  const sourceLabel =
    provider === 'both'
      ? 'Both'
      : provider === 'codex'
        ? 'Codex'
        : provider === 'claude'
          ? 'Claude'
          : 'Apps'
  const selectList = async (mode: 'recent' | 'workspace' | 'all') => {
    setVoiceSelection(null)
    setVoiceWorkspace(null)
    if (mode === listMode) {
      setView('all')
      return
    }
    const result = await window.threadlight.updateSettings({ listMode: mode })
    if (result.ok) setView('all')
    else setNotice(result.reason)
  }
  const cycleView = () => {
    if (view === 'active') void selectList('recent')
    else if (listMode === 'recent') void selectList('workspace')
    else {
      setVoiceSelection(null)
      setVoiceWorkspace(null)
      setView('active')
    }
  }
  // The view control owns the former workspace label's right-click shortcuts.
  const onListMenu = (event: MouseEvent) => {
    event.preventDefault()
    setListMenu({ x: event.clientX, y: event.clientY })
  }
  const LIST_MODES = [
    { mode: 'recent', label: en.settings.listRecent },
    { mode: 'workspace', label: en.settings.listWorkspace },
    { mode: 'all', label: en.settings.listAll },
  ] as const
  const listMenuItems = [
    { label: 'Active', disabled: view === 'active', onSelect: () => setView('active') },
    ...LIST_MODES.map(({ mode, label }) => ({
      label,
      disabled: view === 'all' && listMode === mode,
      onSelect: () => void selectList(mode),
    })),
  ]
  const sourceMenuItems = [
    { label: 'Codex', providers: ['codex'] as const },
    { label: 'Claude', providers: ['claude'] as const },
    { label: 'Both', providers: ['claude', 'codex'] as const },
  ].map(({ label, providers }) => ({
    label,
    disabled: label === sourceLabel,
    onSelect: async () => {
      const result = await window.threadlight.updateSettings({ enabledProviders: [...providers] })
      if (!result.ok) setNotice(result.reason)
    },
  }))

  // The Changes view's heading: "main · 3 files".
  const changesThread = changesFor ? findInSnapshot(snapshot, changesFor) : undefined
  const changesHeading = changesThread?.git
    ? `${changesThread.git.branch ?? en.git.noBranch} · ${en.changes.files(changesThread.git.files)}`
    : en.changes.title
  const pickWorkspace = async (id: string | null) => {
    setVoiceSelection(null)
    setVoiceWorkspace(null)
    await window.threadlight.updateSettings({
      ...(provider === 'both'
        ? { combinedFocusWorkspace: id }
        : provider === 'codex'
          ? { codexFocusWorkspace: id }
          : { focusWorkspace: id }),
      listMode: 'workspace',
    })
    setPickingWorkspace(false)
    setShowSettings(false)
    setView('all') // straight to that workspace's threads
  }
  const isOpen = (id: string) =>
    (openWorkspaces ?? (snapshot.currentWorkspace ? [snapshot.currentWorkspace] : [])).some((w) =>
      sameFolder(w, id),
    )
  const toggleWorkspace = (id: string) => {
    const open = openWorkspaces ?? (snapshot.currentWorkspace ? [snapshot.currentWorkspace] : [])
    setOpenWorkspaces(isOpen(id) ? open.filter((w) => !sameFolder(w, id)) : [...open, id])
  }

  // Tell the main process which workspaces can be seen, so it reads only their transcripts.
  useEffect(() => {
    if (!tree) return window.threadlight.setTreeView({ expanded: [], showAll: [] })
    if (listMode === 'workspace') {
      const only = focusGroupKeys ? focusGroupKeys.split('\n') : focusId ? [focusId] : []
      return window.threadlight.setTreeView({ expanded: only, showAll: only })
    }
    window.threadlight.setTreeView({ expanded: openWorkspaces, showAll: moreWorkspaces })
  }, [tree, listMode, focusId, focusGroupKeys, openWorkspaces, moreWorkspaces, enabledKey])

  const openMenu = (event: MouseEvent, session: Session) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, session })
  }
  const menuItems = (session: Session): MenuItem[] => [
    { label: en.menu.compose, onSelect: () => setCompose({ sessionId: session.id }) },
    {
      label: session.provider === 'codex' ? 'Open in Codex' : en.menu.openInClaude,
      disabled: !session.appId,
      onSelect: () => session.appId && window.threadlight.openInClaude(session.appId),
    },
  ]

  /** One thread row, the same in the recent list and inside a workspace. */
  const renderRow = (session: Session) => (
    <SessionRow
      key={session.id}
      session={session}
      showProvider={provider === 'both'}
      relay={relays.get(session.id)}
      composing={session.id === compose?.sessionId}
      now={now}
      expanded={!picking && expanded === session.id}
      onToggle={() => onRowClick(session)}
      onContextMenu={(event) => openMenu(event, session)}
      onCompose={() => setCompose({ sessionId: session.id })}
      hideAge={view === 'active'}
      onShowChanges={() => setChangesFor(session.id)}
    />
  )

  const onRowClick = (session: Session) => {
    if (picking) {
      // Picking a thread for speech that did not name one clearly.
      setCompose({ sessionId: session.id, initialText: picking.text })
      setPicking(null)
      return
    }
    setExpanded(expanded === session.id ? null : session.id)
  }

  const agentVisible = showAgent && !pickingWorkspace && !changesFor
  const showVoiceActivity =
    voice.state !== 'idle' || micLive || agentVisible || Boolean(voiceSendId)
  const listHidden =
    showMemory || showSettings || pickingWorkspace || showAgent || changesFor !== null

  return (
    <PanelRoomContext.Provider value={panelRoom}>
      <div
        ref={card}
        data-card=""
        className={styles.card}
        // Room above the card, when opening upwards, keeps the card in place on screen.
        style={{ maxHeight, marginTop: opensDown ? 0 : room }}
        onMouseLeave={leave}
      >
        <header className={styles.header} onClick={onHeaderClick} {...drag.handlers}>
          {showVoiceActivity && (
            <div className={styles.voiceActivity} role="region" aria-label="Voice waveform">
              <ElectricMotion source={motion.source} label={motion.label} />
            </div>
          )}
          {pickingWorkspace ? (
            <>
              <button
                className={styles.back}
                onClick={() => setPickingWorkspace(false)}
                aria-label={en.settings.back}
                title={en.settings.back}
              >
                ‹
              </button>
              <span className={`${styles.heading} ${styles.pageHeading}`}>
                {en.panel.chooseWorkspace}
              </span>
            </>
          ) : changesFor ? (
            <>
              <button
                className={styles.back}
                onClick={() => setChangesFor(null)}
                aria-label={en.settings.back}
                title={en.settings.back}
              >
                ‹
              </button>
              <span className={`${styles.heading} ${styles.pageHeading}`} title={changesHeading}>
                {changesHeading}
              </span>
            </>
          ) : showAgent ? (
            <>
              <button
                className={styles.back}
                onClick={() => setShowAgent(false)}
                aria-label={en.settings.back}
                title={en.settings.back}
              >
                ‹
              </button>
              {hold !== 'normal' && (
                <span role="img" aria-label="Pinned open" title="Pinned open">
                  <PinIcon />
                </span>
              )}
              <span className={`${styles.heading} ${styles.pageHeading}`}>{en.agent.title}</span>
            </>
          ) : showMemory ? (
            <>
              <button
                className={styles.back}
                aria-label="Back in Shared Spaces"
                onClick={() => spacesNavigation.current?.back()}
              >
                ‹
              </button>
              <span className={`${styles.heading} ${styles.pageHeading}`}>Shared Spaces</span>
            </>
          ) : showSettings ? (
            <>
              <button
                className={styles.back}
                onClick={() => setShowSettings(false)}
                aria-label={en.settings.back}
                title={en.settings.back}
              >
                ‹
              </button>
              <span className={`${styles.heading} ${styles.pageHeading}`}>{en.settings.title}</span>
            </>
          ) : (
            <>
              {hold !== 'normal' && (
                <button
                  className={styles.unpin}
                  aria-label={en.panel.unpin}
                  title={en.panel.unpin}
                  onClick={() => changeHold('normal')}
                >
                  <PinIcon />
                </button>
              )}
              <button
                className={styles.viewControl}
                data-thread-view={headerView}
                aria-pressed={view === 'all'}
                aria-haspopup="menu"
                onContextMenu={onListMenu}
                onClick={cycleView}
              >
                {viewLabel} · {viewCount}
              </button>
              <div className={styles.sourceWorkspace}>
                <button
                  className={styles.sourceControl}
                  aria-label={`Filter applications: ${sourceLabel}`}
                  aria-haspopup="menu"
                  aria-expanded={sourceMenu !== null}
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect()
                    setSourceMenu({
                      x: box.left,
                      y: box.bottom + 2,
                      anchor: event.currentTarget.closest('header') ?? event.currentTarget,
                    })
                  }}
                >
                  {sourceLabel}
                </button>
                <span aria-hidden="true">·</span>
                <button
                  className={styles.workspaceControl}
                  aria-label={`Choose workspace: ${workspaceName}`}
                  onClick={() => setPickingWorkspace(true)}
                >
                  {workspaceName}
                </button>
              </div>
              {
                <button
                  className={agentBusy ? `${styles.gear} ${styles.agentBusy}` : styles.gear}
                  onClick={() => setShowAgent(true)}
                  aria-label={agentBusy ? en.agent.busy : en.agent.open}
                  title={agentBusy ? en.agent.busy : en.agent.open}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" />
                  </svg>
                </button>
              }
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

        {showVoiceActivity && (
          <VoicePresence
            label={motion.label}
            microphone={openMicListening || voice.state === 'listening'}
            caption={motionCaption}
          />
        )}

        {pickingWorkspace && (
          <div className={styles.list}>
            <WorkspacePicker
              provider={provider}
              workspaces={pickerWorkspaces}
              chosen={pickerId(chosen)}
              current={pickerId(snapshot.currentWorkspace)}
              onPick={(id) => void pickWorkspace(id)}
            />
          </div>
        )}

        {changesFor && !pickingWorkspace && (
          <ChangesView
            key={changesFor}
            sessionId={changesFor}
            stamp={JSON.stringify(changesThread?.git ?? null)}
          />
        )}

        {openMic === 'blocked' && (
          <p className={styles.notice} role="alert">
            {en.openMic.blocked}
          </p>
        )}
        {micLive && openMic !== 'blocked' && (
          <p className={styles.notice} role="status" data-mic-mode={micMode}>
            {micMode === 'agent'
              ? livePhase === 'live'
                ? 'Live · Speak naturally; press the hotkey to finish'
                : livePhase === 'waiting'
                  ? 'Live · Waiting for a reply; you can keep talking'
                  : livePhase === 'error'
                    ? 'Live could not connect · Your opening message is kept below'
                    : livePhase === 'ready'
                      ? 'Live ready · Finish your opening sentence'
                      : 'Connecting Live · Keep talking'
              : en.openMic.mode(micMode)}
          </p>
        )}
        {showAgent && !pickingWorkspace && !changesFor && (
          <>
            {liveError && (
              <div className={styles.picking} aria-label="Live voice error">
                <p role="alert">{liveError}</p>
                {openingDraft && (
                  <>
                    <span className={styles.pickText}>{openingDraft}</span>
                    <button onClick={() => window.threadlight.copyText(openingDraft)}>
                      Copy opening message
                    </button>
                  </>
                )}
              </div>
            )}
            <AgentView />
          </>
        )}

        <SharedSpacesView
          navigationRef={spacesNavigation}
          visible={showMemory && !showAgent && !pickingWorkspace && changesFor === null}
          sessions={snapshot.lookupSessions ?? snapshot.sessions}
          onClose={() => {
            setShowMemory(false)
            window.threadlight.setStayOpen(hold !== 'normal')
          }}
        />
        {showSettings && settings && !pickingWorkspace && !showAgent && !showMemory && (
          <SettingsView
            providerLocked={voice.state !== 'idle'}
            settings={settings}
            stt={stt}
            version={version}
            onPickWorkspace={() => setPickingWorkspace(true)}
            onOpenMemory={() => {
              setShowMemory(true)
              window.threadlight.setStayOpen(true)
            }}
          />
        )}

        {/* Kept mounted (just hidden) while settings show, so a half-typed message survives. */}
        <div className={styles.sessions} hidden={listHidden}>
          {(hotkeyProblem || notice) && <p className={styles.notice}>{notice ?? hotkeyProblem}</p>}
          {picking && (
            <div className={styles.picking}>
              <span className={styles.pickHead}>
                <span className={styles.pickPrompt}>
                  {picking.heardThread
                    ? en.voice.noMatch(picking.heardThread)
                    : en.voice.pickThread}
                </span>
                {/* Not for any thread after all: throw it away. */}
                <button
                  className={styles.pickClose}
                  aria-label={en.voice.discard}
                  title={en.voice.discard}
                  onClick={() => setPicking(null)}
                >
                  ×
                </button>
              </span>
              <span className={styles.pickText}>“{picking.text}”</span>
            </div>
          )}

          <div className={styles.list}>
            {tree ? (
              <WorkspaceTree
                workspaces={snapshot.workspaces}
                only={listMode === 'workspace' ? treeFocus : null}
                isOpen={isOpen}
                onToggle={toggleWorkspace}
                onShowMore={(id) => setMoreWorkspaces((list) => [...list, id])}
                emptyMessage={en.nothingInWindow(windowText)}
                renderRow={renderRow}
              />
            ) : (
              <>
                {shown.length === 0 && (
                  <p className={styles.empty}>
                    {provider === 'none'
                      ? en.sources.paused
                      : view === 'active'
                        ? en.panel.nothingWorking
                        : en.nothingInWindow(windowText)}
                  </p>
                )}
                {shown.map(renderRow)}
              </>
            )}
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

        <div className={styles.usageBars} data-parallel={provider === 'both' || undefined}>
          {/* Claude keeps its existing window choice; Codex always shows its weekly quota. */}
          {usage && enabled.includes('claude') && (
            <UsageBar
              usage={usage}
              weekly={view === 'all' && !listHidden}
              source={provider === 'both' ? 'Claude' : undefined}
            />
          )}
          {enabled.includes('codex') && <CodexUsageBar usage={snapshot.codexUsage} />}
        </div>

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems(menu.session)}
            onClose={() => setMenu(null)}
          />
        )}
        {listMenu && (
          <ContextMenu
            x={listMenu.x}
            y={listMenu.y}
            items={listMenuItems}
            onClose={() => setListMenu(null)}
          />
        )}
        {sourceMenu && (
          <ContextMenu
            x={sourceMenu.x}
            y={sourceMenu.y}
            anchor={sourceMenu.anchor}
            items={sourceMenuItems}
            onClose={() => setSourceMenu(null)}
          />
        )}
      </div>
    </PanelRoomContext.Provider>
  )
}
