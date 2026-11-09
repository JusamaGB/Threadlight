import { SharedBrowserService } from './browser/service'
import { AppControlService, controlSettingsRevision } from './appControl/service'
import { ChangeWorkflowService } from './changeWorkflow'
import { findGitRepository } from './sessions/gitRepository'
import { restartAction } from './restart'
import { closeOwnedProcesses } from './agent/ownedProcess'
import { controlWorkspaces } from './appControl/workspaces'
import { observerActive } from './appControl/restartGuard'
import { AppControlServer } from './appControl/server'
import {
  openSpaceProvider,
  spaceChatContext,
  startSpaceChat,
  type SpaceChatInput,
} from './appControl/startSpaceChat'
import { registerAppControl } from './appControl/integration'
import { OwnedRequests } from './communication/ownedRequests'
import { withManagedQuestions } from '../shared/managedQuestions'
import type { CommunicationQuestion } from '../shared/communication'
import { codexCommunicationAdmitted } from './communication/admission'
import { codexHeld } from './codex/live'
import { CommunicationCatalog } from './communication/catalog'
import { AccountChatTransport } from './communication/accountChatTransport'
import { accountChatTarget } from '../shared/communicationTargets'
import { setLiveTimingFile, recordLiveTiming } from './agent/liveTiming'
import { appendFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, win32 } from 'node:path'
import { tmpdir } from 'node:os'

import {
  app,
  clipboard,
  ipcMain,
  nativeTheme,
  Notification,
  session,
  shell,
  type WebContents,
} from 'electron'
import { registerArtifacts } from './artifactIntegration'
import { registerPerplexity } from './perplexity/integration'
import { registerAccountChats } from './accountChats/integration'
import { registerThreadTimeline } from './threadTimelineIntegration'

import { agentBusy } from '../shared/agent'
import { IPC } from '../shared/ipc'
import { registerMicIndicator } from './micIndicator'
import { LiveScreen } from './liveScreen'
import { ScreenRegionHelp, ScreenReplySpeech } from './screenRegionHelp'
import type { Settings } from '../shared/settings'
import { isGptLiveShortcut, voiceHotkeyMode } from '../shared/settings'
import type { Provider, Session, Snapshot, ThreadNode, RelayStatus } from '../shared/types'
import {
  combinedSnapshot,
  providerView,
  sessionProvider,
  workspaceFolder,
} from '../shared/providers'
import { isClaudeAppRunning, openThread } from './claudeApp'
import { DEFAULT_HOOK_PORT, startHookServer } from './hookServer'
import { BRAINSTORM_HOTKEY, TalkHotkey, LiveMuteShortcut } from './hotkeys'
import { windowsMuteKeys } from './windowsMuteKeys'
import { sameAccelerator } from '../shared/accelerator'
import { ModifierStepper } from './modifierStepper'
import { AgentService } from './agent/agentService'
import { ScreenReplyVoice } from './agent/screenReplyVoice'
import { EditorCoach } from './editorCoach'
import { RecentAgent } from './agent/recentAgent'
import { excludeAgentChats } from './agent/briefing'
import { isObject } from './sessions/json'
import { foregroundTitle, foregroundWindowId } from './keyState'
import { setLaunchAtSignIn } from './loginItem'
import { Holds } from './holds'
import { UsageWatcher } from './usage'
import { findClaudeCli, isHeld, type CliCommand } from './relay'
import { RelayService } from './relayService'
import { HookStateStore } from './sessions/hookState'
import { agentPaths, codexPaths, defaultPaths, messagingPaths } from './sessions/paths'
import { PinnedCodeStore } from './pinnedCode'
import { MessageStore } from './messaging/store'
import { MESSAGE_LIMIT } from '../shared/messaging'
import { CodexTracker } from './codex/tracker'
import { NativeCodexQuestions } from './codex/nativeQuestions'
import { QuestionObserver } from './codex/questionObserver'
import { NativeCodexMessages } from './codex/nativeMessages'
import { CodexQueue } from './codex/queue'
import type { QueueCommand } from '../shared/codexQueue'
import { NewCodexThreads, handoffNewCodexThread } from './codex/newThread'
import { CodexClient } from './agent/codexClient'
import { newThreadPaths } from './sessions/paths'
import type { NewThreadRequest } from '../shared/newThread'
import { ComposerAttachmentStore } from './messaging/attachments'
import { registerComposerAttachments } from './messaging/attachmentIntegration'
import { CodexHolds } from './codex/holds'
import { CodexRelayService, findCodexCli } from './codex/relay'
import { codexDeepLink } from './codex/identity'
import { codexProcesses } from './codex/live'
import { SessionService } from './sessions/service'
import { ProviderSnapshots } from './sessions/providerSnapshots'
import { PLAN_CONTEXT, readStepActivity } from './sessions/stepActivity'
import { ThreadChanges } from './sessions/threadChanges'
import { captureGit, retainedPatch, retainedPath, forgetComparisons, within } from './changes/git'
import { LocalHistory } from './changes/store'
import type { ChangeLens, TrackingAction } from '../shared/changes'
import { IgnoredInput } from './ignoredInput'
import { GitStates } from './sessions/gitDiff'
import { inside, listChanges, readFileDiff } from './sessions/gitChanges'
import { Tracker } from './sessions/tracker'
import { SettingsStore } from './settings'
import { inspectLocalRuntime } from './kimi/runtime'
import { runSetup, setupArgs } from './setupMode'
import { SttService } from './stt/service'
import { createTray } from './tray'
import { WindowManager } from './windows'
import { startMemory } from './memory/integration'
import { spacesPaths } from './sessions/paths'
import { SpacesStore } from './spaces/store'
import { SpacesService } from './spaces/service'
import { registerSpaces } from './spaces/integration'
import { ThreadReadServer } from './threadRead/server'
import { ThreadReadService } from './threadRead/service'
import { ClaudeReadAdapter } from './threadRead/claude'
import { CodexReadAdapter } from './threadRead/codex'
import { attentionEvidence } from './threadRead/attention'

/** Updates from the two sources closer together than this go out as one. */
const PUBLISH_COALESCE_MS = 120
const SCAN_INTERVAL_MS = 1000
const CLAUDE_CHECK_INTERVAL_MS = 2000
/** How often to look for a new window in front, to raise the dot above it. */
const ON_TOP_CHECK_MS = 500

const setup = setupArgs()
if (setup) {
  runSetup(setup) // the installer's one-shot helpers (setupMode.ts)
} else if (!app.requestSingleInstanceLock()) {
  // One Threadlight per user: a second launch just exits.
  app.quit()
} else {
  void app.whenReady().then(start)
  // Threadlight lives in the corner and the tray, not in windows; hiding them never quits it.
  app.on('window-all-closed', () => {})
}

/**
 * Closes Threadlight and starts it again. The normal quit runs first (held cards are released,
 * the Agent is retired); if that ever hangs, the process is forced out after a few seconds so
 * the restart still happens. Settings and threads live on disk and are untouched.
 */
const restart = restartAction(app)

