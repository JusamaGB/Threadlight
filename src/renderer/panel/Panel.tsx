import { PANEL_BROWSER_THREAD } from '../../shared/browser'
import { useBrowserCaptions } from '../hooks/useBrowserCaptions'
import type { ChangeLens } from '../../shared/changes'
import { useAppControl } from '../hooks/useAppControl'
import type { AppliedRoute } from '../../shared/appControl'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type MouseEvent,
  type ReactNode,
  type CSSProperties,
} from 'react'

import { matchThread, parseVoiceCommand } from '../../shared/match'
import { headerWireColour } from '../../shared/workspaceWires'
import { ActivePeek, PinnedThreadReader } from './ActivePeek'
import { RECENT_AGENT_MS } from '../../shared/agent'
import {
  NavigationHistoryContext,
  useNavigationHistory,
  type NavigationCache,
} from '../hooks/useNavigationHistory'
import type { NavigationDirection, NavigationHandle } from '../../shared/navigationHistory'
import {
  DEFAULT_ENABLED_PROVIDERS,
  isWorkspaceRoot,
  sessionProvider,
  workspaceFolder,
  workspaceInScope,
} from '../../shared/providers'
import type { Provider, Session, ThreadNode, Workspace, RelayStatus } from '../../shared/types'
import { ThreadComposerContext } from './ThreadComposer'
import { Composer } from '../composer/Composer'
import { useDotDrag } from '../hooks/useDotDrag'
import { useAgent } from '../hooks/useAgent'
import { useNow } from '../hooks/useNow'
import { useRelays } from '../hooks/useRelays'
import { findInSnapshot } from '../../shared/snapshot'
import { workspaceSessions } from '../../shared/workspaceSessions'
import { recentSessions } from '../../shared/sessionOrder'
import { useSnapshot } from '../hooks/useSnapshot'
import { useSettings } from '../hooks/useSettings'
import { useStt } from '../hooks/useStt'
import { useUsage } from '../hooks/useUsage'
import { CallIcon } from './CallIcon'
import { LIVE_MUTE_KEYS, acceleratorLabel } from '../../shared/accelerator'
import { isGptLiveShortcut } from '../../shared/settings'
import { useOpenMic, type OpenMicControls } from '../hooks/useOpenMic'
import {
  anchorInputCaption,
  LiveInputContext,
  type LiveInputPreview,
} from '../lib/liveInputPreview'
import { useVoice } from '../hooks/useVoice'
import { useRecordedAgentVoice } from '../hooks/useRecordedAgentVoice'
import { MicSessionRouter, type MicRoute } from '../../shared/voiceCommands'
import { en } from '../i18n/en'
import { flushSync } from 'react-dom'
import { animateListLayout, cancelListLayout, ROW_FLIP_MS } from './listLayoutMotion'
import { SettingsView, Stepper } from '../settings/SettingsView'
import { Tip } from './Tip'
import {
  SharedSpacesView,
  type SpacesHeader,
  type SpacesNavigation,
} from '../spaces/SharedSpacesView'
import { AgentView, type AgentNavigation } from './AgentView'
import { ArtifactView } from './ArtifactView'
import { ChangesView } from './ChangesView'
import { CardChangesContext } from './ThreadFileChanges'
import type { TimelineItem } from '../../shared/threadTimeline'
import { ContextMenu, type MenuItem } from './ContextMenu'
import type { NewThreadRequest } from '../../shared/newThread'
import styles from './Panel.module.css'
import { PanelRoomContext, type PanelRoomSource } from './room'
import { HoverHelp } from './HoverHelp'
import { HoverFooter } from './HoverFooter'
import { ProviderErrors } from './ProviderErrors'
import type { HelpMode } from './helpMode'
import { SessionRow } from './SessionRow'
import { AccountChats } from './AccountChats'
import { useAccountChatDiscovery, useAccountChatState } from '../hooks/useAccountChats'
import { visibleAccountChats } from '../../shared/accountChats'
import type { ChatSource, ConversationFilter } from '../../shared/accountChats'
import { CodexUsageBar, UsageBar } from './UsageBar'
import { WorkspacePicker } from './WorkspacePicker'
import { sameFolder, WorkspaceTree } from './WorkspaceTree'
import { motionMode, SILENT_AUDIO } from '../../shared/motion'
import { useMotion } from '../hooks/useMotion'
import { presentSpokenReply, type SpokenExample } from '../../shared/spokenReply'
import { VoicePresence } from '../motion/VoicePresence'
import type { AgentClient } from '../lib/agentClient'
import type { LiveVoicePort } from '../lib/liveVoice'
import { watchScreenReplies } from '../lib/screenReplyPlayback'
import { installReplyCodePan } from '../lib/replyCodePan'
import { CodePinsProvider, PinnedCodeDock, replyCodeBlocks } from './ReplyCode'
import { ElectricMotion } from '../motion/ElectricMotion'
import { WorkspaceLinks } from './WorkspaceLinks'
import { WorkspaceResize, WORKSPACE_MIN_HEIGHT, WORKSPACE_RESIZE_HINT } from './WorkspaceResize'
import { TimeWindowMessage } from './TimeWindowMessage'

type View = 'active' | 'all'

type HoldMode = 'normal' | 'pinned'
function BackIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path
        d="M8 2 4 5 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.6 1h2.8l.4 2 1.3.7 1.9-.7 1.4 2.4-1.5 1.3v1.6l1.5 1.3-1.4 2.4-1.9-.7-1.3.7-.4 2H6.6l-.4-2-1.3-.7-1.9.7L1.6 9.6l1.5-1.3V6.7L1.6 5.4 3 3l1.9.7L6.2 3z" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  )
}

function AgentDiamond() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8 .5C9 5.8 10.2 7 15.5 8C10.2 9 9 10.2 8 15.5C7 10.2 5.8 9 .5 8C5.8 7 7 5.8 8 .5ZM8 4.7Q8.9 7.1 11.3 8Q8.9 8.9 8 11.3Q7.1 8.9 4.7 8Q7.1 7.1 8 4.7Z"
      />
    </svg>
  )
}
function HeaderBack({
  buttonRef,
  onBack,
  collapsePinned,
  label,
}: {
  onBack: () => void
  collapsePinned?: () => void
  buttonRef?: Ref<HTMLButtonElement>
  label: string
}) {
  const hint = collapsePinned ? 'Collapse pinned thread' : label
  return (
    <button
      className={styles.back}
      ref={buttonRef}
      aria-label={hint}
      title={hint}
      onClick={collapsePinned ?? onBack}
    >
      <BackIcon />
    </button>
  )
}
/** After a voice send is answered, an untouched panel turns back into the dot. */
const VOICE_CLOSE_AFTER_MS = 4000
/** Unread replies keep their place in Active for ten minutes after the last activity. */
const UNREAD_ACTIVE_MS = 10 * 60_000
const isActive = (s: Session, now: number) =>
  s.state === 'working' ||
  s.state === 'waiting' ||
  (!!s.unread && now - s.lastActiveAt < UNREAD_ACTIVE_MS)
/** A thread that has just gone idle stays in the Active list this long, so its reply can be read. */
const LINGER_MS = 30_000
/** Longer than the card's width transition, so the window only narrows once the card has. */
const LAYOUT_CARD_MS = 320

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
  useEffect(() => watchScreenReplies(window.threadlight), [])
  useEffect(installReplyCodePan, [])
  const { snapshot, markThreadRead } = useSnapshot()
  const sessions = snapshot.sessions
  const relays = useRelays()
  const stt = useStt()
  const settings = useSettings()
  const conversationFilter = settings?.conversationFilter ?? 'code-computer'
  const showCode = conversationFilter !== 'chat'
  const showChats = conversationFilter !== 'code-computer'
  const chatSources = settings?.chatSources ?? ['chatgpt', 'perplexity']
  const accountChatState = useAccountChatState()
  const enabled = settings?.enabledProviders ?? DEFAULT_ENABLED_PROVIDERS
  const provider = enabled.length === 2 ? 'both' : (enabled[0] ?? 'none')
  const providerCompose = useRef<Partial<Record<'claude' | 'codex', ComposeState | null>>>({})
  const previousProviders = useRef(enabled)
  // Refresh both the ordinary idle linger and unread expiry, even without a new snapshot.
  const now = useNow(5000)
  const [view, setView] = useState<View>('active')
  const [controlList, setControlList] = useState<'recent' | 'all' | 'workspace' | null>(null)
  const [spacesRoute, setSpacesRoute] = useState<Extract<AppliedRoute, { page: 'spaces' }>>({
    page: 'spaces',
    area: 'library',
  })
  const [spacesHeader, setSpacesHeader] = useState<SpacesHeader | null>(null)
  const [brainstormNotice, setBrainstormNotice] = useState<string | null>(null)
  const changeSpacesHeader = useCallback((header: SpacesHeader | null) => {
    setSpacesHeader(header)
    if (header) setBrainstormNotice(null)
  }, [])
  const [controlRefs, setControlRefs] = useState<Record<string, string>>({})
  const [controlArtifact, setControlArtifact] = useState<{
    threadId: string
    id: string
    readiness: 'ready' | 'loading' | 'unavailable'
  } | null>(null)
  const [keyboardPeek, setKeyboardPeek] = useState(false)
  const usage = useUsage()
  /** The settings list takes over the panel's card while this is true. */
  const [showSettings, setShowSettings] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null)
  const canvasAvailable = showMemory && !!spacesHeader?.canvas
  useEffect(() => {
    if (!canvasAvailable) {
      void window.threadlight.setCanvasExpanded?.(false)?.then(() => setCanvasSize(null))
    }
  }, [canvasAvailable])
  const [voiceDestination, setVoiceDestination] = useState<AgentClient | null>(null)
  const voiceDestinationRef = useRef<AgentClient | null>(null)
  const spacesNavigation = useRef<SpacesNavigation>(null)
  const agentNavigation = useRef<AgentNavigation>(null)
  const artifactNavigation = useRef<NavigationHandle>(null)
  const changesNavigation = useRef<NavigationHandle>(null)
  /** The agent conversation takes over the card, like settings. */
  const [agentPage, setAgentPage] = useState({ visible: false, visited: false })
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false)
  const [callReplySlot, setCallReplySlot] = useState<HTMLSpanElement | null>(null)
  const agentGear = useRef<HTMLButtonElement>(null)
  const agentBack = useRef<HTMLButtonElement>(null)
  const closeAgentSettings = useCallback(() => {
    setAgentSettingsOpen(false)
    requestAnimationFrame(() => agentGear.current?.focus())
  }, [])
  const showAgent = agentPage.visible
  const setShowAgent = useCallback((visible: boolean) => {
    setAgentSettingsOpen(false)
    setAgentPage((previous) => ({ visible, visited: previous.visited || visible }))
  }, [])
  const [artifactNavigationHost, setArtifactNavigationHost] = useState<HTMLDivElement | null>(null)
  const [artifactActionsHost, setArtifactActionsHost] = useState<HTMLDivElement | null>(null)
  const [artifactInfoHost, setArtifactInfoHost] = useState<HTMLDivElement | null>(null)
  const [artifactThread, setArtifactThread] = useState<{
    id: string
    title: string
    artifactId?: string
    navigationKey: string
    agentConversationId?: string
  } | null>(null)
  // The agent keeps working while another page shows; its button then says so.
  const agent = useAgent()
  const [recentEntry, setRecentEntry] = useState<{ id: string } | null>(null)
  const clearRecentEntry = useCallback(() => setRecentEntry(null), [])
  const voiceAgent = useAgent(voiceDestination ?? undefined)
  const [liveInput, setLiveInput] = useState<LiveInputPreview | null>(null)
  const agentBusy =
    !showAgent &&
    (agent.status === 'starting' ||
      agent.status === 'working' ||
      agent.status === 'waiting' ||
      agent.status === 'stopping')
  const [changesFor, setChangesFor] = useState<
    | ({ sessionId: string } & (
        | {
            scope: 'thread' | 'worktree'
            lens?: ChangeLens
            rootId?: string
            navigationKey?: string
          }
        | { scope: 'card'; card: TimelineItem }
      ))
    | null
  >(null)
  const [comparisonRoot, setComparisonRoot] = useState<string | undefined>(undefined)
  const [comparisonLens, setComparisonLens] = useState<ChangeLens>('git-current')
  const [comparisonReadiness, setComparisonReadiness] = useState<
    'ready' | 'loading' | 'unavailable'
  >('loading')
  const [comparisonScope, setComparisonScope] = useState<'thread' | 'worktree'>('thread')
  const [comparisonHeading, setComparisonHeading] = useState<string | null>(null)
  const openCardChanges = useCallback((sessionId: string, item: TimelineItem) => {
    setChangesFor({ sessionId, scope: 'card', card: structuredClone(item) })
  }, [])
  /** Choosing which workspace the Workspace list shows; takes over the card like settings. */
  const [pickingWorkspace, setPickingWorkspace] = useState(false)
  /** Open workspaces in the "All" list; null until changed means "just the current one". */
  const [openWorkspaces, setOpenWorkspaces] = useState<string[] | null>(null)
  /** Workspaces showing every thread, not just the most recent few. */
  const [moreWorkspaces, setMoreWorkspaces] = useState<string[]>([])
  const [savingSessionLimit, setSavingSessionLimit] = useState(false)
  const [workspaceDragHeight, setWorkspaceDragHeight] = useState<number | null>(null)
  const [savingWorkspaceHeight, setSavingWorkspaceHeight] = useState(false)
  const [version, setVersion] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pinnedThread, setPinnedThread] = useState<string | null>(null)
  const [voiceSelection, setVoiceSelection] = useState<string | null>(null)
  const [voiceWorkspace, setVoiceWorkspace] = useState<string | null>(null)
  const voiceFocusPending = useRef<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** The list button's right-click menu of the other kinds of full list, where it opened. */
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null)
  const [creatingThread, setCreatingThread] = useState(false)
  const [creationNotice, setCreationNotice] = useState<string | null>(null)
  const creationBusy = useRef(false)
  const [sourceMenu, setSourceMenu] = useState<{
    kind?: 'threads'
    x: number
    y: number
    anchor: HTMLElement
  } | null>(null)
  // Dual shows Claude and Codex side by side, so it needs both. It belongs to the Recent and
  // Workspace lists: Active is short and the All list is a tree, so those stay in one column.
  // The saved choice is kept, and comes back when the view does.
  const bothProviders = enabled.includes('claude') && enabled.includes('codex')
  const dualView =
    view === 'all' && (settings?.listMode === 'recent' || settings?.listMode === 'workspace')
  // Artifacts use the full dual-width card regardless of provider or saved list layout.
  // Other pages use the thin card. Closing a page restores the saved list layout.
  const onPage = showMemory || showSettings || showAgent || artifactThread !== null
  const wantDual =
    !keyboardPeek &&
    (artifactThread !== null ||
      (showCode && settings?.panelLayout === 'dual' && bothProviders && dualView && !onPage))
  const [layout, setLayout] = useState({
    wide: false,
    dual: false,
    split: false,
    instant: true,
    width: 475,
  })
  const layoutApplied = useRef(false)
  const [rightWireGutter, setRightWireGutter] = useState(0)
  const wireGutterRevision = useRef(0)
  const updateWireGutter = useCallback((width: number) => {
    setRightWireGutter(width)
    const revision = ++wireGutterRevision.current
    void Promise.resolve(window.threadlight.setWorkspaceWireGutter(width)).then((result) => {
      if (result && revision === wireGutterRevision.current)
        setLayout((layout) =>
          layout.wide && layout.width !== result.cardWidth
            ? { ...layout, width: result.cardWidth }
            : layout,
        )
    })
  }, [])
  // Which saved layout the last pass saw, to tell the Dual view toggle from a view or page change.
  const lastLayoutSetting = useRef<string | null>(null)
  const listElement = useRef<HTMLDivElement>(null)
  /**
   * Runs `update`, then glides every thread row from where it was to where it now is. Splitting
   * slides rows sideways first and then closes the gaps; merging opens the gaps first.
   */
  const flipRows = (update: () => void, order: 'sideways-first' | 'vertical-first') => {
    const list = listElement.current
    if (!list) return flushSync(update)
    animateListLayout(list, () => flushSync(update), order)
  }
  useEffect(() => {
    if (!settings) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const after = (ms: number, action: () => void) =>
      timers.push(setTimeout(() => !cancelled && action(), ms))
    const frames = (action: () => void) =>
      requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && action()))
    const first = !layoutApplied.current
    layoutApplied.current = true
    // Choosing Dual or Single view glides the rows between the columns. Moving between lists or
    // pages changes the rows themselves, so there the columns just open and close with the card.
    const toggled =
      lastLayoutSetting.current !== null && lastLayoutSetting.current !== settings.panelLayout
    const instant =
      first || keyboardPeek || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (instant && listElement.current) cancelListLayout(listElement.current)
    const run = async () => {
      if (wantDual) {
        // The window widens first (the card stays against its right edge); then the card grows,
        // and once it has, the rows pull apart into their columns and close up.
        const result = await window.threadlight.setPanelLayout('dual')
        if (cancelled || !result) return
        if (instant) {
          setLayout({ wide: true, dual: true, split: true, instant: true, width: result.cardWidth })
          frames(() => setLayout((l) => ({ ...l, instant: false })))
          return
        }
        setLayout((l) => ({ ...l, wide: true, width: result.cardWidth, instant: false }))
        if (!toggled) {
          frames(() => setLayout((l) => ({ ...l, dual: true, split: true })))
          return
        }
        frames(() => setLayout((l) => ({ ...l, dual: true })))
        after(LAYOUT_CARD_MS + 60, () =>
          flipRows(() => setLayout((l) => ({ ...l, split: true })), 'sideways-first'),
        )
      } else if (layout.wide) {
        if (instant) {
          setLayout((l) => ({ ...l, dual: false, split: false, instant: true }))
          after(0, async () => {
            await window.threadlight.setPanelLayout('single')
            if (!cancelled) setLayout((l) => ({ ...l, wide: false, instant: false }))
          })
          return
        }
        void window.threadlight.setPanelLayout('dual', true)
        if (onPage || !toggled) {
          // The list is out of sight, or is about to be a different one, so there are no rows to
          // bring back together: the card narrows at once and the window follows it.
          after(0, () => setLayout((l) => ({ ...l, split: false, dual: false })))
          after(LAYOUT_CARD_MS, async () => {
            await window.threadlight.setPanelLayout('single')
            if (!cancelled) setLayout((l) => ({ ...l, wide: false }))
          })
          return
        }
        // The rows come back together first, then the card narrows, then the window follows it.
        // Not synchronously: React will not flush a forced update from inside an effect.
        after(0, () => flipRows(() => setLayout((l) => ({ ...l, split: false })), 'vertical-first'))
        after(ROW_FLIP_MS, () => setLayout((l) => ({ ...l, dual: false })))
        after(ROW_FLIP_MS + LAYOUT_CARD_MS, async () => {
          await window.threadlight.setPanelLayout('single')
          if (!cancelled) setLayout((l) => ({ ...l, wide: false }))
        })
      } else if (first) {
        setLayout((l) => ({ ...l, instant: false }))
      }
    }
    void run()
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of layout runs this
  }, [settings === null, wantDual])
  // Remembered after the pass above has compared against it, whether or not that pass ran.
  useEffect(() => {
    lastLayoutSetting.current = settings?.panelLayout ?? null
  }, [settings?.panelLayout])
  /** The composer is hidden while this is null. */
  const [compose, setCompose] = useState<ComposeState | null>(null)
  const [inlineView, setInlineView] = useState<{ id: string; reading: boolean } | null>(null)
  const [inlineFocus, setInlineFocus] = useState<{ id: string; token: number } | null>(null)
  const reportInlineComposer = useCallback((id: string, reading: boolean | null) => {
    if (reading === null) setInlineFocus((previous) => (previous?.id === id ? null : previous))
    setInlineView((previous) =>
      reading === null
        ? previous?.id === id
          ? null
          : previous
        : previous?.id === id && previous.reading === reading
          ? previous
          : { id, reading },
    )
  }, [])
  const dictationTarget = useRef<string | null>(null)
  const answerDictation = useRef<{ id: string; receive: (text: string) => void } | null>(null)
  const [dictationSession, setDictationSession] = useState<string | null>(null)
  /** Speech that needs a thread picked before it can be sent. */
  const [picking, setPicking] = useState<{ text: string; heardThread: string | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activePinError, setActivePinError] = useState<string | null>(null)
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null)
  const [maxHeight, setMaxHeight] = useState(800)
  const [opensDown, setOpensDown] = useState(true)
  /** Extra window height a pop-up asked for (see room.ts). */
  const [room, setRoom] = useState(0)
  const [heard, setHeard] = useState<{ text: string; n: number; sessionId: string | null } | null>(
    null,
  )
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [agentVoiceCaption, setAgentVoiceCaption] = useState('')
  const [recordingOwner, setRecordingOwner] = useState<'agent' | 'thread'>('thread')
  const [cancelToken, setCancelToken] = useState(0)
  /** Double-clicking the header background or title toggles staying open on any page. */
  const [micLive, setMicLive] = useState(false)
  const [hold, setHold] = useState<HoldMode>('normal')
  const card = useRef<HTMLDivElement>(null)
  const drag = useDotDrag()
  const navigation = useNavigationHistory(
    {
      view,
      controlList,
      voiceWorkspace,
      showSettings,
      showMemory,
      showAgent,
      pickingWorkspace,
      artifactThread,
      changesFor,
      expanded,
    },
    (route) => {
      setView(route.view)
      setControlList(route.controlList)
      setVoiceWorkspace(route.voiceWorkspace)
      setShowSettings(route.showSettings)
      setShowMemory(route.showMemory)
      setShowAgent(route.showAgent)
      setPickingWorkspace(route.pickingWorkspace)
      setArtifactThread(route.artifactThread)
      setChangesFor(route.changesFor)
      setExpanded(route.expanded)
      setMenu(null)
      setListMenu(null)
      setSourceMenu(null)
      window.threadlight.setStayOpen(
        hold !== 'normal' || route.artifactThread !== null || (route.showMemory && !micLive),
      )
    },
  )
  const navigateRef = useRef<(direction: NavigationDirection) => void>(() => {})
  useLayoutEffect(() => {
    navigateRef.current = (direction) => {
      if (keyboardPeek) return
      if (direction === 'back' && pinnedThread) {
        setPinnedThread(null)
        return
      }
      if (artifactThread && artifactNavigation.current?.navigate(direction)) return
      if (changesFor && changesNavigation.current?.navigate(direction)) return
      if (showAgent && agentSettingsOpen && direction === 'back') {
        closeAgentSettings()
        return
      }
      if (showAgent && agentNavigation.current?.navigate(direction)) return
      if (
        showMemory &&
        !showAgent &&
        !artifactThread &&
        !changesFor &&
        !pickingWorkspace &&
        spacesNavigation.current?.navigate?.(direction)
      )
        return
      navigation.navigate(direction)
    }
  }, [
    keyboardPeek,
    pinnedThread,
    agentSettingsOpen,
    closeAgentSettings,
    showMemory,
    showAgent,
    artifactThread,
    changesFor,
    pickingWorkspace,
    navigation,
  ])
  useEffect(() => window.threadlight.onPanelPeek(setKeyboardPeek), [])
  useEffect(() => {
    let last: { direction: NavigationDirection; source: string; at: number } | null = null
    const travel = (direction: NavigationDirection, source: string) => {
      const at = performance.now()
      if (last && last.source !== source && last.direction === direction && at - last.at < 150)
        return
      last = { direction, source, at }
      navigateRef.current(direction)
    }
    const down = (event: globalThis.MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault()
    }
    const up = (event: globalThis.MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      travel(event.button === 3 ? 'back' : 'forward', 'mouse')
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('auxclick', down, true)
    window.addEventListener('mouseup', up, true)
    const stop = window.threadlight.onPanelNavigate((direction) => travel(direction, 'native'))
    return () => {
      stop()
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('auxclick', down, true)
      window.removeEventListener('mouseup', up, true)
    }
  }, [])

  /** Agent Toggle listens until the next press; selecting a target never opens the mic. */
  const [shortcutSessionId, setShortcutSessionId] = useState<string>()
  const gptLive = settings?.voiceMode === 'gpt-live' || (micLive && !!shortcutSessionId)
  const controls = useRef<OpenMicControls | null>(null)
  const onControls = useCallback((next: OpenMicControls | null) => {
    controls.current = next
  }, [])
  const pendingStart = useRef<{ token: symbol; client: AgentClient } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [inputMuted, setInputMuted] = useState(false),
    [outputMuted, setOutputMuted] = useState(false)
  const muteState = useRef(false)
  const endCall = useCallback(() => {
    pendingStart.current = null
    setPreparing(false)
    controls.current?.end()
    setMicLive(false)
  }, [])
  const toggleInput = useCallback(() => {
    if (!micLive) return
    const next = !muteState.current
    controls.current?.muteInput(next)
    muteState.current = next
    setInputMuted(next)
  }, [micLive])
  const toggleOutput = () => {
    controls.current?.muteOutput(!outputMuted)
    setOutputMuted(!outputMuted)
  }
  useEffect(() => window.threadlight.onLiveMuteShortcut(toggleInput), [toggleInput])
  useEffect(() => {
    window.threadlight.setLiveCallControls(micLive)
    return () => window.threadlight.setLiveCallControls(false)
  }, [micLive])
  const openMicMode =
    !!voiceDestination ||
    gptLive ||
    (settings?.voiceTarget === 'agent' && settings.talkMode === 'toggle')
  const openMicModeRef = useRef(openMicMode)
  useEffect(() => {
    openMicModeRef.current = openMicMode
    // Switching the setting off (or to Hold) closes a live mic, and it stays closed after.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!openMicMode) setMicLive(false)
  }, [openMicMode])

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
  } = useRecordedAgentVoice(
    !gptLive && (settings?.voiceTarget === 'agent' || !!voiceDestination),
    voiceDestination ?? undefined,
  )
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
          next.voiceMode !== settingsRef.current?.voiceMode ||
          next.talkMode !== settingsRef.current?.talkMode ||
          next.agentProvider !== settingsRef.current?.agentProvider
        ) {
          settingsRef.current = next
          openMicModeRef.current =
            next.voiceMode === 'gpt-live' ||
            (next.voiceTarget === 'agent' && next.talkMode === 'toggle')
          recordingGeneration.current++
          startedBy.current = null
          cancelVoice()
          pendingStart.current = null
          setPreparing(false)
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
      window.threadlight.onPanelOpened(({ maxHeight, opensDown, fresh, canvasSize }) => {
        if (canvasSize) setCanvasSize(canvasSize)
        setMaxHeight(maxHeight)
        setOpensDown(opensDown)
        if (!fresh) return
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
        setArtifactThread(null)
        setPickingWorkspace(false)
      }),
    [],
  )
  useEffect(() => {
    let current = true,
      updated = false
    const off = window.threadlight.onHotkeyProblem((problem) => {
      updated = true
      setHotkeyProblem(problem)
    })
    void Promise.resolve(window.threadlight.getHotkeyProblem?.())
      .then((problem) => {
        if (current && !updated && typeof problem === 'string') setHotkeyProblem(problem)
      })
      .catch(() => {})
    return () => {
      current = false
      off()
    }
  }, [])
  useEffect(() => window.threadlight.onOpenSettings(() => setShowSettings(true)), [])
  useEffect(
    () =>
      window.threadlight.onScreenHelpNotice?.(({ message, open }) => {
        setNotice(message)
        if (open) {
          setShowMemory(false)
          setShowSettings(false)
          setPickingWorkspace(false)
          setArtifactThread(null)
          setChangesFor(null)
          setShowAgent(true)
        }
      }),
    [setShowAgent],
  )
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
      window.threadlight.resizePanel(
        element.getBoundingClientRect().height +
          room +
          (element.parentElement?.querySelector('[data-video-grips]') ? 4 : 0),
      )
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    return () => observer.disconnect()
  }, [room])

  // Each pop-up asks for room on its own account; the window grows for the largest request.
  const requests = useRef(new Map<object, number>())
  const panelRoom = useMemo(
    () => ({
      opensDown,
      extra: room,
      reserve: (px: number, owner: object) => {
        const cardHeight = card.current?.getBoundingClientRect().height ?? 0
        const granted = Math.round(Math.max(0, Math.min(px, maxHeight - cardHeight)))
        if (granted > 0) requests.current.set(owner, granted)
        else requests.current.delete(owner)
        setRoom(Math.max(0, ...requests.current.values()))
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
      else if (pinnedThread) setPinnedThread(null)
      else if (artifactThread) setArtifactThread(null)
      else window.threadlight.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, listMenu, sourceMenu, pinnedThread, artifactThread])

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
    if (target === 'agent') {
      setAgentVoiceCaption(text)
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
      const seconds =
        settingsRef.current?.voiceHold || inlineView?.id === match.id
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
  }, [voice, sendAgentSpeech, setShowAgent, inlineView?.id])

  const dictationTransition = useRef(false)
  const [startingDictation, setStartingDictation] = useState(false)
  const micToggle = useCallback(
    async (sessionId?: string, answer?: { id: string; receive: (text: string) => void }) => {
      if (dictationTransition.current) return
      setVoiceError(null)
      if (voice.state === 'idle') {
        dictationTransition.current = true
        setStartingDictation(true)
        try {
          startedBy.current = 'mic'
          answerDictation.current = answer ?? null
          setRecordingOwner('thread')
          dictationTarget.current = sessionId ?? compose?.sessionId ?? null
          setDictationSession(dictationTarget.current)
          await voice.start()
        } catch {
          startedBy.current = null
          setVoiceError(en.voice.micBlocked)
        } finally {
          setStartingDictation(false)
          dictationTransition.current = false
        }
      } else if (voice.state === 'listening') {
        dictationTransition.current = true
        const receiver = answerDictation.current
        try {
          const text = (await voice.stop()).trim()
          if (text) {
            if (receiver) {
              if (answerDictation.current === receiver) receiver.receive(text)
            } else
              setHeard((previous) => ({
                text,
                n: (previous?.n ?? 0) + 1,
                sessionId: dictationTarget.current,
              }))
          } else setVoiceError(en.voice.nothingHeard)
        } catch (error) {
          setVoiceError(error instanceof Error ? error.message : String(error))
        } finally {
          startedBy.current = null
          dictationTransition.current = false
        }
      }
    },
    [voice, compose],
  )

  const cancelAnswerDictation = useCallback(
    (id: string) => {
      if (answerDictation.current?.id !== id) return
      answerDictation.current = null
      dictationTarget.current = null
      startedBy.current = null
      cancelVoice()
      setDictationSession(null)
    },
    [cancelVoice],
  )

  // The talk hotkey: start, stop-and-send, or cancel a countdown in progress.
  const performTalk = useCallback(
    async (destination?: AgentClient, liveSessionId?: string, token?: symbol) => {
      const cancelled = () => !!token && pendingStart.current?.token !== token
      window.threadlight.reportVoiceShortcut('request', destination ? 'brainstorm' : 'agent')
      // Closing the global mic also works while the composer is dictating or transcribing.
      if (micLive) {
        endCall()
        if (!destination || destination === voiceDestinationRef.current) return
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
      const currentSettings = settingsRef.current ?? (await window.threadlight.getSettings())
      if (cancelled()) return
      settingsRef.current = currentSettings
      setNotice(null)
      const nativeLive = !!liveSessionId || currentSettings.voiceMode === 'gpt-live'
      setShortcutSessionId(liveSessionId)
      voiceDestinationRef.current = destination ?? null
      setVoiceDestination(destination ?? null)
      if (
        !nativeLive &&
        settingsRef.current?.voiceTarget !== 'agent' &&
        !destination &&
        settingsRef.current?.enabledProviders.length === 0
      ) {
        setNotice(en.sources.paused)
        setShowSettings(true)
        window.threadlight.openPanelQuietly()
        return
      }
      const provider = destination
        ? (await destination.getAgent()).provider
        : liveSessionId
          ? (await window.threadlight.getAgent()).provider
          : agent.provider
      if (cancelled()) return
      if (nativeLive && (provider ?? currentSettings.agentProvider) !== 'codex') {
        setNotice(en.settings.gptLiveNeedsCodex)
        setShowAgent(false)
        setShowSettings(true)
        window.threadlight.openPanelQuietly()
        return
      }
      const sttStatus =
        !nativeLive && stt.state === 'loading' ? await window.threadlight.getStt() : stt
      if (cancelled()) return
      if (!nativeLive && sttStatus.state !== 'ready') {
        window.threadlight.reportVoiceShortcut('needs-stt', destination ? 'brainstorm' : 'agent')
        setNotice(en.voice.hotkeyNeedsModel)
        window.threadlight.openPanelQuietly()
        return
      }
      // With the open mic on, the toggle opens and closes a live mic instead of one recording.
      if (nativeLive || destination || openMicModeRef.current) {
        const mine = recordingGeneration.current
        await closeAgentSpeech()
        if (
          cancelled() ||
          mine !== recordingGeneration.current ||
          (!nativeLive && !destination && !openMicModeRef.current)
        )
          return
        setAgentVoiceCaption('')
        muteState.current = false
        setInputMuted(false)
        setOutputMuted(false)
        setMicLive(true)
        window.threadlight.reportVoiceShortcut(
          'microphone-requested',
          destination ? 'brainstorm' : 'agent',
        )
        window.threadlight.openPanelQuietly()
        return
      }
      try {
        startedBy.current = 'hotkey'
        recordingTarget.current = settingsRef.current?.voiceTarget ?? 'thread'
        setRecordingOwner(recordingTarget.current)
        setDictationSession(null)
        if (recordingTarget.current === 'agent') setAgentVoiceCaption('')
        recordingAgent.current = agent.provider ?? settingsRef.current?.agentProvider ?? 'claude'
        await voice.start()
        window.threadlight.openPanelQuietly()
      } catch {
        startedBy.current = null
        setNotice(en.voice.micBlocked)
        window.threadlight.openPanelQuietly()
      }
    },
    [
      micLive,
      endCall,
      setShowAgent,
      voice,
      stt,
      finishTalk,
      micToggle,
      closeAgentSpeech,
      agent.provider,
    ],
  )

  const onTalk = useCallback(
    async (destination?: AgentClient, liveSessionId?: string) => {
      if (pendingStart.current) {
        endCall()
        return
      }
      const preparingNative =
        !micLive && (!!liveSessionId || settingsRef.current?.voiceMode === 'gpt-live')
      if (!preparingNative) {
        await performTalk(destination, liveSessionId)
        return
      }
      const token = Symbol()
      pendingStart.current = { token, client: destination ?? window.threadlight }
      setPreparing(true)
      window.threadlight.openPanelQuietly()
      try {
        await performTalk(destination, liveSessionId, token)
      } catch {
        if (pendingStart.current?.token === token)
          setNotice('Could not start the voice call. Try again.')
      } finally {
        if (pendingStart.current?.token === token) {
          pendingStart.current = null
          setPreparing(false)
        }
      }
    },
    [micLive, endCall, performTalk],
  )
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
  // Pinning holds any selected view open.
  const leave = useCallback(() => {
    if (
      drag.isDragging() ||
      document.querySelector(
        '[data-workspace-resizing], [data-pin-resizing], [data-agent-resizing], [data-code-panning]',
      ) ||
      hold !== 'normal' ||
      artifactThread !== null
    )
      return
    if (micLive) {
      const active = document.activeElement
      const editing =
        active instanceof HTMLElement &&
        active.getClientRects().length > 0 &&
        active.matches('textarea, input, [contenteditable="true"]')
      const heldControls = document.querySelectorAll(
        '#foreground-agent-composer, [role="dialog"], [role="menu"], [data-card-state="pending"], [data-agent-approval], [data-agent-request]',
      )
      if (
        editing ||
        voiceAgent.requests.length ||
        voiceAgent.approval ||
        [...heldControls].some((el) => el.getClientRects().length > 0)
      )
        return
    }
    // Hold for a separate dictation or its countdown. Live retains its waveform on the pill.
    if (voice.state !== 'idle' || Date.now() < countdownUntil.current) return
    window.threadlight.leavePanel()
  }, [
    drag,
    hold,
    voice.state,
    artifactThread,
    micLive,
    voiceAgent.requests.length,
    voiceAgent.approval,
  ])
  useEffect(() => {
    window.threadlight.setStayOpen(hold !== 'normal' || artifactThread !== null)
  }, [hold, artifactThread, micLive])
  useEffect(() => window.threadlight.onPanelPointerOutside(leave), [leave])
  const changeHold = (next: HoldMode) => {
    setHold(next)
    window.threadlight.setStayOpen(next !== 'normal' || artifactThread !== null)
  }
  const openSharedSpaces = useCallback(() => {
    setShowSettings(false)
    setShowAgent(false)
    setPickingWorkspace(false)
    setChangesFor(null)
    setArtifactThread(null)
    setShowMemory(true)
    window.threadlight.setStayOpen(hold !== 'normal')
  }, [hold, setShowAgent])
  useEffect(
    () =>
      window.threadlight.onTalkToggle((destination) => {
        if (destination !== 'brainstorm') {
          void onTalk(undefined, destination?.liveSessionId)
          return
        }
        openSharedSpaces()
        const opened = spacesNavigation.current?.brainstormVoice?.()
        setBrainstormNotice(
          opened
            ? null
            : 'Open an available project in Shared Spaces, then press Ctrl+Alt+B to start Brainstorm voice.',
        )
        if (opened) void onTalk(opened)
        else window.threadlight.reportVoiceShortcut('no-project', 'brainstorm')
        window.threadlight.openPanelQuietly()
      }),
    [openSharedSpaces, onTalk],
  )
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
    // Voice commands deliberately reveal the full list; pinning alone never selects a view.
    setView('all')
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
  const livePort = useMemo<LiveVoicePort | undefined>(
    () =>
      voiceDestination
        ? {
            start: voiceDestination.agentLiveStart,
            open: voiceDestination.agentLiveOpen,
            stop: voiceDestination.agentLiveStop,
            subscribe: voiceDestination.onAgentLive,
            state: voiceDestination.getAgent,
            announcements: true,
          }
        : undefined,
    [voiceDestination],
  )
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
    onControls,
    onInputCaption: (caption) =>
      setLiveInput((previous) =>
        caption ? anchorInputCaption(caption, previous, voiceAgent) : null,
      ),
    enabled: micLive && (gptLive || stt.state === 'ready'),
    nativeLive: gptLive,
    liveSessionId: micLive ? shortcutSessionId : undefined,
    livePort,
    conversationOnly: !!voiceDestination,
    paused: voice.isCapturing,
    threads: [...voiceThreads.values()],
    onStop: () => setMicLive(false),
    onConversation: () => {
      setShowSettings(false)
      setPickingWorkspace(false)
      setChangesFor(null)
      if (voiceDestination) openSharedSpaces()
      else setShowAgent(true)
      window.threadlight.openPanelQuietly()
    },
    onSentence: handleSentence,
  })
  const returnToCall = useCallback(() => {
    if (!micLive) return
    const destination = voiceDestinationRef.current
    if (!destination && !gptLive && micMode !== 'agent') return
    setPickingWorkspace(false)
    setChangesFor(null)
    setArtifactThread(null)
    setShowSettings(false)
    setPinnedThread(null)
    setKeyboardPeek(false)
    if (destination) {
      openSharedSpaces()
      spacesNavigation.current?.revealVoice?.(destination)
    } else {
      setShowMemory(false)
      setShowAgent(true)
      setRecentEntry(null)
      agentNavigation.current?.showCurrent()
    }
  }, [micLive, gptLive, micMode, openSharedSpaces, setShowAgent])
  useEffect(
    () =>
      window.threadlight.onPanelOpened((info) => {
        if (info.fromMic) returnToCall()
      }),
    [returnToCall],
  )
  const liveError =
    gptLive || !!shortcutSessionId
      ? continuousError
      : settings?.voiceTarget === 'agent' || voiceDestination
        ? (recordedAgentError ?? continuousError)
        : null
  const openingDraft = recordedAgentError ? recordedAgentDraft : continuousDraft
  const openMicListening = openMic === 'listening' || openMic === 'hearing'
  const micBlocked = openMic === 'blocked'
  useEffect(() => {
    if (openMicListening || voice.state === 'listening')
      window.threadlight.reportVoiceShortcut('listening', voiceDestination ? 'brainstorm' : 'agent')
    else if (micBlocked)
      window.threadlight.reportVoiceShortcut('blocked', voiceDestination ? 'brainstorm' : 'agent')
  }, [openMicListening, micBlocked, voice.state, voiceDestination])
  const anyOpenMicListening = openMicListening
  const agentRecording = recordingOwner === 'agent' && voice.state !== 'idle'
  const visualMode = motionMode({
    recording: voice.state,
    microphone: anyOpenMicListening,
    agent: voiceAgent.status,
    waitingForReply:
      livePhase === 'waiting' ||
      !!sessions.find((s) => s.id === voiceSendId && s.state === 'working'),
    failed: !!liveError || openMic === 'blocked' || !!voiceError,
  })
  const composerOwnsLiveMic =
    gptLive &&
    micLive &&
    recordingOwner === 'thread' &&
    (startingDictation || voice.state !== 'idle')
  useMotion(
    visualMode,
    voice.state === 'listening' ? voice.energy : openMicEnergy,
    outputEnergy,
    true,
    composerOwnsLiveMic || (micLive && inputMuted),
    !!(
      micLive &&
      (!gptLive || livePhase === 'live' || livePhase === 'waiting') &&
      (voiceAgent.status === 'working' ||
        voiceAgent.chatActivity?.working ||
        (voiceAgent.pendingSpeechTurn && !voiceAgent.pendingReadout)) &&
      !voiceAgent.requests.length &&
      !voiceAgent.approval
    ),
    voiceAgent.provider ?? undefined,
    inputMuted,
  )
  const motion = useMotion(
    motionMode({
      recording: agentRecording ? voice.state : 'idle',
      microphone: openMicListening,
      agent: voiceAgent.status,
      waitingForReply: livePhase === 'waiting',
      failed: !!liveError || openMic === 'blocked' || (agentRecording && !!voiceError),
    }),
    agentRecording && voice.state === 'listening'
      ? voice.energy
      : openMicListening
        ? openMicEnergy
        : SILENT_AUDIO,
    outputEnergy,
    false,
    composerOwnsLiveMic || (micLive && inputMuted),
  )
  useEffect(
    () =>
      window.threadlight.onMicAction((action) => {
        if (!micLive) return
        if (action === 'stopSpeaking') {
          if (!outputMuted && outputEnergy.current.level > 0.012) controls.current?.stopSpeaking()
        } else if ((action === 'pause') !== muteState.current) {
          toggleInput()
        }
      }),
    [micLive, outputMuted, outputEnergy, toggleInput],
  )
  const lastVoiceItem = voiceAgent.items.findLast(
    (item) => item.kind === 'you' || item.kind === 'agent',
  )
  const motionCaption = agentRecording
    ? agentVoiceCaption
    : showAgent || voiceDestination
      ? lastVoiceItem?.text || openingDraft || agentVoiceCaption
      : agentVoiceCaption
  useEffect(() => window.threadlight.setOpenMicLive(anyOpenMicListening), [anyOpenMicListening])
  const earlierCaptionIds = useRef(new Set<string>())
  const publishedReply = useRef<string | null>(null)
  const activeExample = useRef<SpokenExample | null>(null)
  const exampleScope = useRef<string | null>(null)
  const oldExampleSources = useRef(new Set<string>())
  const previousItems = useRef<typeof agent.items>([])
  useEffect(() => {
    const active = micLive && gptLive && !voiceDestination && agent.live === 'active'
    if (!active) {
      earlierCaptionIds.current = new Set(
        agent.items.flatMap((item) => (item.id?.startsWith('live:') ? [item.id] : [])),
      )
    }
    const scope = JSON.stringify([agent.conversationId, agent.coachGuideToken])
    if (!active || exampleScope.current !== scope) {
      activeExample.current = null
      const previous = active ? previousItems.current : agent.items
      oldExampleSources.current = new Set(
        previous.flatMap((item) =>
          item.kind === 'agent' && item.id && !item.id.startsWith('live:') ? [item.id] : [],
        ),
      )
      exampleScope.current = scope
    }
    previousItems.current = agent.items
    const presentation =
      active && anyOpenMicListening && settings?.spokenReplyCompanion
        ? presentSpokenReply(
            agent.items,
            earlierCaptionIds.current,
            oldExampleSources.current,
            activeExample.current,
            replyCodeBlocks,
          )
        : { reply: null, example: null }
    activeExample.current = presentation.example
    const { reply } = presentation
    const signature = reply && JSON.stringify(reply)
    if (signature !== publishedReply.current) {
      publishedReply.current = signature
      window.threadlight.publishSpokenReply(reply)
    }
  }, [
    agent.items,
    agent.live,
    micLive,
    gptLive,
    voiceDestination,
    anyOpenMicListening,
    agent.conversationId,
    agent.coachGuideToken,
    settings?.spokenReplyCompanion,
  ])
  useEffect(() => window.threadlight.onStopOpenMic(endCall), [endCall])
  useEffect(() => {
    if (!anyOpenMicListening) return
    // The panel may be hidden, so use a timer rather than animation frames for the dot's meter.
    const timer = window.setInterval(
      () => window.threadlight.setOpenMicLevel(openMicLevel.current),
      50,
    )
    return () => {
      window.clearInterval(timer)
      window.threadlight.setOpenMicLevel(0)
    }
  }, [anyOpenMicListening, openMicLevel])

  // Titles and other header text share the pin gesture; controls keep their own actions.
  const onHeaderClick = (event: MouseEvent) => {
    if (
      event.detail !== 2 ||
      !(event.target instanceof Element) ||
      event.target.closest('button, a, input, select, textarea, [role="button"], [role="switch"]')
    )
      return
    changeHold(hold === 'normal' ? 'pinned' : 'normal')
  }

  // A thread that just went idle stays listed for a while, and the one being written to for as
  // long as the composer is open on it.
  const observedRoute: AppliedRoute = changesFor
    ? {
        page: 'changes',
        threadRef: controlRefs[changesFor.sessionId] ?? changesFor.sessionId,
        scope: changesFor.scope === 'card' ? 'card' : comparisonScope,
        ...(changesFor.scope !== 'card' && comparisonScope === 'worktree'
          ? { lens: comparisonLens, ...(comparisonRoot ? { rootId: comparisonRoot } : {}) }
          : {}),
        ...(changesFor.scope === 'card' ? { cardId: changesFor.card.id } : {}),
      }
    : artifactThread
      ? artifactThread.id === PANEL_BROWSER_THREAD
        ? { page: 'browser' }
        : {
            page: 'artifact',
            threadRef: controlRefs[artifactThread.id] ?? artifactThread.id,
            artifactId:
              controlArtifact?.threadId === artifactThread.id
                ? controlArtifact.id
                : (artifactThread.artifactId ?? 'catalog'),
          }
      : showAgent
        ? { page: 'agent' }
        : showMemory
          ? spacesRoute
          : showSettings
            ? { page: 'settings' }
            : expanded
              ? { page: 'chat', threadRef: controlRefs[expanded] ?? expanded }
              : voiceWorkspace
                ? { page: 'workspace', workspaceId: voiceWorkspace }
                : {
                    page: 'list',
                    mode:
                      view === 'active'
                        ? 'active'
                        : (controlList ?? settings?.listMode) === 'all'
                          ? 'all'
                          : 'recent',
                  }
  useAppControl(
    observedRoute,
    hold === 'pinned',
    (command) => {
      if (command.direction) {
        navigateRef.current(command.direction)
        return true
      }
      const route = command.route
      if (!route) return false
      const session = route.threadId ? voiceThreads.get(route.threadId) : undefined
      if ('threadRef' in route && !session) return false
      if (
        route.page === 'spaces' &&
        !spacesNavigation.current?.openControl?.(route.area, route.spaceId)
      )
        return false
      if ('threadRef' in route && route.threadId)
        setControlRefs((old) => ({ ...old, [route.threadId!]: route.threadRef }))
      setKeyboardPeek(false)
      setShowSettings(route.page === 'settings')
      setShowAgent(route.page === 'agent')
      setShowMemory(route.page === 'spaces')
      setPickingWorkspace(false)
      if (route.page === 'artifact') setControlArtifact(null)
      setArtifactThread(
        route.page === 'browser'
          ? {
              id: PANEL_BROWSER_THREAD,
              title: 'Browser',
              artifactId: '@browser',
              agentConversationId: agent.conversationId ?? undefined,
              navigationKey: command.commandId,
            }
          : route.page === 'artifact' && session
            ? {
                id: session.id,
                title: session.title,
                artifactId: route.artifactId,
                agentConversationId: agent.conversationId ?? undefined,
                navigationKey: command.commandId,
              }
            : null,
      )
      if (route.page === 'changes' && route.scope !== 'card') {
        setComparisonScope(route.scope)
        setComparisonLens(route.lens ?? 'git-current')
        setComparisonRoot(route.rootId)
        setComparisonReadiness('loading')
      }
      setChangesFor(
        route.page === 'changes' && session
          ? route.scope === 'card' && command.card
            ? { sessionId: session.id, scope: 'card', card: command.card }
            : route.scope !== 'card'
              ? {
                  sessionId: session.id,
                  scope: route.scope,
                  lens: route.lens,
                  rootId: route.rootId,
                  navigationKey: command.commandId,
                }
              : null
          : null,
      )
      if (route.page === 'list') {
        setExpanded(null)
        setVoiceWorkspace(null)
        setControlList(route.mode === 'active' ? null : route.mode)
        setView(route.mode === 'active' ? 'active' : 'all')
      }
      if (route.page === 'workspace') {
        setExpanded(null)
        setVoiceWorkspace(route.workspaceId)
        setControlList('workspace')
        setView('all')
      }
      if (route.page === 'chat' && session) {
        setVoiceSelection(session.id)
        setExpanded(session.id)
        setView('active')
        setInlineView({ id: session.id, reading: true })
      }
      return true
    },
    changesFor && changesFor.scope !== 'card'
      ? comparisonReadiness
      : artifactThread
        ? controlArtifact?.threadId === artifactThread.id
          ? controlArtifact.readiness
          : 'loading'
        : 'ready',
  )
  // The composer's thread may come from the workspace tree, not just the recent list.
  const target = compose ? findInSnapshot(snapshot, compose.sessionId) : undefined

  // The full list: recent threads, or the same rows wrapped in workspaces (Settings → list).
  const listMode = controlList ?? settings?.listMode ?? 'recent'
  const tree =
    provider !== 'none' &&
    view === 'all' &&
    listMode !== 'recent' &&
    (!voiceSelection || voiceWorkspace !== null)
  // Workspace can combine all drives, a drive/share's workspaces, or one exact folder.
  // A voice-selected workspace temporarily narrows either saved selection.
  const allDrives = (settings?.workspaceAllDrives ?? false) && voiceWorkspace === null
  const chosen =
    (provider === 'both'
      ? settings?.combinedFocusWorkspace
      : provider === 'codex'
        ? settings?.codexFocusWorkspace
        : settings?.focusWorkspace) ?? null
  const focusId = allDrives ? null : (voiceWorkspace ?? chosen ?? snapshot.currentWorkspace)
  const focus = allDrives
    ? { id: 'all-drives', name: 'All drives' }
    : focusId
      ? (snapshot.allWorkspaces.find((w) => sameFolder(w.id, focusId)) ?? {
          id: focusId,
          name: focusId.split(/[\\/]/).filter(Boolean).pop() ?? focusId,
        })
      : null
  const emptyWindow = <TimeWindowMessage hours={settings?.listWindowHours ?? 24} />
  const focusGroups = snapshot.workspaces.filter(
    (w) => allDrives || (focusId && workspaceInScope(w.id, focusId)),
  )
  const focusGroupKeys = (allDrives ? snapshot.allWorkspaces : focusGroups)
    .map((w) => w.id)
    .join('\n')
  const treeFocus = focus ? { ...focus, ids: focusGroups.map((w) => w.id) } : null
  const scopedSessions = useMemo(
    () =>
      workspaceSessions(
        snapshot,
        focusId,
        allDrives,
        now - (settings?.listWindowHours ?? 24) * 3600_000,
      ),
    [snapshot, focusId, allDrives, now, settings?.listWindowHours],
  )
  const recent = recentSessions(
    scopedSessions,
    settings?.maxSessions ?? 10,
    (session) => session.state !== 'idle' && !session.ignored,
  )
  const selectedByVoice = voiceSelection ? voiceThreads.get(voiceSelection) : undefined
  const baseList = view === 'active' ? scopedSessions : recent
  const listed =
    selectedByVoice && !baseList.some((s) => s.id === selectedByVoice.id)
      ? [selectedByVoice, ...baseList]
      : baseList
  const shown =
    view === 'all'
      ? listed
      : listed.filter(
          (s) =>
            isActive(s, now) ||
            now - s.lastActiveAt < LINGER_MS ||
            s.id === compose?.sessionId ||
            s.id === expanded,
        )
  const active = scopedSessions.filter((s) => isActive(s, now)).length
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
  const mergeRecent = headerView === 'recent' && !layout.split
  const accountRows = chatSources
    .flatMap((source) =>
      visibleAccountChats(
        headerView === 'active' &&
          (accountChatState[source].issues.Discovery ||
            now - accountChatState[source].lastListSuccess > (source === 'chatgpt' ? 90000 : 60000))
          ? []
          : accountChatState[source].chats,
        headerView,
        now,
        settings?.listWindowHours ?? 24,
        settings?.maxSessions ?? 10,
      ).map((chat) => ({ ...chat, source })),
    )
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, headerView === 'recent' ? (settings?.maxSessions ?? 10) : undefined)
  const accountCount = showChats ? accountRows.length : 0
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
          : recent.length
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
    setControlList(null)
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
  // The whole header exposes navigation and creation shortcuts.
  const onListMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu(null)
    setSourceMenu(null)
    setListMenu({ x: event.clientX, y: event.clientY })
  }
  const startThread = async () => {
    if (creationBusy.current) return
    creationBusy.current = true
    setCreatingThread(true)
    changeHold('pinned')
    setCreationNotice('Opening a new Codex chat…')
    const storageKey = 'threadlight.new-thread.pending.v1'
    try {
      const saved = localStorage.getItem(storageKey)
      // Keep the same operation through a reload or a failed desktop handoff.
      const request: NewThreadRequest = saved
        ? JSON.parse(saved)
        : {
            operationId: crypto.randomUUID(),
            provider: 'codex',
            cwd:
              focusId && !isWorkspaceRoot(focusId) ? focusId.replace(/^(claude|codex):/, '') : null,
          }
      localStorage.setItem(storageKey, JSON.stringify(request))
      const result = await window.threadlight.newThread(request)
      if (!result.ok) {
        setCreationNotice(result.reason)
        return
      }
      localStorage.removeItem(storageKey)
      setShowSettings(false)
      setShowAgent(false)
      setShowMemory(false)
      setPickingWorkspace(false)
      setChangesFor(null)
      setArtifactThread(null)
      setPicking(null)
      setVoiceSelection(result.sessionId)
      setVoiceWorkspace(null)
      setView('active')
      setExpanded(result.sessionId)
      setInlineFocus((previous) => ({ id: result.sessionId, token: (previous?.token ?? 0) + 1 }))
      setCreationNotice(null)
    } catch {
      setCreationNotice(
        'Could not finish opening the chat. Choose New again to check the same request.',
      )
    } finally {
      creationBusy.current = false
      setCreatingThread(false)
    }
  }
  const listMenuItems: MenuItem[] = [
    {
      label: agentBusy ? 'Agent · working' : 'Agent',
      onSelect: () => {
        setShowSettings(false)
        setShowMemory(false)
        setPickingWorkspace(false)
        setChangesFor(null)
        setArtifactThread(null)
        setShowAgent(true)
      },
    },
    {
      label: 'Browser',
      onSelect: () => openArtifacts({ id: PANEL_BROWSER_THREAD, title: 'Browser' }, '@browser'),
    },
    {
      label: creatingThread ? 'Opening chat…' : 'New',
      disabled: creatingThread,
      onSelect: () => {},
      choices: [
        {
          label: 'Claude',
          disabled: true,
          help: 'Claude chat creation is not available yet.',
          onSelect: () => {},
        },
        {
          label: 'Codex',
          disabled: !enabled.includes('codex'),
          help: enabled.includes('codex')
            ? 'Create a native Codex chat'
            : 'Enable Codex in Settings first.',
          onSelect: () => void startThread(),
        },
      ],
    },
    { label: 'Spaces', onSelect: openSharedSpaces },
    {
      label: en.settings.listWorkspace,
      disabled: view === 'all' && listMode === 'workspace',
      current: view === 'all' && listMode === 'workspace',
      onSelect: () => void selectList('workspace'),
    },
  ]
  const setPanelLayoutSetting = async (panelLayout: 'single' | 'dual') => {
    try {
      const result = await window.threadlight.updateSettings({ panelLayout })
      if (!result.ok) setNotice(result.reason)
    } catch {
      setNotice('Could not save the panel layout.')
    }
  }
  const selectApplications = async (selection: 'claude' | 'codex' | 'both') => {
    const enabledProviders = selection === 'both' ? (['claude', 'codex'] as const) : [selection]
    const result = await window.threadlight.updateSettings({
      enabledProviders: [...enabledProviders],
    })
    if (!result.ok) setNotice(result.reason)
  }
  const saveChatSources = async (chatSources: ChatSource[]) => {
    try {
      const result = await window.threadlight.updateSettings({ chatSources })
      if (!result.ok) setNotice(result.reason)
    } catch {
      setNotice('Could not save chat sources.')
    }
  }
  const threadFilterOptions: { label: string; value: ConversationFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Chat', value: 'chat' },
    { label: 'Code & Computer', value: 'code-computer' },
  ]
  const threadFilterLabel = threadFilterOptions.find(
    (option) => option.value === conversationFilter,
  )!.label
  const threadFilterItems: MenuItem[] = threadFilterOptions.map(({ label, value }) => ({
    label,
    current: conversationFilter === value,
    disabled: !settings,
    onSelect: () => {
      void window.threadlight
        .updateSettings({ conversationFilter: value })
        .then((result) => {
          if (!result.ok) setNotice(result.reason)
        })
        .catch(() => setNotice('Could not save the conversation filter.'))
    },
  }))
  const codeSourceMenuItems = [
    { label: 'Codex', selection: 'codex' as const },
    { label: 'Claude', selection: 'claude' as const },
    { label: 'Both', selection: 'both' as const },
  ].map(({ label, selection }) => ({
    label,
    disabled: label === sourceLabel,
    current: label === sourceLabel,
    onSelect: () => selectApplications(selection),
  }))
  const chatSourceLabel =
    chatSources.length === 2
      ? 'Chat apps'
      : chatSources[0] === 'chatgpt'
        ? 'ChatGPT'
        : chatSources[0] === 'perplexity'
          ? 'Perplexity'
          : 'Chat apps'
  const applicationLabel =
    conversationFilter === 'chat'
      ? chatSourceLabel
      : conversationFilter === 'all'
        ? 'Apps'
        : sourceLabel
  const sourceMenuItems: MenuItem[] =
    conversationFilter === 'chat'
      ? [
          {
            label: 'ChatGPT',
            current: chatSources.length === 1 && chatSources[0] === 'chatgpt',
            onSelect: () => void saveChatSources(['chatgpt']),
          },
          {
            label: 'Perplexity',
            current: chatSources.length === 1 && chatSources[0] === 'perplexity',
            onSelect: () => void saveChatSources(['perplexity']),
          },
          {
            label: 'Both chat apps',
            current: chatSources.length === 2,
            onSelect: () => void saveChatSources(['chatgpt', 'perplexity']),
          },
        ]
      : [
          ...codeSourceMenuItems,
          ...(showChats
            ? (['chatgpt', 'perplexity'] as const).map((source) => ({
                label: `${chatSources.includes(source) ? 'Hide' : 'Show'} ${source === 'chatgpt' ? 'ChatGPT' : 'Perplexity'} chats`,
                onSelect: () =>
                  void saveChatSources(
                    chatSources.includes(source)
                      ? chatSources.filter((s) => s !== source)
                      : [...chatSources, source],
                  ),
              }))
            : []),
        ]

  const changesThread = changesFor ? findInSnapshot(snapshot, changesFor.sessionId) : undefined
  const changesHeading =
    changesFor?.scope === 'card'
      ? `${en.changes.cardTitle} · ${en.changes.files(changesFor.card.fileCount ?? changesFor.card.fileChanges?.length ?? 0)}`
      : (comparisonHeading ?? 'Changes')
  const pickWorkspace = async (id: string | null, useAll = false) => {
    setVoiceSelection(null)
    setVoiceWorkspace(null)
    const result = await window.threadlight.updateSettings({
      ...(!useAll
        ? provider === 'both'
          ? { combinedFocusWorkspace: id }
          : provider === 'codex'
            ? { codexFocusWorkspace: id }
            : { focusWorkspace: id }
        : {}),
      workspaceAllDrives: useAll,
      listMode: 'workspace',
    })
    if (!result.ok) {
      setNotice(result.reason)
      return
    }
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

  // Keep the saved workspace selection warm while Active/Recent or a subpage is visible.
  useEffect(() => {
    if (listMode !== 'all' && allDrives) {
      return window.threadlight.setTreeView({ expanded: [], showAll: [], everything: true })
    }
    if (listMode !== 'all') {
      const only = focusGroupKeys ? focusGroupKeys.split('\n') : focusId ? [focusId] : []
      return window.threadlight.setTreeView({ expanded: only, showAll: only })
    }
    window.threadlight.setTreeView({ expanded: openWorkspaces, showAll: moreWorkspaces })
  }, [listMode, allDrives, focusId, focusGroupKeys, openWorkspaces, moreWorkspaces, enabledKey])

  const openMenu = (event: MouseEvent, session: Session) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, session })
  }
  // Dual view splits the workspace tree the same way as the recent list: each column keeps the
  // workspace headers and shows only that provider's threads. A workspace with no threads loaded
  // yet (collapsed) stays in both columns so either header can open it.
  const workspacesOf = (provider: Provider): Workspace[] => {
    const only = (nodes: ThreadNode[]): ThreadNode[] =>
      nodes
        .filter((node) => sessionProvider(node.session.id) === provider)
        .map((node) => ({ ...node, children: only(node.children) }))
    return snapshot.workspaces.flatMap((workspace) => {
      if (workspace.threads.length === 0) return [workspace]
      const threads = only(workspace.threads)
      return threads.length > 0 ? [{ ...workspace, threads }] : []
    })
  }
  // Dual view puts Claude and Codex side by side, so it needs both, and it is offered in the
  // Recent and Workspace lists. Single view stays reachable from anywhere while dual is on.
  const layoutMenuItems: MenuItem[] = wantDual
    ? [{ label: 'Single view', onSelect: () => void setPanelLayoutSetting('single') }]
    : bothProviders && dualView
      ? [{ label: 'Dual view', onSelect: () => void setPanelLayoutSetting('dual') }]
      : []
  // A thread waiting on the user can be set aside in Threadlight alone (nothing is sent to the app).
  const ignoreItems = (session: Session): MenuItem[] =>
    session.state !== 'waiting' && !session.attention
      ? []
      : session.ignored
        ? [
            {
              label: en.attention.stopIgnoring,
              help: en.attention.stopIgnoringHelp,
              onSelect: () => window.threadlight.ignoreNeedsInput(session.id, false),
            },
          ]
        : [
            {
              label: en.attention.ignore,
              help: en.attention.ignoreHelp,
              onSelect: () => window.threadlight.ignoreNeedsInput(session.id, true),
            },
          ]
  const openArtifacts = (session: Pick<Session, 'id' | 'title'>, artifactId?: string) => {
    setShowAgent(false)
    setShowSettings(false)
    setShowMemory(false)
    setChangesFor(null)
    setPickingWorkspace(false)
    setArtifactThread({
      id: session.id,
      title: session.title,
      artifactId,
      navigationKey: crypto.randomUUID(),
    })
  }
  const composeThread = (session: Session) => {
    if (inlineView?.id === session.id)
      setInlineFocus((previous) => ({ id: session.id, token: (previous?.token ?? 0) + 1 }))
    else setCompose({ sessionId: session.id })
  }
  const renderThreadComposer = (
    session: Session,
    relay: RelayStatus | undefined,
    hidden: boolean,
    pinnedFocus?: number,
  ) => (
    <Composer
      key={`${session.id}:${compose?.sessionId === session.id ? (compose.initialText ?? '') : ''}`}
      embedded
      hidden={hidden}
      focusToken={pinnedFocus ?? (inlineFocus?.id === session.id ? inlineFocus.token : 0)}
      session={session}
      relay={relay}
      stt={stt}
      voiceState={dictationSession === session.id ? voice.state : 'idle'}
      level={dictationSession === session.id ? voice.level : 0}
      micDisabled={voice.state !== 'idle' && dictationSession !== session.id}
      onMic={() => void micToggle(session.id)}
      heard={heard?.sessionId === session.id ? heard : null}
      voiceError={dictationSession === session.id ? voiceError : null}
      initialText={
        pinnedFocus === undefined && compose?.sessionId === session.id
          ? compose.initialText
          : undefined
      }
      countdownSeconds={
        pinnedFocus === undefined && compose?.sessionId === session.id
          ? compose.countdownSeconds
          : undefined
      }
      cancelToken={cancelToken}
      onClose={() => {
        if (pinnedFocus !== undefined) {
          setPinnedThread(null)
          return
        }
        setExpanded(null)
        if (compose?.sessionId === session.id) closeComposer()
      }}
    />
  )
  const menuItems = (session: Session): MenuItem[] => [
    {
      label: 'Browser',
      onSelect: () => openArtifacts(session, '@browser'),
    },
    {
      label: 'Artifacts',
      onSelect: () => openArtifacts(session),
    },
    {
      label: en.changes.worktreeTitle,
      disabled: !session.git?.root && !session.cwd,
      onSelect: () => setChangesFor({ sessionId: session.id, scope: 'worktree' }),
    },
    ...(inlineView?.id === session.id && !inlineView.reading
      ? []
      : [{ label: en.menu.compose, onSelect: () => composeThread(session) }]),
    {
      label: session.provider === 'codex' ? 'Open in Codex' : en.menu.openInClaude,
      disabled: !session.appId,
      onSelect: () => {
        if (!session.appId) return
        markThreadRead(session.id)
        window.threadlight.openInClaude(session.appId)
      },
    },
    ...ignoreItems(session),
    ...layoutMenuItems,
  ]

  const openActiveThread = (session: Session) => {
    setKeyboardPeek(false)
    setShowAgent(false)
    setShowMemory(false)
    setShowSettings(false)
    setPickingWorkspace(false)
    setChangesFor(null)
    setArtifactThread(null)
    setPicking(null)
    setMenu(null)
    setControlList(null)
    setView('active')
    setVoiceSelection(session.id)
    setExpanded(session.id)
    voiceFocusPending.current = session.id
  }

  /** One thread row, the same in the recent list and inside a workspace. */
  const renderRow = (session: Session, index: number) => (
    <SessionRow
      key={session.id}
      session={session}
      striped={index % 2 === 1}
      showProvider={provider === 'both' || showChats}
      relay={relays.get(session.id)}
      composing={session.id === compose?.sessionId}
      now={now}
      expanded={!picking && expanded === session.id}
      onToggle={() => onRowClick(session)}
      onContextMenu={(event) => openMenu(event, session)}
      onCompose={() => composeThread(session)}
      onShowChanges={() => setChangesFor({ sessionId: session.id, scope: 'thread' })}
      onOpenArtifact={(id) => openArtifacts(session, id)}
      onRead={() => markThreadRead(session.id)}
    />
  )

  const treeProps = {
    maxRoots: settings?.maxSessions ?? 10,
    showAll: moreWorkspaces,
    only: listMode === 'workspace' ? treeFocus : null,
    isOpen,
    onToggle: toggleWorkspace,
    onShowMore: (id: string) => setMoreWorkspaces((list) => [...list, id]),
    emptyMessage: emptyWindow,
    renderRow,
  }

  const onRowClick = (session: Session) => {
    if (picking) {
      // Picking a thread for speech that did not name one clearly.
      setCompose({ sessionId: session.id, initialText: picking.text })
      setPicking(null)
      return
    }
    if (
      expanded !== session.id &&
      compose?.sessionId === session.id &&
      !compose.initialText &&
      !compose.countdownSeconds
    )
      setCompose(null)
    setExpanded(expanded === session.id ? null : session.id)
  }

  const agentVisible = showAgent && !pickingWorkspace && !changesFor
  const browserFront =
    !keyboardPeek &&
    !changesFor &&
    !pickingWorkspace &&
    !!artifactThread &&
    (controlArtifact?.threadId === artifactThread.id
      ? controlArtifact.id
      : artifactThread.artifactId) === '@browser'
  const liveSpeech = micLive && gptLive && voiceAgent.live === 'active'
  useBrowserCaptions(
    voiceAgent,
    liveSpeech,
    browserFront ? artifactThread.id : null,
    voiceDestination,
  )
  const agentOpenedBrowser =
    !agent.ended &&
    !!artifactThread?.agentConversationId &&
    artifactThread.agentConversationId === agent.conversationId
  const recentConversation = agent.recent
  const recentButton = recentConversation &&
    !agentVisible &&
    !browserFront &&
    (recentConversation.waiting || now - recentConversation.at < RECENT_AGENT_MS) && (
      <Tip
        as="button"
        text={recentConversation.summary || 'Open the recent Agent conversation'}
        aria-label={
          recentConversation.waiting
            ? 'Agent is waiting for your answer'
            : 'Open recent Agent conversation'
        }
        className={`${styles.gear} ${styles.recentAgent}`}
        data-awaiting={recentConversation.waiting || undefined}
        onClick={() => {
          setKeyboardPeek(false)
          setShowSettings(false)
          setShowMemory(false)
          setPickingWorkspace(false)
          setArtifactThread(null)
          setChangesFor(null)
          setRecentEntry({ id: recentConversation.id })
          setShowAgent(true)
        }}
      >
        <AgentDiamond />
      </Tip>
    )
  const ownedCall = !!voiceDestination || gptLive || micMode === 'agent'
  const callPageVisible =
    !pinnedThread &&
    !pickingWorkspace &&
    !artifactThread &&
    !changesFor &&
    (voiceDestination
      ? showMemory && !showAgent && spacesHeader?.voiceClient === voiceDestination
      : agentVisible && !agentSettingsOpen)
  const showCallControls = !ownedCall || callPageVisible
  const callConnected =
    micLive &&
    !preparing &&
    (gptLive ? livePhase === 'live' || livePhase === 'waiting' : openMicListening)
  const showVoiceActivity = agentRecording || micLive || agentVisible
  const inactiveMicrophone = !openMicListening && !(agentRecording && voice.state === 'listening')
  const listHidden =
    showMemory ||
    showSettings ||
    pickingWorkspace ||
    showAgent ||
    changesFor !== null ||
    artifactThread !== null
  const accountListVisible = showChats && !listHidden && headerView !== 'workspace'
  useAccountChatDiscovery(settings !== null, chatSources, accountListVisible)
  const pinVisible = showCode && settings?.pinnedActiveThreads && (listHidden || view !== 'active')
  if (pinnedThread && (!pinVisible || !scopedSessions.some((s) => s.id === pinnedThread)))
    setPinnedThread(null)
  useEffect(() => {
    const read = () => {
      if (showCode && expanded && !listHidden && !keyboardPeek && !picking && !document.hidden)
        markThreadRead(expanded)
      if (pinVisible && pinnedThread && !keyboardPeek && !document.hidden)
        markThreadRead(pinnedThread)
    }
    read()
    const off = window.threadlight.onPanelOpened(read)
    document.addEventListener('visibilitychange', read)
    return () => {
      off()
      document.removeEventListener('visibilitychange', read)
    }
  }, [
    showCode,
    expanded,
    listHidden,
    keyboardPeek,
    picking,
    snapshot,
    markThreadRead,
    pinVisible,
    pinnedThread,
  ])
  const collapsePinned = pinnedThread ? () => setPinnedThread(null) : undefined
  const workspaceView = showCode && headerView === 'workspace' && !listHidden && !keyboardPeek
  const workspaceHeight = Math.min(
    maxHeight,
    Math.max(
      WORKSPACE_MIN_HEIGHT,
      workspaceDragHeight ?? settings?.workspacePanelHeight ?? maxHeight,
    ),
  )

  useEffect(() => {
    let live = true
    void Promise.resolve(window.threadlight.setWorkspacePanel(workspaceView))
      .then((info) => {
        if (!live || !info) return
        setMaxHeight(info.maxHeight)
        setOpensDown(info.opensDown)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [workspaceView])

  const saveWorkspaceHeight = async (height: number) => {
    setWorkspaceDragHeight(height)
    setSavingWorkspaceHeight(true)
    try {
      const result = await window.threadlight.updateSettings({ workspacePanelHeight: height })
      if (!result.ok) setNotice(result.reason)
    } catch {
      setNotice('Could not save the Workspace height.')
    } finally {
      setWorkspaceDragHeight(null)
      setSavingWorkspaceHeight(false)
    }
  }

  // Claude keeps its existing window choice; Codex always shows its weekly quota.
  const claudeUsage =
    usage && enabled.includes('claude') ? (
      <UsageBar
        usage={usage}
        weekly={view === 'all' && !listHidden}
        source={provider === 'both' ? 'Claude' : undefined}
        actionHint={workspaceView ? WORKSPACE_RESIZE_HINT : undefined}
      />
    ) : null
  const codexUsage = enabled.includes('codex') ? (
    <CodexUsageBar
      usage={snapshot.codexUsage}
      actionHint={workspaceView ? WORKSPACE_RESIZE_HINT : undefined}
    />
  ) : null
  const usageBars = (
    <>
      {artifactThread && <div ref={setArtifactInfoHost} className={styles.artifactInfoSlot} />}
      {(showCode || listHidden) && codexUsage && claudeUsage}
      <div data-teach-footer="" />
      <ProviderErrors sources={settings?.chatSources ?? []} version={version} relays={relays} />
      <HoverFooter />
      {(showCode || listHidden) && (codexUsage ?? claudeUsage)}
    </>
  )
  const cardHeight =
    (!keyboardPeek && canvasSize?.height) || (workspaceView ? workspaceHeight : maxHeight)

  return (
    <PanelProviders
      liveInput={micLive && gptLive ? liveInput : null}
      room={panelRoom}
      helpMode={settings?.hoverHelp ?? 'info'}
      openCardChanges={openCardChanges}
    >
      <ThreadComposerContext.Provider
        value={{
          render: renderThreadComposer,
          report: reportInlineComposer,
          focusRequest: inlineFocus,
          dictation: {
            stt,
            state: voice.state,
            level: voice.level,
            active: dictationSession,
            disabled: micLive,
            error: voiceError,
            toggle: (id, receive) => void micToggle(id, { id, receive }),
            cancel: cancelAnswerDictation,
          },
        }}
      >
        <div
          className={styles.panelStage}
          data-canvas-expanded={canvasSize && !keyboardPeek ? true : undefined}
          data-wide={layout.wide || undefined}
          data-dual={layout.dual || undefined}
          data-instant={layout.instant || undefined}
          style={
            {
              '--canvas-side': `${canvasSize?.width ?? 0}px`,
              '--dual-card-width': `${layout.width}px`,
              '--right-wire-gutter': `${rightWireGutter}px`,
            } as CSSProperties
          }
        >
          <div className={styles.cardFrame}>
            <WorkspaceLinks
              card={card}
              enabled={(settings?.workspaceWires ?? false) && !keyboardPeek}
              // Exclusive groups use the outer edges; shared groups use the divider.
              centre={layout.split}
              onRightGutter={updateWireGutter}
              activePin={{
                enabled: settings?.pinnedActiveThreads ?? false,
                onToggle: async () => {
                  setActivePinError(null)
                  try {
                    const result = await window.threadlight.updateSettings({
                      pinnedActiveThreads: !settings?.pinnedActiveThreads,
                    })
                    if (!result.ok) setActivePinError(result.reason)
                  } catch {
                    setActivePinError('Could not save the Active threads pin.')
                  }
                },
              }}
              home={
                listHidden && !keyboardPeek
                  ? {
                      label: `Return to ${viewLabel}`,
                      onSelect: () => {
                        setShowSettings(false)
                        setShowMemory(false)
                        setShowAgent(false)
                        setPickingWorkspace(false)
                        setChangesFor(null)
                        setArtifactThread(null)
                        setMenu(null)
                        setListMenu(null)
                        setSourceMenu(null)
                        window.threadlight.setStayOpen(hold !== 'normal')
                      },
                    }
                  : undefined
              }
              onToggle={async () => {
                try {
                  const result = await window.threadlight.updateSettings({
                    workspaceWires: !settings?.workspaceWires,
                  })
                  if (!result.ok) setNotice(result.reason)
                } catch {
                  setNotice('Could not save the workspace wire setting.')
                }
              }}
            />
            <div
              ref={card}
              data-card=""
              data-agent-front={agentVisible || undefined}
              data-pinned={hold === 'pinned' || undefined}
              className={styles.card}
              data-workspace-height={workspaceView || undefined}
              // Room above the card, when opening upwards, keeps the card in place on screen.
              style={
                {
                  '--pin-colour': headerWireColour(settings?.workspaceWires ?? false),
                  '--panel-room': cardHeight + 'px',
                  // The native window follows content height; viewport units would feed
                  // footer expansion back into the smart thread's own layout.
                  '--thread-history-height': `${Math.min(350, maxHeight * 0.45)}px`,
                  '--pinned-active-height': `${Math.min(180, cardHeight * 0.3)}px`,
                  '--pinned-reader-height': `${Math.min(440, cardHeight * 0.5)}px`,
                  transition: canvasAvailable ? 'none' : undefined,
                  maxHeight: cardHeight,
                  marginTop: opensDown ? 0 : room,
                } as CSSProperties
              }
              onMouseLeave={leave}
            >
              {keyboardPeek && (
                <ActivePeek
                  sessions={scopedSessions}
                  relays={relays}
                  now={now}
                  onOpen={openActiveThread}
                />
              )}
              <div className={styles.panelContents} hidden={keyboardPeek}>
                <header
                  className={styles.header}
                  data-voice={showVoiceActivity || undefined}
                  aria-label="Panel header"
                  aria-description={hold === 'pinned' ? en.panel.pinnedHint : en.panel.pinHint}
                  data-tour-help={hold === 'pinned' ? en.panel.pinnedHint : en.panel.pinHint}
                  onClick={onHeaderClick}
                  onContextMenu={onListMenu}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault()
                      setMenu(null)
                      setSourceMenu(null)
                      const box = event.currentTarget.getBoundingClientRect()
                      setListMenu({ x: box.left + 8, y: box.bottom })
                    }
                  }}
                  {...drag.handlers}
                >
                  {canvasAvailable && (
                    <Tip
                      as="button"
                      className={`${styles.back} ${styles.canvasExpand}`}
                      text={canvasSize ? 'Restore compact view' : 'Expand canvas'}
                      aria-label={canvasSize ? 'Restore compact view' : 'Expand canvas'}
                      onClick={() => {
                        void window.threadlight
                          .setCanvasExpanded(!canvasSize)
                          .then(setCanvasSize)
                          .catch(() => setNotice('Could not resize overlay.'))
                      }}
                    >
                      {canvasSize ? '↙' : '↗'}
                    </Tip>
                  )}
                  {showVoiceActivity && (
                    <div className={styles.voiceActivity} role="region" aria-label="Voice waveform">
                      <ElectricMotion
                        source={motion.source}
                        label={
                          motion.label.includes('speaking')
                            ? motion.label
                            : composerOwnsLiveMic || (micLive && inputMuted)
                              ? 'Live microphone muted'
                              : openMicListening
                                ? 'Listening'
                                : 'Audio idle'
                        }
                        provider={voiceAgent.provider ?? undefined}
                        waveformOnly
                        edgeToEdge
                      />
                    </div>
                  )}
                  {showVoiceActivity && inactiveMicrophone && !agentVisible && (
                    <span className={styles.microphoneStatus}>no active Mic</span>
                  )}
                  {pickingWorkspace ? (
                    <>
                      <HeaderBack
                        onBack={() => setPickingWorkspace(false)}
                        collapsePinned={collapsePinned}
                        label={en.settings.back}
                      />
                      <span className={`${styles.heading} ${styles.pageHeading}`}>
                        {en.panel.chooseWorkspace}
                      </span>
                    </>
                  ) : changesFor ? (
                    <>
                      <HeaderBack
                        onBack={() => setChangesFor(null)}
                        collapsePinned={collapsePinned}
                        label={en.settings.back}
                      />
                      <span
                        className={`${styles.heading} ${styles.pageHeading}`}
                        title={changesHeading}
                      >
                        {changesHeading}
                      </span>
                    </>
                  ) : artifactThread ? (
                    <>
                      <HeaderBack
                        onBack={() => setArtifactThread(null)}
                        collapsePinned={collapsePinned}
                        label={'Back to threads'}
                      />
                      <span className={`${styles.heading} ${styles.pageHeading}`}>
                        {controlArtifact?.id === '@browser' ? 'Browser' : 'Artifacts'}
                      </span>
                      <div ref={setArtifactActionsHost} className={styles.artifactActionsSlot}>
                        {browserFront && (liveSpeech || agentOpenedBrowser) && (
                          <button
                            className={styles.browserAgent}
                            type="button"
                            aria-label={
                              liveSpeech
                                ? 'Return to live conversation'
                                : 'Return to Agent conversation'
                            }
                            title={
                              liveSpeech
                                ? 'Return to live conversation'
                                : 'Return to Agent conversation'
                            }
                            onClick={() => {
                              if (liveSpeech) returnToCall()
                              else {
                                setArtifactThread(null)
                                setShowAgent(true)
                                setRecentEntry(null)
                                agentNavigation.current?.showCurrent()
                              }
                            }}
                          >
                            <AgentDiamond />
                          </button>
                        )}
                      </div>
                      {browserFront && liveSpeech && (
                        <button
                          type="button"
                          className={styles.browserSpeaker}
                          onClick={toggleOutput}
                          aria-pressed={outputMuted}
                          aria-label={outputMuted ? 'Unmute Agent voice' : 'Mute Agent voice'}
                          title={outputMuted ? 'Unmute Agent voice' : 'Mute Agent voice'}
                        >
                          <CallIcon action="speaker" muted={outputMuted} />
                        </button>
                      )}
                      <div
                        ref={setArtifactNavigationHost}
                        className={styles.artifactNavigationSlot}
                      />
                    </>
                  ) : showAgent ? (
                    <>
                      {!agentSettingsOpen && (
                        <button
                          type="button"
                          ref={agentGear}
                          className={styles.gear + ' ' + styles.agentSettingsGear}
                          aria-label="Agent settings"
                          title="Agent settings"
                          onClick={() => {
                            setAgentSettingsOpen(true)
                            requestAnimationFrame(() => agentBack.current?.focus())
                          }}
                        >
                          <SettingsIcon />
                        </button>
                      )}
                      <HeaderBack
                        buttonRef={agentBack}
                        onBack={() =>
                          agentSettingsOpen ? closeAgentSettings() : setShowAgent(false)
                        }
                        collapsePinned={agentSettingsOpen ? undefined : collapsePinned}
                        label={agentSettingsOpen ? 'Back to Agent' : en.settings.back}
                      />
                      <span
                        className={[styles.heading, styles.pageHeading, styles.agentHeading].join(
                          ' ',
                        )}
                      >
                        {agentSettingsOpen ? 'Agent settings' : en.agent.title}
                      </span>
                    </>
                  ) : showMemory ? (
                    <>
                      <HeaderBack
                        onBack={() => spacesNavigation.current?.back()}
                        collapsePinned={collapsePinned}
                        label={'Back in Shared Spaces'}
                      />
                      <span
                        className={`${styles.heading} ${styles.pageHeading}${spacesHeader ? ` ${styles.projectHeading}` : ''}`}
                      >
                        {spacesHeader?.title ?? 'Shared Spaces'}
                      </span>
                    </>
                  ) : showSettings ? (
                    <>
                      <HeaderBack
                        onBack={() => setShowSettings(false)}
                        collapsePinned={collapsePinned}
                        label={en.settings.back}
                      />
                      <span className={`${styles.heading} ${styles.pageHeading}`}>
                        {en.settings.title}
                      </span>
                    </>
                  ) : (
                    <>
                      {
                        <Tip
                          as="button"
                          text={en.panel.header.views[headerView]}
                          tourHelp={en.panel.header.viewHelp}
                          className={styles.viewControl}
                          data-thread-view={headerView}
                          aria-pressed={view === 'all'}
                          aria-haspopup="menu"
                          onClick={cycleView}
                        >
                          {headerView === 'recent'
                            ? viewLabel
                            : `${viewLabel} · ${(showCode ? viewCount : 0) + accountCount}`}
                        </Tip>
                      }
                      {showCode && headerView === 'recent' && (
                        <Stepper
                          compact
                          label={en.settings.maxSessions}
                          valueTip={en.panel.header.sessionsListed}
                          value={settings?.maxSessions ?? 10}
                          min={3}
                          max={50}
                          format={String}
                          disabled={!settings || savingSessionLimit}
                          onChange={async (maxSessions) => {
                            setSavingSessionLimit(true)
                            try {
                              const result = await window.threadlight.updateSettings({
                                maxSessions,
                              })
                              if (!result.ok) setNotice(result.reason)
                            } catch {
                              setNotice('Could not save the session count.')
                            } finally {
                              setSavingSessionLimit(false)
                            }
                          }}
                        />
                      )}
                      <div
                        className={styles.sourceWorkspace}
                        data-header-filters=""
                        data-menu-open={sourceMenu !== null || undefined}
                      >
                        <Tip
                          as="button"
                          text={
                            showChats
                              ? 'Choose which coding and chat applications are shown.'
                              : provider === 'both' || provider === 'claude' || provider === 'codex'
                                ? en.panel.header.sources[provider]
                                : ''
                          }
                          tourHelp={en.panel.header.sourceHelp}
                          className={styles.sourceControl}
                          aria-label={`Filter applications: ${applicationLabel}`}
                          aria-haspopup="menu"
                          aria-expanded={sourceMenu !== null && sourceMenu.kind !== 'threads'}
                          onClick={(event) => {
                            const button = event.currentTarget as HTMLElement
                            const box = button.getBoundingClientRect()
                            setSourceMenu({
                              x: box.left,
                              y: box.bottom + 2,
                              anchor: button.closest('header') ?? button,
                            })
                          }}
                        >
                          {applicationLabel}
                        </Tip>
                        {showCode && (
                          <>
                            <span aria-hidden="true">·</span>
                            <Tip
                              as="button"
                              text={en.panel.header.workspaceInfo(workspaceName)}
                              tourHelp={en.panel.header.workspaceHelp}
                              className={styles.workspaceControl}
                              aria-label={`Choose workspace: ${workspaceName}`}
                              onClick={() => setPickingWorkspace(true)}
                            >
                              {workspaceName}
                            </Tip>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <Tip
                          as="button"
                          className={styles.sourceControl}
                          text={`Threads: ${threadFilterLabel}`}
                          tourHelp="Choose all threads, ordinary chats, or code and Computer tasks."
                          aria-label={`Filter threads: ${threadFilterLabel}`}
                          aria-haspopup="menu"
                          aria-expanded={sourceMenu?.kind === 'threads'}
                          data-thread-filter={conversationFilter}
                          onClick={(event) => {
                            const button = event.currentTarget as HTMLElement
                            const box = button.getBoundingClientRect()
                            setSourceMenu({
                              kind: 'threads',
                              x: box.left,
                              y: box.bottom + 2,
                              anchor: button.closest('header') ?? button,
                            })
                          }}
                        >
                          {conversationFilter === 'all'
                            ? 'Threads'
                            : conversationFilter === 'chat'
                              ? 'Chat'
                              : 'Code'}
                        </Tip>
                      </div>
                      {recentButton}
                      <button
                        className={styles.gear}
                        onClick={() => setShowSettings(true)}
                        aria-label={en.settings.open}
                        title={en.settings.open}
                      >
                        <SettingsIcon />
                      </button>
                    </>
                  )}
                  {(pickingWorkspace ||
                    changesFor ||
                    artifactThread ||
                    showSettings ||
                    showMemory ||
                    showAgent) &&
                    recentButton}
                </header>
                {creationNotice && (
                  <p className={styles.notice} role="status">
                    {creationNotice}
                  </p>
                )}

                {showVoiceActivity && !(browserFront && liveSpeech) && (
                  <VoicePresence
                    label={voice.state === 'transcribing' ? 'Finishing transcription' : ''}
                    caption={
                      agentVisible ? (agentRecording ? agentVoiceCaption : '') : motionCaption
                    }
                    compact={agentVisible}
                  />
                )}

                {pickingWorkspace && (
                  <WorkspacePicker
                    provider={provider}
                    onProviderChange={(selection) => void selectApplications(selection)}
                    workspaces={pickerWorkspaces}
                    chosen={pickerId(chosen)}
                    allDrives={allDrives}
                    onPickAll={() => void pickWorkspace(null, true)}
                    onPick={(id) => void pickWorkspace(id)}
                  />
                )}

                {changesFor && !pickingWorkspace && (
                  <ChangesView
                    initialRootId={changesFor.scope === 'card' ? undefined : changesFor.rootId}
                    onRoot={setComparisonRoot}
                    initialLens={changesFor.scope === 'card' ? undefined : changesFor.lens}
                    onLens={setComparisonLens}
                    onReadiness={setComparisonReadiness}
                    onScope={setComparisonScope}
                    onHeading={setComparisonHeading}
                    navigationRef={changesNavigation}
                    key={`${changesFor.scope}:${changesFor.sessionId}:${changesFor.scope === 'card' ? changesFor.card.id : (changesFor.navigationKey ?? '')}`}
                    sessionId={changesFor.sessionId}
                    scope={changesFor.scope}
                    card={changesFor.scope === 'card' ? changesFor.card : undefined}
                    threadStamp={changesThread?.threadDiff?.revision}
                    stamp={JSON.stringify([changesThread?.git, changesThread?.threadDiff])}
                  />
                )}

                {openMic === 'blocked' && (
                  <p className={styles.notice} role="alert">
                    {en.openMic.blocked}
                  </p>
                )}
                {(preparing || (micLive && showCallControls)) && (
                  <div
                    className={styles.callControls}
                    role="group"
                    aria-label="Live call controls"
                    data-mic-mode={micMode}
                  >
                    {(preparing ||
                      (gptLive && (livePhase === 'connecting' || openMic === 'off'))) && (
                      <small role="status">Connecting…</small>
                    )}
                    {!preparing && !gptLive && <small>{en.openMic.mode(micMode)}</small>}
                    <div className={styles.callButtons}>
                      <button
                        type="button"
                        disabled={!micLive}
                        aria-label={inputMuted ? 'Unmute microphone' : 'Mute microphone'}
                        aria-pressed={inputMuted}
                        title={
                          (inputMuted ? 'Unmute' : 'Mute') +
                          ` microphone (${LIVE_MUTE_KEYS.map(acceleratorLabel).join(' or ')})`
                        }
                        onClick={toggleInput}
                      >
                        <CallIcon action="mic" muted={inputMuted || composerOwnsLiveMic} />
                      </button>
                      {gptLive && micLive && (
                        <>
                          <button
                            type="button"
                            aria-label={outputMuted ? 'Unmute speaker' : 'Mute speaker'}
                            aria-pressed={outputMuted}
                            title={outputMuted ? 'Unmute speaker' : 'Mute speaker'}
                            onClick={toggleOutput}
                          >
                            <CallIcon action="speaker" muted={outputMuted} />
                          </button>
                          <button
                            type="button"
                            aria-label="Stop speaking"
                            title="Stop this spoken reply"
                            onClick={() => controls.current?.stopSpeaking()}
                          >
                            <CallIcon action="stop" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        aria-label={callConnected ? 'End call' : 'Cancel call setup'}
                        title={
                          callConnected ? 'End call and keep the conversation' : 'Cancel call setup'
                        }
                        className={callConnected ? styles.endCall : undefined}
                        onClick={endCall}
                      >
                        <CallIcon action={callConnected ? 'end' : 'cancel'} />
                      </button>
                      {callPageVisible && !voiceDestination && (
                        <span ref={setCallReplySlot} className={styles.callReplySlot} />
                      )}
                    </div>
                  </div>
                )}
                {artifactThread && (
                  <ArtifactView
                    navigationRef={artifactNavigation}
                    navigationHost={artifactNavigationHost}
                    actionsHost={artifactActionsHost}
                    infoHost={artifactInfoHost}
                    onClose={() => setArtifactThread(null)}
                    key={artifactThread.navigationKey}
                    historyKey={artifactThread.navigationKey}
                    threadId={artifactThread.id}
                    threadTitle={
                      (snapshot.lookupSessions ?? sessions).find((s) => s.id === artifactThread.id)
                        ?.title
                    }
                    initialArtifactId={artifactThread.artifactId}
                    onControlState={setControlArtifact}
                  />
                )}
                {agentPage.visited && (
                  <div
                    hidden={!showAgent || !!artifactThread || pickingWorkspace || !!changesFor}
                    style={
                      showAgent && !artifactThread && !pickingWorkspace && !changesFor
                        ? { display: 'contents' }
                        : undefined
                    }
                  >
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
                    <AgentView
                      settingsOpen={agentSettingsOpen}
                      onCloseSettings={() => setAgentSettingsOpen(false)}
                      readingResize={{ opensDown }}
                      callPreparing={preparing || micLive}
                      callReplySlot={callReplySlot}
                      onVoiceToggle={() =>
                        settings && isGptLiveShortcut(settings)
                          ? window.threadlight.startAgentVoice()
                          : void onTalk()
                      }
                      voiceActive={micLive && !voiceDestination}
                      navigationRef={agentNavigation}
                      recentEntry={recentEntry}
                      onRecentOpened={clearRecentEntry}
                      visible={
                        showAgent &&
                        !agentSettingsOpen &&
                        !artifactThread &&
                        !pickingWorkspace &&
                        !changesFor
                      }
                    />
                  </div>
                )}

                {showMemory && !showAgent && brainstormNotice && (
                  <p className={styles.notice} role="status">
                    {brainstormNotice}
                  </p>
                )}
                {showMemory && voiceDestination && (notice || liveError) && (
                  <p className={styles.notice} role="alert">
                    {notice || liveError}
                  </p>
                )}
                {showMemory && !showAgent && hotkeyProblem && (
                  <p className={styles.notice} role="alert">
                    {hotkeyProblem}
                  </p>
                )}
                <SharedSpacesView
                  currentRoot={snapshot.currentWorkspace?.replace(/^(claude|codex):/, '') ?? null}
                  workspaces={pickerWorkspaces.map((w) => ({
                    id: w.id.replace(/^(claude|codex):/, ''),
                    name: w.name,
                  }))}
                  focusedRoot={
                    headerView === 'workspace'
                      ? (focusId?.replace(/^(claude|codex):/, '') ?? null)
                      : null
                  }
                  navigationRef={spacesNavigation}
                  onControlRoute={setSpacesRoute}
                  onHeaderChange={changeSpacesHeader}
                  onVoiceToggle={(client) => void onTalk(client)}
                  voiceActive={micLive && !!voiceDestination}
                  visible={
                    showMemory &&
                    !showAgent &&
                    !pickingWorkspace &&
                    changesFor === null &&
                    !keyboardPeek
                  }
                  sessions={snapshot.lookupSessions ?? snapshot.sessions}
                  onClose={() => {
                    setShowMemory(false)
                    window.threadlight.setStayOpen(hold !== 'normal')
                  }}
                />
                {showSettings && !settings && !pickingWorkspace && !showAgent && !showMemory && (
                  <p role="status" className={styles.notice}>
                    Loading settings. Unavailable reads retry automatically.
                  </p>
                )}
                {showSettings && settings && !pickingWorkspace && !showAgent && !showMemory && (
                  <SettingsView
                    hotkeyProblem={hotkeyProblem}
                    currentAgentProvider={agent.provider ?? undefined}
                    providerLocked={voice.state !== 'idle'}
                    settings={settings}
                    stt={stt}
                    version={version}
                    onPickWorkspace={() => setPickingWorkspace(true)}
                  />
                )}

                {/* Kept mounted (just hidden) while settings show, so a half-typed message survives. */}
                <div className={styles.sessions} hidden={listHidden}>
                  {(hotkeyProblem || notice) && (
                    <p className={styles.notice}>{notice ?? hotkeyProblem}</p>
                  )}
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

                  <div
                    ref={listElement}
                    id="thread-list"
                    role="region"
                    aria-label="Threads"
                    tabIndex={0}
                    className={styles.list}
                    data-workspace-thread-list=""
                  >
                    {mergeRecent && showCode && shown.length === 0 && accountCount === 0 && (
                      <p className={`${styles.empty} ${styles.emptyWindow}`}>
                        {provider === 'none' ? en.sources.paused : emptyWindow}
                      </p>
                    )}
                    <AccountChats
                      visible={accountListVisible}
                      chats={accountRows}
                      now={now}
                      sessions={mergeRecent ? (showCode ? shown : []) : undefined}
                      renderSession={renderRow}
                      limit={settings?.maxSessions ?? 10}
                      layoutItems={layoutMenuItems}
                    />
                    <div hidden={!showCode || mergeRecent} data-code-computer="">
                      {!mergeRecent &&
                        (tree ? (
                          <div className={styles.dualList}>
                            <div className={styles.dualLeft} data-split={layout.split || undefined}>
                              {layout.split && (
                                <WorkspaceTree {...treeProps} workspaces={workspacesOf('claude')} />
                              )}
                            </div>
                            <div className={styles.dualRight} data-dual-right="">
                              <WorkspaceTree
                                {...treeProps}
                                workspaces={
                                  layout.split ? workspacesOf('codex') : snapshot.workspaces
                                }
                              />
                            </div>
                          </div>
                        ) : (
                          <>
                            {shown.length === 0 && accountCount === 0 && (
                              <p
                                className={
                                  provider !== 'none'
                                    ? `${styles.empty} ${view === 'active' ? styles.emptyActive : styles.emptyWindow}`
                                    : styles.empty
                                }
                              >
                                {provider === 'none'
                                  ? en.sources.paused
                                  : view === 'active'
                                    ? en.panel.nothingWorking
                                    : emptyWindow}
                              </p>
                            )}
                            <div className={styles.dualList}>
                              <div
                                className={styles.dualLeft}
                                data-split={layout.split || undefined}
                              >
                                {layout.split
                                  ? shown
                                      .filter((s) => sessionProvider(s.id) === 'claude')
                                      .map(renderRow)
                                  : null}
                              </div>
                              <div className={styles.dualRight} data-dual-right="">
                                {(layout.split
                                  ? shown.filter((s) => sessionProvider(s.id) === 'codex')
                                  : shown
                                ).map(renderRow)}
                              </div>
                            </div>
                          </>
                        ))}
                    </div>
                  </div>

                  {showCode && target && compose && inlineView?.id !== target.id && (
                    <Composer
                      key={`${target.id}:${compose.initialText ?? ''}`}
                      session={target}
                      relay={relays.get(target.id)}
                      stt={stt}
                      voiceState={dictationSession === target.id ? voice.state : 'idle'}
                      level={dictationSession === target.id ? voice.level : 0}
                      micDisabled={voice.state !== 'idle' && dictationSession !== target.id}
                      onMic={() => void micToggle(target.id)}
                      heard={heard?.sessionId === target.id ? heard : null}
                      voiceError={dictationSession === target.id ? voiceError : null}
                      initialText={compose.initialText}
                      countdownSeconds={compose.countdownSeconds}
                      cancelToken={cancelToken}
                      onClose={closeComposer}
                    />
                  )}
                </div>

                {pinVisible && (
                  <ActivePeek
                    pinned
                    expanded={pinnedThread}
                    onOpen={(session) =>
                      setPinnedThread((current) => (current === session.id ? null : session.id))
                    }
                    renderDetail={(session) => (
                      <PinnedThreadReader
                        session={session}
                        relay={relays.get(session.id)}
                        now={now}
                        onClose={() => setPinnedThread(null)}
                        onOpenArtifact={(id) => openArtifacts(session, id)}
                        renderComposer={(hidden, focus) =>
                          renderThreadComposer(session, relays.get(session.id), hidden, focus)
                        }
                      />
                    )}
                    sessions={scopedSessions.filter(
                      (session) =>
                        session.id === pinnedThread ||
                        isActive(session, now) ||
                        now - session.lastActiveAt < LINGER_MS,
                    )}
                    relays={relays}
                    now={now}
                  />
                )}
                {activePinError && (
                  <p className={styles.notice} role="alert">
                    {activePinError}
                  </p>
                )}
                <PinnedCodeDock />
                <div className={styles.usageBars} data-parallel={provider === 'both' || undefined}>
                  {workspaceView ? (
                    <WorkspaceResize
                      maxHeight={maxHeight}
                      saving={savingWorkspaceHeight}
                      onPreview={setWorkspaceDragHeight}
                      onCommit={(height) => void saveWorkspaceHeight(height)}
                    >
                      {usageBars}
                    </WorkspaceResize>
                  ) : (
                    usageBars
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
                {listMenu && (
                  <ContextMenu
                    label="Header menu"
                    x={listMenu.x}
                    y={listMenu.y}
                    items={listMenuItems}
                    onClose={() => setListMenu(null)}
                  />
                )}
                {sourceMenu && (
                  <ContextMenu
                    label={sourceMenu.kind === 'threads' ? 'Thread filter' : 'Applications filter'}
                    x={sourceMenu.x}
                    y={sourceMenu.y}
                    anchor={sourceMenu.anchor}
                    items={sourceMenu.kind === 'threads' ? threadFilterItems : sourceMenuItems}
                    onClose={() => setSourceMenu(null)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </ThreadComposerContext.Provider>
    </PanelProviders>
  )
}

function PanelProviders({
  liveInput,
  room,
  helpMode,
  openCardChanges,
  children,
}: {
  liveInput: LiveInputPreview | null
  room: PanelRoomSource
  helpMode: HelpMode
  openCardChanges: (threadId: string, item: TimelineItem) => void
  children: ReactNode
}) {
  const [navigationCache] = useState<NavigationCache>(() => new Map())
  return (
    <NavigationHistoryContext.Provider value={navigationCache}>
      <PanelRoomContext.Provider value={room}>
        <CardChangesContext.Provider value={openCardChanges}>
          <CodePinsProvider>
            <LiveInputContext.Provider value={liveInput}>
              <HoverHelp mode={helpMode}>{children}</HoverHelp>
            </LiveInputContext.Provider>
          </CodePinsProvider>
        </CardChangesContext.Provider>
      </PanelRoomContext.Provider>
    </NavigationHistoryContext.Provider>
  )
}