async function start(): Promise<void> {
  nativeTheme.themeSource = 'dark'
  const paths = defaultPaths()
  const settings = new SettingsStore(app.getPath('userData'))
  const initial = await settings.load()
  const enabled = (provider: Provider) => settings.settings.enabledProviders.includes(provider)

  const hooks = new HookStateStore()
  const windows = new WindowManager()
  const liveScreen = new LiveScreen(
    join(app.getAppPath(), 'resources', 'live-screen.ps1'),
    (id, image) => {
      if (!id) outsideHelp.receive(image)
      else {
        const owner =
          id === agent.activeLiveSession
            ? agent
            : id === spaces?.agent.activeLiveSession
              ? spaces.agent
              : null
        if (owner) {
          notifyRegion('Screen region captured. Sending to Live…')
          void owner
            .shareLiveRegion(id, image)
            .then((result) => {
              if (owner.activeLiveSession === id)
                notifyRegion(
                  result.ok ? (result.notice ?? 'Screen region sent to Live.') : result.reason,
                )
            })
            .catch(() => {
              if (owner.activeLiveSession === id)
                notifyRegion('Screen region delivery was not confirmed.')
            })
        }
      }
    },
    (id, reason) => {
      if (!id) notifyRegion(reason)
      else if (id === agent.activeLiveSession) agent.liveScreenError(id, reason)
      else spaces?.agent.liveScreenError(id, reason)
    },
  )
  registerMicIndicator(windows, (level) => liveScreen.voice(level))
  // The agent's own folder; its conversations stay out of the thread list unless shown.
  const agentFiles = agentPaths(app.getPath('userData'))
  const recentAgent = new RecentAgent(join(app.getPath('userData'), 'recent-agent.json'))
  const agentWorkspace = agentFiles.workspace
  const agentSessionIds = new Set<string>()
  // Cards held so they can be answered here (holds.ts); any change is shown at once.
  const holds = new Holds(() => {
    if (enabled('claude')) void claudeSessions.refresh()
    if (windows.panel && !windows.panel.isDestroyed())
      windows.panel.webContents.send(IPC.communicationChanged)
  })
  // Each folder's git state, counted in the background; a new count is shown at once.
  const gitStates = new GitStates((root, invalidated) => {
    if (invalidated) threadChanges.invalidate(root)
    publish()
  })
  // Requests the user has set aside in Threadlight: they stop holding a place in Recent.
  const ignoredInput = new IgnoredInput(
    join(app.getPath('userData'), 'dismissed-codex-questions.json'),
  )
  const pinned = (session: Session) => session.state !== 'idle' && !ignoredInput.isIgnored(session)
  const tracker = new Tracker({
    paths,
    hooks,
    pinned,
    windowHours: initial.listWindowHours,
    maxSessions: initial.maxSessions,
    held: (id) => holds.held(id),
    gitFor: (folder) => gitStates.peek(folder),
    hiddenFolder: () => agentWorkspace,
  })
  // A scan that takes long is noted in scan-timing.log (in Threadlight's data folder), so a slow
  // history shows up as numbers rather than as a feeling. The file is kept small.
  const scanLog = join(app.getPath('userData'), 'scan-timing.log')
  const reportSlowScan = (label: string) => (ms: number, snapshot: Snapshot) => {
    const line = `${new Date().toISOString()} ${label} scan ${Math.round(ms)} ms (${snapshot.sessions.length} recent, ${snapshot.workspaces.length} workspaces)\n`
    void stat(scanLog)
      .then((info) => info.size)
      .catch(() => 0)
      .then((size) => (size > 100_000 ? writeFile(scanLog, line) : appendFile(scanLog, line)))
      .catch(() => {})
  }
  const providerSnapshots = new ProviderSnapshots(() => publish())
  const claudeSessions = new SessionService(
    tracker,
    (snapshot) => {
      letHeldCardsGo(holds, snapshot)
      providerSnapshots.update('claude', snapshot)
    },
    reportSlowScan('Claude'),
  )
  const codex = codexPaths()
  const messageStore = new MessageStore(messagingPaths(app.getPath('userData')).store)
  await messageStore.load().catch(() => {
    console.error('Message recovery storage is unavailable; existing data has been retained.')
  })
  const draftHomes = {
    codex: await realpath(codex.home).catch(() => codex.home),
    claude: await realpath(paths.projectsDir).catch(() => paths.projectsDir),
  }
  const draftKey = (id: string) =>
    `${createHash('sha256').update(draftHomes[sessionProvider(id)]).digest('hex')}:${id}`
  const codexHolds = new CodexHolds(() => {
    if (enabled('codex')) void codexSessions.refresh()
    if (windows.panel && !windows.panel.isDestroyed())
      windows.panel.webContents.send(IPC.communicationChanged)
  })
  const questionObserver = new QuestionObserver(() => void codexSessions.refresh())
  const codexTracker = new CodexTracker(
    codex,
    codexHolds,
    (folder) => gitStates.peek(folder),
    (id, cwd) =>
      agentSessionIds.has(id) ||
      win32.normalize(cwd.replace(/^\\\\\?\\/, '')).toLowerCase() ===
        win32.normalize(agentWorkspace.replace(/^\\\\\?\\/, '')).toLowerCase(),
    pinned,
    questionObserver,
    (id, ref) => ignoredInput.isQuestionDismissed(id, ref),
  )
  codexTracker.configure(initial.listWindowHours, initial.maxSessions)
  const codexSessions = new SessionService(
    codexTracker,
    (snapshot) => {
      providerSnapshots.update('codex', snapshot)
    },
    reportSlowScan('Codex'),
  )
  const localHistory = new LocalHistory(join(app.getPath('userData'), 'local-change-history'))
  void localHistory.start().catch(() => {
    /* A newer/unavailable store must not prevent app startup. */
  })
  const threadChanges = new ThreadChanges({
    recordEvidence: (session, ledger) =>
      localHistory.recordEvidence(session.git?.root ?? session.cwd, session.id, ledger),
    recordedEvidence: (session) =>
      localHistory.recordedEvidence(session.git?.root ?? session.cwd, session.id),
    folderComparison: (session) => localHistory.comparison(session.cwd),
    history: codex.history,
    transcript: (id) => tracker.transcriptPath(id),
    changed: () => publish(),
  })
  const sources = { claude: claudeSessions, codex: codexSessions }
  let providerPolling: NodeJS.Timeout | null = null
  let providerRefresh: Promise<void> | null = null
  function syncPolling(ms: number) {
    if (providerPolling) clearInterval(providerPolling)
    providerPolling = null
    if (!settings.settings.enabledProviders.length) return
    void sessions.refresh()
    providerPolling = setInterval(() => void sessions.refresh(), ms)
  }
  // Polling commits a complete provider pair. Coalesce independent hook/git updates too.
  let publishTimer: NodeJS.Timeout | null = null
  let managedQuestions: CommunicationQuestion[] = []
  function publish() {
    if (publishTimer) return
    publishTimer = setTimeout(() => {
      publishTimer = null
      if (windows.panel.isDestroyed()) return
      const snapshot = sessions.snapshot
      windows.setAttention(snapshot.sessions)
      windows.send(IPC.sessionsChanged, snapshot.sessions)
      windows.panel.webContents.send(IPC.snapshotChanged, snapshot)
    }, PUBLISH_COALESCE_MS)
  }
  const sessions = {
    get snapshot() {
      return ignoredInput.annotate(
        threadChanges.annotate(
          gitStates.annotate(
            combinedSnapshot(
              settings.settings.enabledProviders,
              {
                claude: withManagedQuestions(
                  excludeAgentChats(providerSnapshots.snapshots.claude, agentSessionIds),
                  managedQuestions,
                ),
                codex: withManagedQuestions(
                  excludeAgentChats(providerSnapshots.snapshots.codex, agentSessionIds),
                  managedQuestions,
                ),
              },
              settings.settings.maxSessions,
              pinned,
            ),
          ),
        ),
      )
    },
    get sessions() {
      return this.snapshot.sessions
    },
    find: (id: string) =>
      enabled(sessionProvider(id)) ? sources[sessionProvider(id)].find(id) : undefined,
    setView: (view: Parameters<SessionService['setView']>[0]) => {
      let changed = false
      for (const provider of settings.settings.enabledProviders)
        changed =
          sources[provider].setView(
            providerView(settings.settings.enabledProviders, provider, view),
            false,
          ) || changed
      if (changed) void sessions.refresh()
    },
    refresh: (): Promise<void> => {
      // A slow poll must not keep extending a batch and prevent it from ever publishing.
      providerRefresh ??= providerSnapshots
        .batch(() =>
          Promise.all(
            settings.settings.enabledProviders.map((provider) => sources[provider].refresh()),
          ),
        )
        .finally(() => {
          providerRefresh = null
        })
      return providerRefresh
    },
    start: syncPolling,
  }
  const invalidateGitForHook = (payload: unknown, provider: Provider) => {
    if (!isObject(payload)) return
    // Prompt, permission and pre-tool events cannot yet contain completed file changes.
    if (
      ![
        'PostToolUse',
        'PostToolUseFailure',
        'Stop',
        'SessionStart',
        'SessionEnd',
        'Interrupt',
      ].includes(String(payload.hook_event_name))
    )
      return
    if (/^(Read|Glob|Grep|WebFetch|WebSearch)$/.test(String(payload.tool_name))) return
    const id =
      typeof payload.session_id === 'string'
        ? provider === 'codex'
          ? `codex:${payload.session_id}`
          : payload.session_id
        : null
    const session = id ? everySession(sessions.snapshot).find((item) => item.id === id) : undefined
    if (session?.git?.root) gitStates.invalidate(session.git.root)
  }
  // Codex hooks use a separate port and contracts. Claude's routes and plugin stay intact.
  startHookServer({
    port: 47616,
    status: () => ({ app: 'threadlight-codex', version: app.getVersion() }),
    onEvent: (payload) => {
      codexHolds.event(payload)
      invalidateGitForHook(payload, 'codex')
    },
    onAsk: (payload, reply, dropped) => {
      if (isObject(payload) && agentSessionIds.has(`codex:${payload.session_id}`)) return false
      codexHolds.event(payload)
      invalidateGitForHook(payload, 'codex')
      if (!enabled('codex') || /^(Codex|ChatGPT)$/.test(foregroundTitle() || '')) return false
      const held = codexHolds.hold(payload, reply)
      if (held) dropped(() => codexHolds.dropped(reply))
      return held
    },
    onStop: (payload, reply, dropped) => {
      if (isObject(payload) && agentSessionIds.has(`codex:${payload.session_id}`)) return false
      codexHolds.event(payload)
      invalidateGitForHook(payload, 'codex')
      if (!enabled('codex') || /^(Codex|ChatGPT)$/.test(foregroundTitle() || '')) return false
      const held = codexHolds.hold(payload, reply)
      if (held) dropped(() => codexHolds.dropped(reply))
      return held
    },
  }).catch((error) => console.error('Codex hooks unavailable', error))

  // Hook events make state exact and immediate: apply, then rescan straight away.
  let hookEvents = 0
  startHookServer({
    port: DEFAULT_HOOK_PORT,
    // For the installer's check: is it running, and have the plugin's hooks reached it?
    status: () => ({ app: 'threadlight', version: app.getVersion(), hookEvents }),
    context: () => PLAN_CONTEXT,
    onEvent: (payload) => {
      hookEvents += 1
      if (!enabled('claude')) return
      hooks.apply(payload)
      invalidateGitForHook(payload, 'claude')
      void claudeSessions.refresh()
    },
    // The question-card hook waits here for an answer (or to be let go).
    onAsk: (payload, reply, dropped) => {
      if (!enabled('claude')) return false
      const held = holds.holdQuestion(payload, reply)
      if (held) dropped(() => holds.dropped(reply))
      return held
    },
    // A tool waiting for permission (a plan to approve included) waits here to be allowed.
    onPermission: (payload, reply, dropped) => {
      if (!enabled('claude')) return false
      const held = holds.holdApproval(payload, reply)
      if (held) dropped(() => holds.dropped(reply))
      return held
    },
    // A New session / Do it here offer waits here, before Claude shows its own card.
    onOffer: (payload, reply, dropped) => {
      if (!enabled('claude')) return false
      const held = holds.holdOffer(payload, reply)
      if (held) dropped(() => holds.dropped(reply))
      return held
    },
    // The Stop hook waits here when a turn ends, in case it asked a next-step question.
    onStop: (payload, reply, dropped) => {
      if (!enabled('claude')) return false
      const event = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >
      const sessionId = typeof event['session_id'] === 'string' ? event['session_id'] : null
      // A turn already carried on by an answer is let finish; so is anything unrecognised.
      if (!sessionId || event['stop_hook_active'] === true) return false
      dropped(() => holds.dropped(reply))
      hooks.apply(payload) // the turn has ended: idle, so the next-step card can show
      invalidateGitForHook(payload, 'claude')
      void claudeSessions.refresh().then(() => {
        if (!enabled('claude')) return reply(null)
        const attention = everySession(claudeSessions.snapshot).find(
          (s) => s.id === sessionId,
        )?.attention
        const answerable = attention?.kind === 'next-step' && attention.actions.length > 0
        if (answerable) holds.holdNextStep(sessionId, attention, reply)
        else reply(null) // nothing asked: the turn ends straight away
      })
      return true
    },
  }).catch((error: unknown) => {
    // Most likely another program holds the port. Threadlight still works on transcripts alone.
    console.error(`Hook server could not start on port ${DEFAULT_HOOK_PORT}`, error)
  })

  ipcMain.handle(IPC.getVersion, () => app.getVersion())
  const perplexity = registerPerplexity(windows.panel, app.getPath('userData'))
  const accountChats = registerAccountChats(
    windows.panel,
    async () => {
      await codexSessions.refresh()
      const snapshot = codexSessions.snapshot
      return everySession(snapshot)
        .filter((s) => s.id.startsWith('codex:'))
        .sort(
          (a, b) =>
            Number(b.id === snapshot.currentThreadId) - Number(a.id === snapshot.currentThreadId) ||
            b.lastActiveAt - a.lastActiveAt,
        )
        .slice(0, 200)
        .map((s) => ({ id: s.id.slice(6), title: s.title }))
    },
    (source) => settings.settings.chatSources.includes(source),
  )
  app.once('will-quit', () => accountChats.close())
  ipcMain.handle(IPC.getSessions, () => sessions.sessions)
  ipcMain.handle(IPC.getSnapshot, () => sessions.snapshot)
  ipcMain.on(IPC.setTreeView, (_event, view: unknown) => {
    const valid = (list: unknown): list is string[] =>
      Array.isArray(list) && list.length <= 20000 && list.every((item) => typeof item === 'string')
    const raw = (typeof view === 'object' && view !== null ? view : {}) as Record<string, unknown>
    sessions.setView({
      expanded: raw['expanded'] === null ? null : valid(raw['expanded']) ? raw['expanded'] : null,
      showAll: valid(raw['showAll']) ? raw['showAll'] : [],
      everything: raw['everything'] === true,
    })
  })
  ipcMain.on(IPC.dotClick, () => windows.openFromDot())
  ipcMain.on(IPC.dotHover, () => windows.openFromDot(true))
  ipcMain.on(IPC.dotDrag, (_event, dx: unknown, dy: unknown) =>
    windows.dragDot(Number(dx), Number(dy)),
  )
  ipcMain.on(IPC.dotDragEnd, () => windows.endDrag())
  ipcMain.on(IPC.resetDotPosition, () => windows.resetDotPosition())
  ipcMain.handle(IPC.canvasExpanded, (_event, on: unknown) => windows.setCanvasExpanded(on))
  ipcMain.on(IPC.panelResize, (_event, height: unknown) => windows.resizePanel(Number(height)))
  ipcMain.handle(IPC.getAttentionMotion, () => windows.attentionMotion)
  ipcMain.on(IPC.panelClose, () => windows.closePanel())
  ipcMain.on(IPC.panelLeave, () => windows.closeOnPointerLeave())
  const pins = new PinnedCodeStore(
    join(app.getPath('userData'), 'pinned-references.json'),
    (state) => windows.pinsChanged(state),
  )
  ipcMain.handle(IPC.pinnedCode, (event, command: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame || !windows.codeWindow(event.sender))
      throw Error('Pinned references are unavailable in this window.')
    return pins.request(command)
  })
  ipcMain.on(IPC.pinnedCodeSize, (event, visible: unknown, height: unknown) => {
    if (
      event.senderFrame === event.sender.mainFrame &&
      windows.codeWindow(event.sender) &&
      typeof visible === 'boolean' &&
      typeof height === 'number' &&
      Number.isFinite(height)
    )
      windows.setPinnedCode(!!pins.current?.files.length, height)
  })
  ipcMain.on(IPC.codePan, (event, id: unknown, active: unknown) => {
    const win = windows.codeWindow(event.sender)
    if (
      win &&
      event.senderFrame === event.sender.mainFrame &&
      typeof id === 'string' &&
      /^[a-z0-9-]{1,64}$/i.test(id)
    )
      windows.codePan(id, active === true, win)
  })
  ipcMain.on(IPC.panelStayOpen, (_event, on: unknown) => windows.setStayOpen(on === true))
  ipcMain.on(IPC.workspaceWireControl, (event, bounds: unknown) => {
    if (event.sender === windows.panel.webContents) windows.setWorkspaceWireControl(bounds)
  })
  ipcMain.on(IPC.workspaceWireRegions, (event, regions: unknown) => {
    if (event.sender === windows.panel.webContents) windows.setWorkspaceWireRegions(regions)
  })
  ipcMain.handle(IPC.panelLayout, (event, layout: unknown, animating: unknown) =>
    event.sender === windows.panel.webContents ? windows.setPanelLayout(layout, animating) : null,
  )
  ipcMain.handle(IPC.workspaceWireGutter, (event, width: unknown) =>
    event.sender === windows.panel.webContents ? windows.setWorkspaceWireGutter(width) : null,
  )
  ipcMain.handle(IPC.workspacePanel, (event, on: unknown) =>
    event.sender === windows.panel.webContents && typeof on === 'boolean'
      ? windows.setWorkspacePanel(on)
      : null,
  )
  ipcMain.on(IPC.restartApp, (event) => {
    if (event.sender === windows.panel.webContents) restart()
  })
  ipcMain.on(IPC.ignoreNeedsInput, (event, id: unknown, ignore: unknown) => {
    if (event.sender !== windows.panel.webContents) return
    if (typeof id !== 'string' || typeof ignore !== 'boolean') return
    const session = sessions.find(id)
    if (!session) return
    ignoredInput.set(session, ignore)
    // The lists pick their pinned places again, then everything is republished.
    publish()
    void sessions.refresh()
  })
  ipcMain.handle(IPC.dismissCodexQuestion, (event, id, ref) => {
    if (
      event.sender !== windows.panel.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof id !== 'string' ||
      !ref ||
      typeof ref !== 'object'
    )
      return false
    const session = everySession(sessions.snapshot).find((item) => item.id === id)
    if (!session || !ignoredInput.dismiss(session, ref)) return false
    publish()
    void sessions.refresh()
    return true
  })
  ipcMain.on(IPC.openInClaude, (_event, appId: unknown) => {
    if (typeof appId !== 'string') return
    if (appId.startsWith('codex:')) {
      const link = codexDeepLink(appId)
      if (link && codexSessions.find(appId)) {
        codexHolds.release(appId)
        void shell.openExternal(link)
        windows.closePanel()
      }
      return
    }
    // Going to the thread in Claude means answering there: let a held card go first.
    const session = everySession(claudeSessions.snapshot).find((s) => s.appId === appId)
    if (session) holds.release(session.id)
    if (openThread(appId)) windows.closePanel()
  })
  ipcMain.handle(
    IPC.answerQuestion,
    (event, sessionId: unknown, answers: unknown, holdId: unknown) =>
      event.sender === windows.panel.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      typeof sessionId === 'string' &&
      typeof holdId === 'string' &&
      holds.held(sessionId)?.id === holdId
        ? holds.answerQuestion(sessionId, answers)
        : { ok: false, reason: 'Invalid answer.' },
  )
  ipcMain.handle(
    IPC.answerNextStep,
    (event, sessionId: unknown, choice: unknown, holdId: unknown) =>
      event.sender === windows.panel.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      typeof sessionId === 'string' &&
      typeof holdId === 'string' &&
      holds.held(sessionId)?.id === holdId
        ? holds.answerNextStep(sessionId, choice)
        : { ok: false, reason: 'Invalid answer.' },
  )
  ipcMain.handle(
    IPC.answerApproval,
    (event, sessionId: unknown, choice: unknown, holdId: unknown) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        typeof sessionId !== 'string' ||
        typeof holdId !== 'string' ||
        holds.held(sessionId)?.id !== holdId
      )
        return { ok: false, reason: 'Invalid answer.' }
      const result = holds.answerApproval(sessionId, choice)
      // Answered: the session works on, whatever Claude's permission notice said before.
      if (result.ok) hooks.apply({ session_id: sessionId, hook_event_name: 'PreToolUse' })
      return result
    },
  )
  ipcMain.handle(IPC.answerOffer, (event, sessionId: unknown, choice: unknown, holdId: unknown) =>
    event.sender === windows.panel.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    typeof sessionId === 'string' &&
    typeof holdId === 'string' &&
    holds.held(sessionId)?.id === holdId
      ? holds.answerOffer(sessionId, choice)
      : { ok: false, reason: 'Invalid answer.' },
  )
  // Recorded thread changes, independent of HEAD and every other writer in its worktree.
  const changeSession = (sessionId: unknown) =>
    typeof sessionId === 'string'
      ? everySession(sessions.snapshot).find(
          (s) => s.id === sessionId && enabled(sessionProvider(s.id)),
        )
      : null
  ipcMain.handle(IPC.getChanges, async (event, sessionId: unknown) => {
    if (event.sender !== windows.panel.webContents || event.senderFrame !== event.sender.mainFrame)
      return null
    const session = changeSession(sessionId)
    return session ? threadChanges.changes(session) : null
  })
  let controlArtifacts: (
    id: string,
  ) => Promise<import('../shared/artifacts').ThreadArtifact[]> = async () => []
  const inspectTimelineImage = registerArtifacts(
    windows.panel,
    join(app.getPath('userData'), 'thread-artifacts'),
    (id) => !!changeSession(id),
    (id) => {
      const session = changeSession(id)
      if (!session?.cwd) return null
      const provider = sessionProvider(id)
      const transcript =
        provider === 'codex' ? codexTracker.transcriptPath(id) : tracker.transcriptPath(id)
      if (!transcript) return null
      return {
        provider,
        transcript,
        cwd: session.cwd,
        transcriptRoots:
          provider === 'codex'
            ? [codex.sessions, codex.archivedSessions ?? join(codex.home, 'archived_sessions')]
            : [paths.projectsDir],
        roots: [session.cwd, tmpdir(), join(codex.home, 'visualizations')],
      }
    },
    (read) => {
      controlArtifacts = read
    },
  )
  app.once(
    'will-quit',
    registerThreadTimeline(
      windows.panel,
      { claude: paths, codex },
      changeSession,
      (id) =>
        sessionProvider(id) === 'codex'
          ? codexTracker.transcriptPath(id)
          : tracker.transcriptPath(id),
      inspectTimelineImage,
    ),
  )
  // Worktree actions use the scan's exact Git root and the existing HEAD-based viewer.
  const changedWorktreePath = async (sessionId: unknown, path: unknown, revision?: unknown) => {
    const session = changeSession(sessionId)
    let root = localRoot(sessionId)
    if (session && typeof revision === 'string' && typeof path === 'string') {
      root =
        (await threadChanges.roots(session)).find((group) =>
          retainedPath(group.root, revision, path),
        )?.root ?? null
    }
    if (!root || typeof path !== 'string' || !inside(root, path)) return null
    if (typeof revision === 'string')
      return retainedPath(root, revision, path) ? { root, path } : null
    return (await listChanges(root)).some((file) => file.path === path) ? { root, path } : null
  }
  const localRoot = (sessionId: unknown) => {
    const session = changeSession(sessionId)
    return session?.git?.root ?? session?.cwd ?? null
  }
  const changeWorkflow = new ChangeWorkflowService(
    join(app.getPath('userData'), 'change-workflows'),
  )
  ipcMain.handle(
    IPC.changeWorkflow,
    async (event, sessionId: unknown, command: unknown, rootId: unknown) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        return { kind: 'error', reason: 'Change workflows are available only from the panel.' }
      const session = changeSession(sessionId)
      if (!session || typeof sessionId !== 'string')
        return { kind: 'error', reason: 'Thread checkout unavailable.' }
      const found = await Promise.all(
        (await threadChanges.workflowRoots(session)).map((folder) => findGitRepository(folder)),
      )
      const roots = [
        ...new Set(found.flatMap((repository) => (repository ? [repository.root] : []))),
      ].map((root) => ({ root, id: createHash('sha256').update(root).digest('hex') }))
      if (
        command &&
        typeof command === 'object' &&
        'action' in command &&
        command.action === 'roots'
      )
        return { kind: 'roots', roots }
      const selected =
        typeof rootId === 'string'
          ? roots.find((root) => root.id === rootId)
          : roots.length === 1
            ? roots[0]
            : null
      return selected
        ? changeWorkflow.request(sessionId, selected.root, command)
        : { kind: 'error', reason: 'Choose one available checkout before preparing changes.' }
    },
  )
  const selectedRoot = async (sessionId: unknown, rootId?: unknown) => {
    if (rootId === undefined) return localRoot(sessionId)
    const session = changeSession(sessionId)
    return session && typeof rootId === 'string'
      ? ((await threadChanges.roots(session)).find((group) => group.rootId === rootId)?.root ??
          null)
      : null
  }
  const worktreeChanges = async (
    sessionId: unknown,
    lens: unknown = 'git-current',
    rootId?: unknown,
  ) => {
    const session = changeSession(sessionId),
      root = await selectedRoot(sessionId, rootId)
    if (
      !session ||
      !root ||
      !['git-current', 'git-staged', 'git-unstaged', 'folder-baseline'].includes(String(lens))
    )
      return null
    try {
      const result =
        lens === 'folder-baseline'
          ? await localHistory.comparison(root)
          : await captureGit(root, lens as ChangeLens)
      if (!result) return null
      const {
        patches: _patches,
        evidence: _evidence,
        root: _root,
        rootId: _rootId,
        ...view
      } = result
      return view
    } catch {
      return null
    }
  }
  ipcMain.handle(
    IPC.getWorktreeChanges,
    (event, sessionId: unknown, lens: unknown, rootId: unknown) =>
      event.sender === windows.panel.webContents && event.senderFrame === event.sender.mainFrame
        ? worktreeChanges(sessionId, lens, rootId)
        : null,
  )
  ipcMain.handle(
    IPC.getWorktreeFileDiff,
    async (event, sessionId: unknown, path: unknown, revision: unknown) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        return { kind: 'unavailable' }
      const found =
        typeof revision === 'string' ? await changedWorktreePath(sessionId, path, revision) : null
      const root = found?.root ?? localRoot(sessionId)
      if (!root || typeof path !== 'string' || !inside(root, path)) return { kind: 'unavailable' }
      if (typeof revision === 'string')
        return found
          ? retainedPatch(root, revision, path)
          : { kind: 'unavailable', reason: 'This revision is no longer available; refresh.' }
      return readFileDiff(root, path)
    },
  )
  ipcMain.handle(IPC.getLocalTracking, async (event, sessionId: unknown, rootId: unknown) => {
    if (event.sender !== windows.panel.webContents || event.senderFrame !== event.sender.mainFrame)
      return null
    const root = await selectedRoot(sessionId, rootId)
    return root ? localHistory.state(root).catch(() => null) : null
  })
  ipcMain.handle(
    IPC.configureLocalTracking,
    async (event, sessionId: unknown, action: unknown, expected: unknown, rootId: unknown) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        !['enable', 'pause', 'forget', 'baseline'].includes(String(action)) ||
        !Number.isInteger(expected)
      )
        throw Error('Invalid recording settings request')
      const root = await selectedRoot(sessionId, rootId)
      if (!root) throw Error('Folder unavailable')
      const state = await localHistory.configure(root, action as TrackingAction, expected as number)
      if (action === 'forget') {
        forgetComparisons(root)
        threadChanges.forget(root)
      }
      threadChanges.invalidate(root)
      return state
    },
  )
  ipcMain.on(
    IPC.openWorktreeChangedFile,
    (event, sessionId: unknown, path: unknown, revision: unknown) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        return
      void changedWorktreePath(sessionId, path, revision)
        .then(async (found) => {
          if (found) {
            const target = await realpath(join(found.root, found.path))
            if (within(await realpath(found.root), target)) await shell.openPath(target)
          }
        })
        .catch(() => {})
    },
  )
  // A plan step's activity, read from the thread's own transcript, which Threadlight's scan found.
  ipcMain.handle(IPC.getStepActivity, (_event, sessionId: unknown, step: unknown) => {
    if (typeof sessionId !== 'string' || typeof step !== 'string') return null
    const path = tracker.transcriptPath(sessionId)
    return path ? readStepActivity(path, step) : null
  })
  ipcMain.handle(
    IPC.getFileDiff,
    async (event, sessionId: unknown, path: unknown, revision: unknown) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        return { kind: 'unavailable' }
      const session = changeSession(sessionId)
      return session && typeof path === 'string'
        ? threadChanges.file(session, path, typeof revision === 'string' ? revision : undefined)
        : { kind: 'unavailable' }
    },
  )
  ipcMain.on(IPC.openChangedFile, (event, sessionId: unknown, path: unknown, revision: unknown) => {
    if (event.sender !== windows.panel.webContents || event.senderFrame !== event.sender.mainFrame)
      return
    const session = changeSession(sessionId)
    if (session && typeof path === 'string')
      void threadChanges
        .absolute(session, path, typeof revision === 'string' ? revision : undefined)
        .then(async (found) => {
          if (found) {
            const target = await realpath(found),
              root = await threadChanges.sourceRoot(
                session,
                path,
                typeof revision === 'string' ? revision : undefined,
              )
            if (root && within(await realpath(root), target)) await shell.openPath(target)
          }
        })
        .catch(() => {})
  })
  ipcMain.handle(IPC.copyText, (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > 20_000) return false
    clipboard.writeText(text)
    return true
  })
  ipcMain.on(IPC.releaseHold, (_event, sessionId: unknown) => {
    if (typeof sessionId === 'string') {
      if (sessionId.startsWith('codex:')) codexHolds.release(sessionId)
      else holds.release(sessionId)
    }
  })
  ipcMain.handle(IPC.answerCodex, (event, id: unknown, holdId: unknown, answer: unknown) =>
    event.sender === windows.panel.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    typeof id === 'string' &&
    codexSessions.find(id)
      ? codexHolds.answer(id, holdId, answer)
      : { ok: false, reason: 'That Codex card is no longer listed.' },
  )
  const nativeCodexQuestions = new NativeCodexQuestions(
    codex.history,
    join(app.getPath('userData'), 'codex-native-answers'),
    undefined,
    (id, turn) => questionObserver.state(id, turn),
    (id, turn, ids) => questionObserver.confirm(id, turn, ids),
  )
  ipcMain.handle(
    IPC.answerNativeCodexQuestion,
    async (event, id: unknown, reference: unknown, answers: unknown) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        typeof id !== 'string' ||
        !codexSessions.find(id)
      )
        return { ok: false, reason: 'That Codex card is no longer listed.', retryable: false }
      const result = await nativeCodexQuestions.answer(id, reference, answers)
      void codexSessions.refresh()
      return result
    },
  )

  // The UI passes only a session id and text; folder, permission mode and model come from
  // Threadlight's own scan, so a misbehaving page cannot choose them.
  let cli: CliCommand | null = null
  let memoryReceipt: ((status: RelayStatus) => void) | undefined
  const relays = new RelayService(
    async () => ({
      cli: (cli ??= await findClaudeCli(paths)),
      isHeld: (id) => isHeld(paths.liveSessionsDir, id),
    }),
    (id) => sessions.find(id),
    () => publishRelays(),
  )
  const codexRelays = new CodexRelayService(
    codex,
    (id) => codexSessions.find(id) ?? communicationCatalog.cached(id),
    () => publishRelays(),
  )
  function publishRelays() {
    const statuses = [...relays.list(), ...codexRelays.list()]
    for (const status of statuses) if (status.attemptId) memoryReceipt?.(status)
    windows.send(IPC.relaysChanged, allRelays())
  }
  const composerAttachments = new ComposerAttachmentStore(
    join(app.getPath('userData'), 'composer-attachments'),
  )
  registerComposerAttachments(
    windows.panel,
    composerAttachments,
    (id) => enabled('codex') && !!codexSessions.find(id),
  )
  const nativeCodexMessages = new NativeCodexMessages(
    codex.history,
    join(app.getPath('userData'), 'codex-native-messages'),
    () => publishRelays(),
  )
  const codexQueue = new CodexQueue(
    async () => {
      const cli = await findCodexCli(codex)
      if (!cli) throw Error('Codex queue is unavailable.')
      const client = new CodexClient(cli, app.getPath('userData'))
      try {
        await client.initialize()
        return client
      } catch (error) {
        client.close()
        throw error
      }
    },
    join(app.getPath('userData'), 'codex-queue-receipts'),
    codex.history,
  )
  ipcMain.handle(IPC.codexQueue, async (event, key: unknown, command: unknown) => {
    if (
      event.sender !== windows.panel.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof key !== 'string' ||
      !enabled('codex') ||
      !codexSessions.find(key) ||
      !isObject(command) ||
      !['list', 'edit', 'remove', 'steer'].includes(String(command.action)) ||
      (command.action !== 'list' && typeof command.id !== 'string') ||
      (command.action === 'edit' && typeof command.text !== 'string')
    )
      return { ok: false, reason: 'Invalid queue request.' }
    return codexQueue.command(key, command as QueueCommand)
  })
  const newChatPaths = newThreadPaths(app.getPath('userData'), app.getPath('documents'))
  const newChats = new NewCodexThreads(newChatPaths.receipts, newChatPaths.workspaces, {
    bootstrap: async (cwd) => {
      const cli = await findCodexCli(codex)
      if (!cli) throw Error('Codex is unavailable')
      return new CodexClient(cli, cwd)
    },
    handoff: (id) => handoffNewCodexThread(id, (url) => shell.openExternal(url)),
  })
  ipcMain.handle(IPC.newThread, async (event, input: NewThreadRequest) => {
    if (event.sender !== windows.panel.webContents || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, reason: 'Invalid new-thread caller.' }
    if (!enabled('codex') || input?.provider !== 'codex')
      return { ok: false, reason: 'New chats are currently available for enabled Codex only.' }
    const result = await newChats.create(input)
    if (result.ok || result.sessionId) await codexSessions.refresh()
    // Preserve the selected page while bringing Threadlight back after the desktop handoff.
    windows.openPanel({ focus: true, fresh: false })
    return result
  })
  function allRelays() {
    const native = nativeCodexMessages.list()
    return [
      ...relays.list(),
      ...codexRelays.list().filter((r) => !native.some((n) => n.sessionId === r.sessionId)),
      ...native,
    ]
  }
  const nativeMessageTimer = setInterval(() => nativeCodexMessages.refresh(), 1000)
  nativeMessageTimer.unref()
  app.once('will-quit', () => clearInterval(nativeMessageTimer))
  ipcMain.handle(
    IPC.sendMessage,
    async (
      event,
      sessionId: unknown,
      text: unknown,
      attachmentIds: unknown = [],
      mode: unknown = 'auto',
    ) => {
      if (
        event.sender !== windows.panel.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        typeof sessionId !== 'string' ||
        typeof text !== 'string' ||
        !Array.isArray(attachmentIds) ||
        !attachmentIds.every((id) => typeof id === 'string') ||
        (mode !== 'auto' && mode !== 'queue' && mode !== 'steer')
      )
        return { ok: false, reason: 'Invalid message caller.' }
      if (!sessionId.startsWith('codex:'))
        return attachmentIds.length
          ? { ok: false, reason: 'Attachments are currently supported for Codex chats.' }
          : stopMemory.send(sessionId, text)
      if (!enabled('codex') || !codexSessions.find(sessionId))
        return { ok: false, reason: 'That Codex chat is unavailable. Your draft is retained.' }
      try {
        const files = await composerAttachments.resolve(sessionId, attachmentIds)
        const result =
          mode === 'steer'
            ? await nativeCodexMessages.send(sessionId, text, files)
            : await codexQueue.add(
                sessionId,
                text,
                files,
                mode === 'auto'
                  ? () => nativeCodexMessages.send(sessionId, text, files, 'send')
                  : undefined,
              )
        if (result.ok && files.length) {
          // A cleanup failure must never turn an acknowledged send into a retryable failure.
          await composerAttachments
            .remove(sessionId, attachmentIds)
            .catch((error) => console.warn('Accepted attachment draft cleanup failed', error))
        }
        return result
      } catch (error) {
        return {
          ok: false,
          reason:
            error instanceof Error
              ? error.message
              : 'Attachments could not be prepared. Your draft is retained.',
        }
      }
    },
  )
  ipcMain.handle(IPC.getRelays, () => allRelays())

  const memoryRuntime: { current?: import('./communication/claudeRuntime').ClaudeRuntimeInbox } = {}
  const communicationCatalog = new CommunicationCatalog(
    [new ClaudeReadAdapter(paths), new CodexReadAdapter(codex)],
    () => settings.settings.enabledProviders,
    (id) => sessions.find(id),
    async (id) =>
      id.startsWith('codex:') && (await codexCommunicationAdmitted(await findCodexCli(codex))),
    async (id) => !id.startsWith('codex:') || (await codexHeld(codex.locks, id.slice(6))),
    (id) => memoryRuntime.current?.destination(id) ?? Promise.resolve(undefined),
  )
  const communicationOwners: AgentService[] = []
  const accountChatTransport = new AccountChatTransport(accountChats)
  app.once('will-quit', () => accountChatTransport.close())
  const ownedCommunicationRequests = new OwnedRequests(() => communicationOwners)
  const stopMemory = await startMemory(app.getPath('userData'), windows.panel, {
    questionsChanged: (questions) => {
      managedQuestions = questions
      publish()
    },
    conversationOwner: () => communicationOwners[0]?.current.conversationId ?? undefined,
    destinations: async (target, query) => {
      if (target)
        return accountChatTarget(target)
          ? accountChatTransport.find(target, query)
          : communicationCatalog.find(target, query)
      if (['perplexity', 'chatgpt'].includes(query?.trim().toLowerCase() ?? ''))
        return accountChatTransport.find(undefined, query)
      const [work, chats] = await Promise.all([
        communicationCatalog.find(undefined, query),
        accountChatTransport.find(undefined, query),
      ])
      return [...work, ...chats]
    },
    accountChatDelivery: (message, destination, accepted) =>
      accountChatTransport.deliver(message, destination, accepted),
    nativeRequests: () => [
      ...holds.communicationRequests(),
      ...codexHolds.communicationRequests(),
      ...ownedCommunicationRequests.list(),
    ],
    respondNative: (id, generation, response) =>
      holds.communicationRequests().some((r) => r.id === id)
        ? holds.respondCommunication(id, generation, response)
        : codexHolds.communicationRequests().some((r) => r.id === id)
          ? codexHolds.respondCommunication(id, generation, response)
          : ownedCommunicationRequests.respond(id, generation, response),
    find: (id) => sessions.find(id),
    statuses: () => [...relays.list(), ...codexRelays.list()],
    watch: (listener) => {
      memoryReceipt = listener
      return () => {
        if (memoryReceipt === listener) memoryReceipt = undefined
      }
    },
    send: (id, text, context, receiptId) =>
      !enabled(sessionProvider(id))
        ? { ok: false, reason: 'Enable the destination provider in Settings.' }
        : id.startsWith('codex:')
          ? codexRelays.send(id, text, context, receiptId)
          : relays.send(id, text, context, receiptId),
  })
  new SharedBrowserService(
    windows.panel,
    join(app.getPath('userData'), 'browsers.json'),
    (id) => !!changeSession(id),
    () => stopMemory.server()?.connections.list() ?? [],
    windows.videoSizing,
  )
  memoryRuntime.current = stopMemory.server()?.runtime
  try {
    stopMemory.communication()?.importLegacy(messageStore.list())
  } catch {
    stopMemory.communication()?.blockRecovery()
  }
  app.once('will-quit', stopMemory)
  const draftCaller = (event: Electron.IpcMainInvokeEvent, id: unknown): id is string =>
    event.sender === windows.panel.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    typeof id === 'string' &&
    /^(codex:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ipcMain.handle(IPC.getComposerDraft, (event, id: unknown) => {
    if (!draftCaller(event, id)) return { ok: false, reason: 'Invalid draft request.' }
    try {
      return { ok: true, draft: messageStore.draft(draftKey(id)) }
    } catch {
      return {
        ok: false,
        reason: 'Draft storage is unavailable. Existing drafts have been retained.',
      }
    }
  })
  ipcMain.handle(
    IPC.saveComposerDraft,
    async (event, id: unknown, text: unknown, revision: unknown) => {
      if (
        !draftCaller(event, id) ||
        typeof text !== 'string' ||
        text.length > MESSAGE_LIMIT ||
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 0
      )
        return { ok: false, reason: 'Invalid draft request.' }
      try {
        return { ok: true, draft: await messageStore.saveDraft(draftKey(id), text, revision) }
      } catch {
        return {
          ok: false,
          reason: 'Could not save this draft. Keep a copy before closing Threadlight.',
        }
      }
    },
  )

  const threadReads = new ThreadReadServer(
    new ThreadReadService(
      [
        new ClaudeReadAdapter(paths, (id) => {
          const record = hooks.get(id)
          const held = holds.held(id)
          if (held && held.releasesAt > Date.now())
            return {
              status: { state: 'waiting', basis: 'hook', at: held.startedAt, turnId: null },
              attention: attentionEvidence(
                {
                  kind: 'approval',
                  tool: held.tool,
                  action: held.detail ?? `${held.kind} awaits input in Claude`,
                  answerableUntil: held.releasesAt,
                },
                held.startedAt,
                'claude_hook',
              ),
            }
          return record
            ? { status: { state: record.state, basis: 'hook', at: record.updatedAt, turnId: null } }
            : null
        }),
        new CodexReadAdapter(codex, (id) => {
          const record = codexHolds.records.get(`codex:${id}`)
          return record
            ? {
                status: { state: record.state, basis: 'hook', at: record.at, turnId: null },
                attention: attentionEvidence(record.attention, record.at, 'codex_hook'),
              }
            : null
        }),
      ],
      () => settings.settings.enabledProviders,
      (provider, id) => agentSessionIds.has(provider === 'codex' ? `codex:${id}` : id),
    ),
  )
  await threadReads.start()
  app.once('will-quit', () => threadReads.close())
  let controlCaptureBusy = false
  let spaces: SpacesService | null = null
  function spaceChatAccess() {
    const memory = stopMemory.store(),
      communication = stopMemory.communication()
    if (!memory || !communication) return
    return {
      project: (id: string) => ({
        ...memory.space(id),
        root: memory.executionContext(id)?.root ?? '',
      }),
      workflow: (id: string) => communication.workflow(id),
      enabled: (provider: SpaceChatInput['provider']) =>
        provider === 'perplexity' ? accountChats.enabled('perplexity') : enabled(provider),
      reserve: (id: string) => memory.reserveCommunication(id, () => {}),
      save: (workflow: Parameters<typeof communication.configure>[0], revision: number) => {
        communication.configure(workflow, revision, { id: 'human', kind: 'human' })
      },
    }
  }
  const control: AppControlService = new AppControlService(
    {
      coachSkillFile: join(app.getAppPath(), 'skills', 'threadlight-coach', 'SKILL.md'),
      pins,
      availability: (name) =>
        name === 'threadlight_editor_coach'
          ? editorCoach.availability()
          : name === 'threadlight_create_space' || name === 'threadlight_list_spaces'
            ? {
                available: !!spaces,
                reason: spaces ? undefined : 'Shared Spaces service unavailable.',
              }
            : { available: true },
      settings: () => settings.settings,
      hasChat: (id) => !!changeSession(id),
      chatInfo: (id) => {
        const session = changeSession(id)
        return session
          ? { id: session.id, title: session.title.slice(0, 200), provider: sessionProvider(id) }
          : null
      },
      updateSettings: (patch, revision) => updateApplicationSettings(patch, revision),
      workspaces: () => controlWorkspaces(sessions.snapshot.allWorkspaces),
      spaces: () => {
        const snapshot = spaces?.snapshot()
        return (stopMemory.store()?.snapshot().spaces ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          workspaceId: snapshot?.workspaces.find((w) => w.id === snapshot.spaceOwners[s.id])?.root
            ? workspaceFolder(
                snapshot.workspaces.find((w) => w.id === snapshot.spaceOwners[s.id])!.root,
              )
            : null,
        }))
      },
      artifacts: (id) => controlArtifacts(id),
      changes: async (id, scope, lens, rootId) => {
        const session = changeSession(id)
        if (!session) return null
        const result =
          scope === 'thread'
            ? await threadChanges.changes(session)
            : await worktreeChanges(id, lens, rootId)
        return result
          ? {
              ...result,
              complete: result.complete !== false && result.files.length <= 100,
              files: result.files.slice(0, 100),
            }
          : null
      },
      createSpace: async (title, root, id) => {
        const result = await spaces?.request({ action: 'create_space', title, root, id })
        return result?.ok ? { ok: true, spaceId: result.spaceId } : { ok: false }
      },
      spaceChatIssue: (spaceId, provider) => {
        const access = spaceChatAccess()
        return access
          ? spaceChatContext({ spaceId, provider }, access).reason
          : 'Shared Space communication unavailable.'
      },
      startSpaceChat: async (input, actionId) => {
        const access = spaceChatAccess()
        if (!access)
          return { outcome: 'unavailable', reason: 'Shared Space communication unavailable.' }
        return startSpaceChat(input, actionId, {
          ...access,
          start: (request, root, id, beforeSend, checkCurrent) =>
            openSpaceProvider(
              request,
              root,
              id,
              beforeSend,
              {
                claude: async () => (cli ??= await findClaudeCli(paths)),
                paths,
                chats: accountChats,
                codex: async (cwd, operationId, model, beforeCreate) => {
                  const result = await newChats.create(
                    { provider: 'codex', cwd, operationId, model },
                    beforeCreate,
                  )
                  if (result.sessionId) await codexSessions.refresh().catch(() => {})
                  return result
                },
                sendCodex: (target, text, model) =>
                  nativeCodexMessages.send(target, text, [], 'send', model),
              },
              checkCurrent,
            ),
        })
      },
      createChat: async (cwd, operationId, model) => {
        const result = await newChats.create({ provider: 'codex', cwd, operationId, model })
        if (result.ok || result.sessionId) await codexSessions.refresh()
        return result
      },
      busy: () => ({
        agent: ['starting', 'working', 'waiting'].includes(agent.current.status),
        otherWork:
          controlCaptureBusy ||
          observerActive(app.getAppPath()) ||
          (!!spaces &&
            (['starting', 'working', 'waiting', 'stopping'].includes(spaces.agent.current.status) ||
              !!spaces.agent.current.live)) ||
          allRelays().some((r) => ['sending', 'sent'].includes(r.state)),
      }),
      send: (command) => {
        windows.openPanel({ focus: true, fresh: false })
        windows.panel.webContents.send('control:command', command)
      },
      restart,
    },
    join(app.getPath('userData'), 'agent-control-operations.json'),
  )
  const appControl: AppControlServer = new AppControlServer(control)
  await appControl.start()
  registerAppControl(windows.panel, control)
  app.once('will-quit', () => appControl.close())
  const editorCoach = new EditorCoach(
    () => agent.activeLiveSession,
    (id, text, first, proposal) => agent.speakCoachStep(id, text, first, proposal),
    undefined,
    (id, event) => agent.coachEvent(id, event),
    (id) => agent.interruptProposal(id),
    (id, text, signal) => agent.speakWalkthrough(id, text, signal),
  )
  app.once('will-quit', () => editorCoach.close())
  const announcements: NonNullable<ConstructorParameters<typeof AgentService>[0]['announcements']> =
    {
      next: (owner, since, questionsOnly) => {
        stopMemory.conversationFeed(owner)
        return stopMemory.conversations()?.reserve(owner, since, questionsOnly)
      },
      commit: (a) => {
        stopMemory.conversationFeed(a.owner)
        return stopMemory.conversations()?.commit(a) ?? false
      },
      settle: (owner, id, state) => stopMemory.conversations()?.settle(owner, id, state),
    }
  const agent: AgentService = new AgentService({
    editorCoach: (id, command) => editorCoach.run(id, command),
    foregroundWindow: (id, inspect) => liveScreen.observe(id, inspect),
    appControl,
    announcements,
    communication: (actor) => {
      const server = stopMemory.server()
      if (!server) throw new Error('Communication unavailable.')
      return server.connectCommunication(actor)
    },
    threadReads,
    workspace: agentWorkspace,
    index: agentFiles.index,
    claudeProjects: paths.projectsDir,
    settings: () => settings.settings,
    snapshot: () => sessions.snapshot,
    cli: async (provider) =>
      provider === 'codex' ? findCodexCli(codex) : (cli ??= await findClaudeCli(paths)),
    onChange: (state) => {
      editorCoach.sync()
      syncScreenHelp()
      recentAgent.observe(state)
      windows.setAgentAttention(recentAgent.current?.waiting ? recentAgent.current.provider : null)
      if (state.sessionId)
        agentSessionIds.add(
          state.provider === 'codex' ? `codex:${state.sessionId}` : state.sessionId,
        )
      windows.panel.webContents.send(IPC.agentChanged, { ...state, recent: recentAgent.current })
      windows.panel.webContents.send(IPC.communicationChanged)
    },
    onConversation: (state, spaceId) => {
      if (state.conversationId)
        stopMemory
          .conversations()
          ?.register(
            state.conversationId,
            state.sessionId
              ? state.provider === 'codex'
                ? `codex:${state.sessionId}`
                : state.sessionId
              : undefined,
            spaceId,
            state.items.at(-1)?.id ?? `line:${state.items.length - 1}`,
          )
    },
    onRateLimit: (info) => usage.note(info),
    onLive: (event) => windows.panel.webContents.send(IPC.agentLiveEvent, event),
  })
  let regionToast: Notification | undefined
  function notifyRegion(message: string) {
    if (windows.panel.isDestroyed()) return
    windows.panel.webContents.send(IPC.screenHelpNotice, { message, open: false })
    if (!Notification.isSupported()) return
    regionToast?.close()
    const toast = new Notification({ title: 'Threadlight', body: message, silent: true })
    regionToast = toast
    toast.once('click', () => {
      if (!windows.panel.isDestroyed()) {
        windows.openPanel({ focus: true, fresh: false })
        windows.panel.webContents.send(IPC.screenHelpNotice, { message, open: true })
      }
    })
    toast.show()
  }
  const regionSpeech = new ScreenReplySpeech(
    join(app.getAppPath(), 'resources', 'screen-reply.ps1'),
    notifyRegion,
    () => settings.settings.agentVoicePace,
  )
  const screenVoice = new ScreenReplyVoice(
    () => agent.connectCodex(),
    (event) => {
      if (!windows.panel.isDestroyed()) windows.panel.webContents.send(IPC.screenVoiceEvent, event)
    },
    notifyRegion,
    () => settings.settings.agentVoicePace,
  )
  const outsideHelp = new ScreenRegionHelp({
    available: () => agent.canStartRegion && !spaces?.agent.current.live,
    start: (region) => agent.startRegion(region),
    state: () => agent.current,
    notify: notifyRegion,
    speak: (text) => (agent.current.provider === 'codex' ? screenVoice : regionSpeech).speak(text),
  })
  function syncScreenHelp() {
    const liveId = agent.activeLiveSession ?? spaces?.agent.activeLiveSession ?? null
    const live = !!(agent.current.live || spaces?.agent.current.live)
    const modes = settings.settings.screenRegionModes
    liveScreen.sync(liveId, live && !liveId ? [] : modes)
    if (live || !modes.includes('outside') || !settings.settings.speakScreenReply) {
      screenVoice.stop()
      regionSpeech.stop()
    }
    outsideHelp.configure(modes.includes('outside'), settings.settings.speakScreenReply && !live)
  }
  syncScreenHelp()
  communicationOwners.push(agent)
  await agent.store
    .load()
    .catch(() =>
      console.error('Agent history metadata is unavailable; monitoring remains available.'),
    )
  for (const record of agent.store.all()) {
    stopMemory
      .conversations()
      ?.register(
        record.id,
        record.provider === 'codex' ? `codex:${record.providerId}` : record.providerId,
      )
    agentSessionIds.add(
      record.provider === 'codex' ? `codex:${record.providerId}` : record.providerId,
    )
  }
  void recentAgent
    .restore(agent.store.all(), (id) => agent.read(id))
    .then(() => {
      windows.setAgentAttention(recentAgent.current?.waiting ? recentAgent.current.provider : null)
      if (!windows.panel.isDestroyed())
        windows.panel.webContents.send(IPC.agentChanged, {
          ...agent.current,
          recent: recentAgent.current,
        })
    })
    .catch(() => {})
  // Complete previously requested cleanup before allowing a history continuation to race it.
  await agent.retryArchives().catch(() => {})
  let spacesIssue = ''
  try {
    const files = spacesPaths(app.getPath('userData'))
    spaces = new SpacesService(
      new SpacesStore(files.store),
      stopMemory.store,
      () => sessions.snapshot.lookupSessions ?? sessions.snapshot.sessions,
      {
        threadReads,
        announcements: {
          ...announcements,
          next: (owner, since) => announcements.next(owner, since, true),
        },
        communication: (actor) => {
          const server = stopMemory.server()
          if (!server) throw new Error('Communication unavailable.')
          return server.connectCommunication(actor)
        },
        workspace: files.workspace,
        index: files.index,
        claudeProjects: paths.projectsDir,
        settings: () => settings.settings,
        snapshot: () => ({
          sessions: [],
          workspaces: [],
          allWorkspaces: [],
          currentWorkspace: null,
          currentThreadId: null,
        }),
        cli: async (provider) =>
          provider === 'codex' ? findCodexCli(codex) : (cli ??= await findClaudeCli(paths)),
        onLive: (event) => windows.panel.webContents.send(IPC.agentLiveEvent, event),
        onChange: (state) => {
          syncScreenHelp()
          windows.panel.webContents.send(IPC.communicationChanged)
          if (state.sessionId)
            agentSessionIds.add(
              state.provider === 'codex' ? `codex:${state.sessionId}` : state.sessionId,
            )
        },
        onConversation: (state, spaceId) => {
          if (state.conversationId)
            stopMemory
              .conversations()
              ?.register(
                state.conversationId,
                state.sessionId
                  ? state.provider === 'codex'
                    ? `codex:${state.sessionId}`
                    : state.sessionId
                  : undefined,
                spaceId,
                state.items.at(-1)?.id ?? `line:${state.items.length - 1}`,
              )
        },
        onRateLimit: (info) => usage.note(info),
      },
      (snapshot) => {
        if (!windows.panel.isDestroyed())
          windows.panel.webContents.send(IPC.spacesChanged, snapshot)
      },
      () => sessions.snapshot.allWorkspaces.map((w) => w.id.replace(/^(claude|codex):/, '')),
    )
    communicationOwners.push(spaces.agent)
    await spaces.start()
    app.once('will-quit', () => spaces?.contextServer.close())
    await spaces.agent.store.load()
    for (const record of spaces.agent.store.all())
      agentSessionIds.add(
        record.provider === 'codex' ? `codex:${record.providerId}` : record.providerId,
      )
  } catch (error) {
    spacesIssue = error instanceof Error ? error.message : 'Shared Spaces could not load.'
  }
  registerSpaces(windows.panel, spacesIssue ? null : spaces, spacesIssue, () => settings.settings)
  const trustedAgentInput = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === windows.panel.webContents && event.senderFrame === event.sender.mainFrame
  ipcMain.handle(IPC.agentGet, () => ({ ...agent.current, recent: recentAgent.current }))
  let shortcutSession: { id: string; expires: number } | undefined
  ipcMain.handle(IPC.agentAnnouncement, (event, id: unknown, command: unknown) => {
    if (event.sender !== windows.panel.webContents || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, reason: 'Not the active panel.' }
    const c = command as { action?: string; id?: string; outcome?: string }
    if (
      !c ||
      !['next', 'speak', 'settle'].includes(c.action ?? '') ||
      (c.action !== 'next' && (typeof c.id !== 'string' || c.id.length > 80)) ||
      (c.action === 'settle' &&
        !['announced', 'uncertain', 'suppressed', 'deferred'].includes(c.outcome ?? ''))
    )
      return { ok: false, reason: 'Invalid announcement command.' }
    const voiceOwner = spaces && id === spaces.agent.activeLiveSession ? spaces.agent : agent
    return voiceOwner.announcementCommand(
      id,
      command as import('./../shared/conversationEvents').AnnouncementCommand,
    )
  })
  ipcMain.handle(IPC.screenVoiceCommand, (event, id: unknown, action: unknown, sdp: unknown) =>
    trustedAgentInput(event)
      ? screenVoice.command(id, action, sdp)
      : { ok: false, reason: 'Invalid playback source.' },
  )
  ipcMain.handle(IPC.agentLiveStart, (event, id: unknown, sdp: unknown) => {
    if (!trustedAgentInput(event))
      return { ok: false, reason: 'Live is only available in the panel.' }
    const viaShortcut =
      shortcutSession && id === shortcutSession.id && Date.now() < shortcutSession.expires
    if (id === shortcutSession?.id) shortcutSession = undefined
    return settings.settings.voiceMode === 'gpt-live' ||
      (viaShortcut && isGptLiveShortcut(settings.settings))
      ? agent.startLive(id, sdp)
      : { ok: false, reason: 'Press the GPT Live shortcut or select GPT Live in Settings.' }
  })
  ipcMain.handle(IPC.agentLiveOpen, (event, id: unknown, text: unknown) =>
    trustedAgentInput(event)
      ? agent.openLive(id, text)
      : { ok: false, reason: 'Live is only available in the panel.' },
  )
  ipcMain.handle(IPC.liveRemainder, (event, id, token) => {
    if (
      !trustedAgentInput(event) ||
      typeof id !== 'string' ||
      typeof token !== 'string' ||
      token.length > 80
    )
      return { ok: false, reason: 'Invalid readout.' }
    return (
      agent.readRemaining(id, token) ??
      spaces?.agent.readRemaining(id, token) ?? {
        ok: false,
        reason: 'This Live session has ended.',
      }
    )
  })
  setLiveTimingFile(join(app.getPath('userData'), 'live-timing.jsonl'))
  ipcMain.on(IPC.liveTiming, (event, mark) => {
    if (trustedAgentInput(event)) recordLiveTiming(mark)
  })
  ipcMain.on(IPC.livePlaybackBoundary, (event, id, kind, turn, transcript) => {
    if (
      !trustedAgentInput(event) ||
      typeof id !== 'string' ||
      typeof turn !== 'string' ||
      turn.length > 256 ||
      !['assistant', 'done', 'user', 'skip'].includes(kind)
    )
      return
    const words =
      kind === 'done' && typeof transcript === 'string' && transcript.length <= 32000
        ? transcript
        : undefined
    agent.playbackBoundary(id, kind, turn, words)
    spaces?.agent.playbackBoundary(id, kind, turn, words)
  })
  ipcMain.on(IPC.agentLiveStop, (event, id: unknown) => {
    if (trustedAgentInput(event) && typeof id === 'string') void agent.stopLive(id)
  })
  windows.panel.webContents.on('render-process-gone', () => {
    screenVoice.stop()
    void agent.stopLive()
  })
  windows.panel.webContents.on('did-start-loading', () => {
    shortcutSession = undefined
    screenVoice.stop()
    void agent.stopLive()
  })
  ipcMain.handle(IPC.agentSend, (event, text: unknown) =>
    trustedAgentInput(event)
      ? agent.send(text)
      : { ok: false, reason: 'Invalid Agent input source.' },
  )
  ipcMain.handle(IPC.agentRespond, (event, id: unknown, response: unknown) =>
    trustedAgentInput(event)
      ? agent.respond(id, response)
      : { ok: false, reason: 'Invalid response source.' },
  )
  ipcMain.handle(IPC.agentInterrupt, () => agent.interrupt())
  ipcMain.handle(IPC.agentModels, () =>
    agent.models().catch((error: Error) => ({ models: [], error: error.message })),
  )
  ipcMain.on(IPC.agentDecide, (event, id: unknown, allow: unknown) => {
    if (trustedAgentInput(event) && typeof id === 'string') agent.decide(id, allow === true)
  })
  ipcMain.on(IPC.agentClose, () => agent.close())
  ipcMain.handle(IPC.finishCallChat, (event, id, choice) =>
    trustedAgentInput(event)
      ? agent.finishCallChat(id, choice)
      : { ok: false, reason: 'Unavailable outside the panel.' },
  )
  ipcMain.handle(IPC.agentHistory, () => agent.history())
  ipcMain.handle(IPC.agentReadPast, async (_event, id: unknown) => (await agent.read(id)).items)
  ipcMain.handle(IPC.agentReadPage, (_event, id: unknown, cursor: unknown) =>
    agent.read(id, cursor ?? null),
  )
  ipcMain.handle(IPC.agentResume, (_event, id: unknown) => agent.resume(id))
  ipcMain.handle(IPC.agentApps, (_event, provider: unknown) =>
    agent
      .apps(provider === 'codex' ? 'codex' : 'claude')
      .catch((error: Error) => [{ name: 'Connection', status: error.message, unavailable: true }]),
  )

  // The plan's usage limits, for the bar along the panel's foot: from the agent's runs, or a
  // tiny check of its own when the panel asks and the last reading is old (usage.ts).
  const usage = new UsageWatcher({
    cli: async () => (cli ??= await findClaudeCli(paths)),
    cwd: agentWorkspace,
    onChange: (reading) => windows.panel.webContents.send(IPC.usageChanged, reading),
  })
  ipcMain.handle(IPC.usageGet, async () => {
    if (!enabled('claude')) return null
    await mkdir(agentWorkspace, { recursive: true })
    void usage.refresh()
    return usage.current
  })

  // Voice: the model loads in the background if it is already downloaded; it is only ever
  // downloaded after the user agrees in the composer.
  const stt = new SttService(join(app.getPath('userData'), 'models'), (status) =>
    windows.send(IPC.sttChanged, status),
  )
  stt.start()
  ipcMain.handle(IPC.getStt, () => stt.status)
  ipcMain.on(IPC.sttDownload, () => stt.download())
  ipcMain.handle(IPC.transcribe, (_event, audio: unknown) =>
    audio instanceof Float32Array ? stt.transcribe(audio) : Promise.reject(new Error('No audio.')),
  )
  allowMicrophoneOnly(windows)

  // The talk hotkey drives recording in the (possibly hidden) panel, which does the rest:
  // toggle sends one event per press; press-and-hold sends "down" and, on release, "up".
  const modifierStepper = new ModifierStepper((stage) => windows.setModifierStage(stage))
  let voiceTraceSequence = 0
  const traceVoice = (stage: string, destination: string) => {
    // Local event names only: no audio, transcript, chat or project contents.
    void appendFile(
      join(app.getPath('userData'), 'voice-shortcut.log'),
      JSON.stringify({
        at: new Date().toISOString(),
        sequence: ++voiceTraceSequence,
        stage,
        destination,
      }) + '\n',
    ).catch(() => {})
  }
  ipcMain.on(IPC.voiceShortcutTrace, (event, stage: unknown, destination: unknown) => {
    if (
      trustedAgentInput(event) &&
      ['agent', 'brainstorm'].includes(String(destination)) &&
      [
        'request',
        'microphone-requested',
        'listening',
        'blocked',
        'no-project',
        'needs-stt',
      ].includes(String(stage))
    )
      traceVoice(String(stage), String(destination))
  })
  const toggleAgentVoice = (destination?: 'brainstorm') => {
    traceVoice('hotkey', destination ?? 'agent')
    modifierStepper.yieldToTalk()
    shortcutSession =
      !destination && isGptLiveShortcut(settings.settings)
        ? { id: randomUUID(), expires: Date.now() + 30_000 }
        : undefined
    windows.panel.webContents.send(
      IPC.talkToggle,
      shortcutSession ? { liveSessionId: shortcutSession.id } : destination,
    )
  }
  ipcMain.on(IPC.startAgentVoice, (event) => {
    if (trustedAgentInput(event)) toggleAgentVoice()
  })
  const hotkey = new TalkHotkey({
    toggle: () => toggleAgentVoice(),
    hold: (phase) => {
      if (phase === 'down') modifierStepper.yieldToTalk()
      windows.panel.webContents.send(IPC.talkHold, phase)
    },
  })
  modifierStepper.start()
  const brainstormHotkey = new TalkHotkey({
    toggle: () => toggleAgentVoice('brainstorm'),
    hold: () => {},
  })
  let brainstormHotkeyProblem = brainstormHotkey.set(BRAINSTORM_HOTKEY)
  const reservedBrainstormHotkey = (key: string) => sameAccelerator(key, BRAINSTORM_HOTKEY)
  let hotkeyProblem = reservedBrainstormHotkey(initial.talkHotkey)
    ? 'Ctrl+Alt+B is reserved for Brainstorm voice. Choose a different talk hotkey in Settings.'
    : (hotkey.set(initial.talkHotkey) ?? hotkey.setMode(voiceHotkeyMode(initial)))
  let trayPaused = false
  let liveCall = false,
    capturingShortcut = false,
    muteProblem: string | null = null
  const muteBinding = new LiveMuteShortcut(() => {
    modifierStepper.yieldToTalk()
    windows.panel.webContents.send(IPC.liveMuteShortcut)
  }, windowsMuteKeys(windows.panel))
  const syncMuteShortcut = () => {
    muteProblem = muteBinding.update(
      liveCall,
      liveCall && (trayPaused || capturingShortcut),
      settings.settings.talkHotkey,
    )
  }
  const currentHotkeyProblem = () =>
    [hotkeyProblem, brainstormHotkeyProblem, muteProblem].filter(Boolean).join(' ') || null
  ipcMain.handle(IPC.getHotkeyProblem, currentHotkeyProblem)
  const reportHotkey = () => {
    if (!windows.panel.isDestroyed() && !windows.panel.webContents.isDestroyed())
      windows.panel.webContents.send(IPC.hotkeyProblem, currentHotkeyProblem())
  }
  ipcMain.on(IPC.liveCallControls, (event, active) => {
    if (!trustedAgentInput(event) || typeof active !== 'boolean') return
    liveCall = active
    syncMuteShortcut()
    reportHotkey()
  })
  const suspendHotkeys = (suspended: boolean) => {
    if (hotkey.isPaused !== suspended) {
      const problem = hotkey.setPaused(suspended)
      if (!suspended && !reservedBrainstormHotkey(settings.settings.talkHotkey))
        hotkeyProblem =
          problem ??
          hotkey.set(settings.settings.talkHotkey) ??
          hotkey.setMode(voiceHotkeyMode(settings.settings))
    }
    if (brainstormHotkey.isPaused !== suspended) {
      const problem = brainstormHotkey.setPaused(suspended)
      if (!suspended) brainstormHotkeyProblem = problem ?? brainstormHotkey.set(BRAINSTORM_HOTKEY)
    }
    syncMuteShortcut()
    modifierStepper.setPaused(suspended)
    reportHotkey()
  }
  const clearCall = () => {
    liveCall = false
    capturingShortcut = false
    suspendHotkeys(trayPaused)
  }
  windows.panel.webContents.on('did-start-loading', clearCall)
  windows.panel.webContents.on('render-process-gone', clearCall)
  windows.panel.webContents.on('did-finish-load', reportHotkey)
  // While a new hotkey is typed into Settings, the current one must not swallow the keys.
  // (The settings view resumes it before saving, so the new key is still checked for clashes.)
  // A pause chosen in the tray wins: capturing never quietly turns the hotkey back on.
  ipcMain.on(IPC.hotkeyCapture, (event, capturing: unknown) => {
    if (event.sender !== windows.panel.webContents || typeof capturing !== 'boolean') return
    capturingShortcut = capturing
    suspendHotkeys(trayPaused || capturing)
  })
  ipcMain.on(IPC.talkState, (_event, state: unknown) => {
    if (state === 'idle' || state === 'listening' || state === 'transcribing') {
      controlCaptureBusy = state !== 'idle'
      windows.setTalking(state !== 'idle')
      windows.dot.webContents.send(IPC.talkState, state)
    }
  })
  ipcMain.on(IPC.openPanelQuietly, () => windows.openPanel({ focus: false }))

  // Settings apply live. The hotkey is checked first: if another app owns the new one, the
  // change is refused and the old hotkey keeps working.
  const applyLive = (next: Settings, previous: Settings) => {
    if (
      next.listWindowHours !== previous.listWindowHours ||
      next.maxSessions !== previous.maxSessions
    ) {
      tracker.configure(next.listWindowHours, next.maxSessions)
      codexTracker.configure(next.listWindowHours, next.maxSessions)
      void sessions.refresh()
    }
    publish()
    windows.send(IPC.settingsChanged, next)
  }
  ipcMain.handle(IPC.inspectKimiLocalRuntime, (event, input: unknown) => {
    if (event.sender !== windows.panel.webContents || event.senderFrame !== event.sender.mainFrame)
      throw Error('Invalid Kimi inspection request')
    return inspectLocalRuntime(input)
  })
  ipcMain.handle(IPC.getSettings, () => settings.settings)
  async function updateApplicationSettings(patch: unknown, expectedRevision?: string) {
    const previousSettings = settings.settings
    const previousProviders = settings.settings.enabledProviders
    const previousVoiceMode = settings.settings.voiceMode
    let switchedTalk: string | undefined
    const result = await settings
      .update(patch, (next, previous) => {
        if (reservedBrainstormHotkey(next.talkHotkey))
          return 'Ctrl+Alt+B is reserved for Brainstorm voice.'
        if (expectedRevision && controlSettingsRevision(previous) !== expectedRevision)
          return 'Settings changed; read the current revision.'
        if (next.talkHotkey !== previous.talkHotkey) muteBinding.yieldToTalk(next.talkHotkey)
        const hotkeyError =
          next.talkHotkey === previous.talkHotkey ? null : hotkey.set(next.talkHotkey)
        if (hotkeyError) {
          syncMuteShortcut()
          reportHotkey()
          return hotkeyError
        }
        if (next.talkHotkey !== previous.talkHotkey) switchedTalk = next.talkHotkey
        if (next.launchAtSignIn !== previous.launchAtSignIn) {
          try {
            setLaunchAtSignIn(next.launchAtSignIn)
          } catch (error) {
            if (next.talkHotkey !== previous.talkHotkey) {
              hotkey.set(previous.talkHotkey)
              syncMuteShortcut()
              reportHotkey()
            }
            return `Could not update Windows startup: ${error instanceof Error ? error.message : String(error)}`
          }
        }
        return null
      })
      .catch((error: unknown) => {
        if (switchedTalk && hotkey.accelerator === switchedTalk) {
          const savedTalk = settings.settings.talkHotkey
          muteBinding.yieldToTalk(savedTalk)
          hotkeyProblem = hotkey.set(savedTalk)
          syncMuteShortcut()
          reportHotkey()
        }
        return {
          ok: false as const,
          reason: error instanceof Error ? error.message : 'Could not save settings.',
        }
      })
    if (result.ok) {
      if (previousVoiceMode !== result.settings.voiceMode)
        await Promise.all([agent.stopLive(), spaces?.stopLive()])
      if (result.settings.enabledProviders.join() !== previousProviders.join()) {
        if (!enabled('claude')) holds.releaseAll()
        if (!enabled('codex')) codexHolds.releaseAll()
        syncPolling(SCAN_INTERVAL_MS)
      }
      if (previousSettings.talkHotkey !== result.settings.talkHotkey) syncMuteShortcut()
      if (hotkey.accelerator) hotkeyProblem = hotkey.setMode(voiceHotkeyMode(result.settings))
      reportHotkey()
      agent.refreshDefaults()
      applyLive(result.settings, previousSettings)
      syncScreenHelp()
    }
    return result
  }
  ipcMain.handle(IPC.updateSettings, (_event, patch: unknown) => updateApplicationSettings(patch))
  // Restore the watcher after an app update, as well as the Windows sign-in entry.
  try {
    setLaunchAtSignIn(initial.launchAtSignIn)
  } catch (error) {
    console.error('Could not restore Windows startup:', error)
  }

  const tray = createTray({
    showSessions: () => windows.openPanel(),
    openSettings: () => {
      windows.openPanel()
      windows.panel.webContents.send(IPC.openSettings)
    },
    setPaused: (paused) => {
      trayPaused = paused
      suspendHotkeys(paused || capturingShortcut)
    },
    isPaused: () => trayPaused,
    restart,
    quit: () => app.quit(),
  })

  const threadDiffPolling = setInterval(() => {
    gitStates.refreshListed()
    threadChanges.refreshListed()
  }, SCAN_INTERVAL_MS)
  let agentRetiredForQuit = false
  let retiringForQuit = false
  let providerCheckTimer: ReturnType<typeof setInterval> | null = null
  let onTopTimer: ReturnType<typeof setInterval> | null = null
  app.on('before-quit', (event) => {
    questionObserver.close()
    liveScreen.close()
    outsideHelp.close()
    regionSpeech.stop()
    screenVoice.stop()
    regionToast?.close()
    if (agentRetiredForQuit) return
    event.preventDefault()
    if (retiringForQuit) return
    retiringForQuit = true
    if (providerCheckTimer) clearInterval(providerCheckTimer)
    if (onTopTimer) clearInterval(onTopTimer)
    void Promise.allSettled([
      perplexity.close(),
      agent.close(),
      spaces?.close(),
      messageStore.flush(),
      gitStates.close(),
    ]).finally(async () => {
      await closeOwnedProcesses()
      agentRetiredForQuit = true
      app.quit()
    })
  })
  app.on('will-quit', () => {
    if (providerPolling) clearInterval(providerPolling)
    clearInterval(threadDiffPolling)
    void gitStates.close()
    holds.releaseAll() // Claude carries on with every held card itself from here on
    codexHolds.releaseAll()
    hotkey.dispose()
    brainstormHotkey.dispose()
    muteBinding.dispose()
    modifierStepper.dispose()
    stt.stop()
    tray.destroy()
  })

  sessions.start(SCAN_INTERVAL_MS)
  control.ready()

  // Keep a paused dot accessible when both sources are off, so Settings is still one click away.
  const checkProviders = async () => {
    if (retiringForQuit) return
    // The launcher watches either app, independently of the selected chat sources.
    const running = await Promise.all([
      isClaudeAppRunning(paths.appLockFile),
      codexProcesses().then((result) => result.running),
    ])
    if (retiringForQuit) return
    windows.setClaudeRunning(
      settings.settings.enabledProviders.length === 0 ||
        running.some(Boolean) ||
        agentBusy(agent.current),
    )
  }
  void checkProviders()
  providerCheckTimer = setInterval(() => void checkProviders(), CLAUDE_CHECK_INTERVAL_MS)

  // Each time another window comes to the front, the dot is raised again (windows.ts keepOnTop).
  let inFront: bigint | null = null
  onTopTimer = setInterval(() => {
    if (retiringForQuit) return
    const now = foregroundWindowId()
    // Codex does not persist a reliable foreground-chat identifier. Release conservatively
    // when its app comes forward, as well as immediately for our own Open actions.
    if (/^(Codex|ChatGPT)$/.test(foregroundTitle() || '')) codexHolds.releaseAll()
    if (now === inFront) return
    inFront = now
    windows.keepOnTop()
  }, ON_TOP_CHECK_MS)

  if (!app.isPackaged) devAids(windows)
  // No renderer can invoke a half-registered backend during asynchronous startup.
  await windows.loadRenderers()
}

/**
 * A held card is let go as soon as it would be answered in Claude anyway: when the user
 * has opened that thread in Claude since it was asked, when Claude is in front showing it, or
 * when Threadlight no longer lists the thread at all.
 */
function letHeldCardsGo(holds: Holds, snapshot: Snapshot): void {
  const ids = holds.sessionIds()
  if (ids.length === 0) return
  const all = everySession(snapshot)
  const claudeInFront = foregroundTitle() === 'Claude'
  for (const id of ids) {
    const held = holds.held(id)
    const session = all.find((s) => s.id === id)
    const openedSince = session !== undefined && held !== null && session.focusedAt > held.startedAt
    const onScreen = claudeInFront && snapshot.currentThreadId === id
    if (!session || openedSince || onScreen) holds.release(id)
  }
}

/** Every thread a snapshot lists: the recent ones and those in open workspaces. */
function everySession(snapshot: Snapshot): Session[] {
  const walk = (nodes: ThreadNode[]): Session[] =>
    nodes.flatMap((node) => [node.session, ...walk(node.children)])
  return [
    ...snapshot.sessions,
    ...(snapshot.lookupSessions ?? []),
    ...snapshot.workspaces.flatMap((w) => walk(w.threads)),
  ]
}

/**
 * The only permission Threadlight's pages may have is the microphone, and only for audio.
 * Camera, screen capture, location, notifications and everything else are refused.
 */
function allowMicrophoneOnly(windows: WindowManager): void {
  const ours = (contents: WebContents | null) =>
    contents !== null &&
    (contents === windows.panel.webContents || contents === windows.dot.webContents)
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(
      ours(contents) &&
        permission === 'media' &&
        types.length > 0 &&
        types.every((t) => t === 'audio'),
    )
  })
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      ours(contents) && permission === 'media' && details.mediaType !== 'video',
  )
}

/**
 * Development-only flags for screenshots and testing without driving the mouse:
 * `--open-panel` opens the panel on start; add `--recent-first` to show the recent list, and
 * `--expand-first`, `--menu-first` or `--settings` to also expand the first row, open its
 * right-click menu or show settings.
 */
function devAids(windows: WindowManager): void {
  const flag = (name: string) => process.argv.includes(name)
  if (!flag('--open-panel')) return
  windows.panel.webContents.once('did-finish-load', () =>
    setTimeout(() => {
      windows.openPanel()
      const contents = windows.panel.webContents
      const row = "document.querySelector('[aria-expanded]')"
      if (flag('--recent-first')) {
        void contents.executeJavaScript("document.querySelector('[aria-pressed]')?.click()")
      }
      if (flag('--expand-first')) void contents.executeJavaScript(`${row}?.click()`)
      // After the panel's own "just opened" reset, which would otherwise undo these.
      setTimeout(() => {
        if (flag('--settings')) contents.send(IPC.openSettings)
        if (flag('--menu-first')) {
          void contents.executeJavaScript(
            `${row}?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 50 }))`,
          )
        }
      }, 300)
    }, 1500),
  )
}
