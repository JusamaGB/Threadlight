import { OwnedRequests } from './communication/ownedRequests'
import { codexCommunicationAdmitted } from './communication/admission'
import { codexHeld } from './codex/live'
import { CommunicationCatalog } from './communication/catalog'
import { appendFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, win32 } from 'node:path'

import { app, clipboard, ipcMain, session, shell, type WebContents } from 'electron'

import { agentBusy } from '../shared/agent'
import { IPC } from '../shared/ipc'
import { registerMicIndicator } from './micIndicator'
import type { Settings } from '../shared/settings'
import { voiceHotkeyMode } from '../shared/settings'
import type { Provider, Session, Snapshot, ThreadNode, RelayStatus } from '../shared/types'
import { combinedSnapshot, PROVIDERS, providerView, sessionProvider } from '../shared/providers'
import { isClaudeAppRunning, openThread } from './claudeApp'
import { DEFAULT_HOOK_PORT, startHookServer } from './hookServer'
import { TalkHotkey } from './hotkeys'
import { AgentService } from './agent/agentService'
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
import { MessageStore } from './messaging/store'
import { MESSAGE_LIMIT } from '../shared/messaging'
import { CodexTracker } from './codex/tracker'
import { CodexHolds } from './codex/holds'
import { CodexRelayService, findCodexCli } from './codex/relay'
import { codexDeepLink } from './codex/identity'
import { codexProcesses } from './codex/live'
import { SessionService } from './sessions/service'
import { PLAN_CONTEXT, readStepActivity } from './sessions/stepActivity'
import { ThreadChanges } from './sessions/threadChanges'
import { IgnoredInput } from './ignoredInput'
import { GitStates } from './sessions/gitDiff'
import { inside, listChanges, readFileDiff } from './sessions/gitChanges'
import { Tracker } from './sessions/tracker'
import { SettingsStore } from './settings'
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
let restarting = false
function restart(): void {
  if (restarting) return
  restarting = true
  app.relaunch()
  setTimeout(() => app.exit(0), 6000).unref()
  app.quit()
}

async function start(): Promise<void> {
  const paths = defaultPaths()
  const settings = new SettingsStore(app.getPath('userData'))
  const initial = await settings.load()
  const enabled = (provider: Provider) => settings.settings.enabledProviders.includes(provider)

  const hooks = new HookStateStore()
  const windows = new WindowManager()
  registerMicIndicator(windows)
  // The agent's own folder; its conversations stay out of the thread list unless shown.
  const agentFiles = agentPaths(app.getPath('userData'))
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
  const ignoredInput = new IgnoredInput()
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
  const claudeSessions = new SessionService(
    tracker,
    (snapshot) => {
      letHeldCardsGo(holds, snapshot)
      if (enabled('claude')) publish()
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
  const codexTracker = new CodexTracker(
    codex,
    codexHolds,
    (folder) => gitStates.peek(folder),
    (id, cwd) =>
      agentSessionIds.has(id) ||
      win32.normalize(cwd.replace(/^\\\\\?\\/, '')).toLowerCase() ===
        win32.normalize(agentWorkspace.replace(/^\\\\\?\\/, '')).toLowerCase(),
    pinned,
  )
  codexTracker.configure(initial.listWindowHours, initial.maxSessions)
  const codexSessions = new SessionService(
    codexTracker,
    () => {
      if (enabled('codex')) publish()
    },
    reportSlowScan('Codex'),
  )
  const threadChanges = new ThreadChanges({
    history: codex.history,
    transcript: (id) => tracker.transcriptPath(id),
    changed: () => publish(),
  })
  const sources = { claude: claudeSessions, codex: codexSessions }
  const polling = new Set<Provider>()
  function syncPolling(ms: number) {
    for (const provider of PROVIDERS) {
      if (enabled(provider) && !polling.has(provider)) {
        sources[provider].start(ms)
        polling.add(provider)
      } else if (!enabled(provider) && polling.has(provider)) {
        sources[provider].stop()
        polling.delete(provider)
      }
    }
  }
  // Claude and Codex scan separately and rarely finish together. Updates arriving within a
  // moment of each other go out as one, so both columns appear in the same frame; nothing
  // waits longer than this for the other source.
  let publishTimer: NodeJS.Timeout | null = null
  function publish() {
    if (publishTimer) return
    publishTimer = setTimeout(() => {
      publishTimer = null
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
                claude: excludeAgentChats(claudeSessions.snapshot, agentSessionIds),
                codex: excludeAgentChats(codexSessions.snapshot, agentSessionIds),
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
      for (const provider of settings.settings.enabledProviders)
        sources[provider].setView(providerView(settings.settings.enabledProviders, provider, view))
    },
    refresh: () =>
      Promise.all(
        settings.settings.enabledProviders.map((provider) => sources[provider].refresh()),
      ),
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
  ipcMain.on(IPC.panelResize, (_event, height: unknown) => windows.resizePanel(Number(height)))
  ipcMain.handle(IPC.getAttentionMotion, () => windows.attentionMotion)
  ipcMain.on(IPC.panelClose, () => windows.closePanel())
  ipcMain.on(IPC.panelLeave, () => windows.closeOnPointerLeave())
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
      ? everySession(sessions.snapshot).find((s) => s.id === sessionId)
      : null
  ipcMain.handle(IPC.getChanges, async (_event, sessionId: unknown) => {
    const session = changeSession(sessionId)
    return session ? threadChanges.changes(session) : null
  })
  // Worktree actions use the scan's exact Git root and the existing HEAD-based viewer.
  const changedWorktreePath = async (sessionId: unknown, path: unknown) => {
    const root = changeSession(sessionId)?.git?.root
    if (!root || typeof path !== 'string' || !inside(root, path)) return null
    return (await listChanges(root)).some((file) => file.path === path) ? { root, path } : null
  }
  ipcMain.handle(IPC.getWorktreeChanges, async (_event, sessionId: unknown) => {
    const git = changeSession(sessionId)?.git
    return git?.root ? { branch: git.branch, files: await listChanges(git.root) } : null
  })
  ipcMain.handle(IPC.getWorktreeFileDiff, async (_event, sessionId: unknown, path: unknown) => {
    const found = await changedWorktreePath(sessionId, path)
    return found ? readFileDiff(found.root, found.path) : { kind: 'unavailable' }
  })
  ipcMain.on(IPC.openWorktreeChangedFile, (_event, sessionId: unknown, path: unknown) => {
    void changedWorktreePath(sessionId, path).then((found) => {
      if (found) void shell.openPath(join(found.root, found.path))
    })
  })
  // A plan step's activity, read from the thread's own transcript, which Threadlight's scan found.
  ipcMain.handle(IPC.getStepActivity, (_event, sessionId: unknown, step: unknown) => {
    if (typeof sessionId !== 'string' || typeof step !== 'string') return null
    const path = tracker.transcriptPath(sessionId)
    return path ? readStepActivity(path, step) : null
  })
  ipcMain.handle(IPC.getFileDiff, async (_event, sessionId: unknown, path: unknown) => {
    const session = changeSession(sessionId)
    return session && typeof path === 'string'
      ? threadChanges.file(session, path)
      : { kind: 'unavailable' }
  })
  ipcMain.on(IPC.openChangedFile, (_event, sessionId: unknown, path: unknown) => {
    const session = changeSession(sessionId)
    if (session && typeof path === 'string')
      void threadChanges.absolute(session, path).then((found) => {
        if (found) void shell.openPath(found)
      })
  })
  ipcMain.on(IPC.copyText, (_event, text: unknown) => {
    if (typeof text === 'string' && text.length <= 20_000) clipboard.writeText(text)
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
    windows.send(IPC.relaysChanged, statuses)
  }
  ipcMain.handle(IPC.sendMessage, (event, sessionId: unknown, text: unknown) =>
    event.sender === windows.panel.webContents &&
    event.senderFrame === event.sender.mainFrame &&
    typeof sessionId === 'string' &&
    typeof text === 'string'
      ? stopMemory.send(sessionId, text)
      : { ok: false, reason: 'Invalid message caller.' },
  )
  ipcMain.handle(IPC.getRelays, () => [...relays.list(), ...codexRelays.list()])

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
  const ownedCommunicationRequests = new OwnedRequests(() => communicationOwners)
  const stopMemory = await startMemory(app.getPath('userData'), windows.panel, {
    conversationOwner: () => communicationOwners[0]?.current.conversationId ?? undefined,
    destinations: (target, query) => communicationCatalog.find(target, query),
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
  const agent = new AgentService({
    announcements: {
      next: (owner, since) => {
        stopMemory.conversationFeed(owner)
        return stopMemory.conversations()?.reserve(owner, since)
      },
      commit: (a) => {
        stopMemory.conversationFeed(a.owner)
        return stopMemory.conversations()?.commit(a) ?? false
      },
      settle: (owner, id, state) => stopMemory.conversations()?.settle(owner, id, state),
    },
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
      if (state.sessionId)
        agentSessionIds.add(
          state.provider === 'codex' ? `codex:${state.sessionId}` : state.sessionId,
        )
      windows.panel.webContents.send(IPC.agentChanged, state)
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
  // Complete previously requested cleanup before allowing a history continuation to race it.
  await agent.retryArchives().catch(() => {})
  let spaces: SpacesService | null = null
  let spacesIssue = ''
  try {
    const files = spacesPaths(app.getPath('userData'))
    spaces = new SpacesService(
      new SpacesStore(files.store),
      stopMemory.store,
      () => sessions.snapshot.lookupSessions ?? sessions.snapshot.sessions,
      {
        threadReads,
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
        onChange: (state) => {
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
    await spaces.agent.store.load()
    for (const record of spaces.agent.store.all())
      agentSessionIds.add(
        record.provider === 'codex' ? `codex:${record.providerId}` : record.providerId,
      )
  } catch (error) {
    spacesIssue = error instanceof Error ? error.message : 'Shared Spaces could not load.'
  }
  registerSpaces(windows.panel, spacesIssue ? null : spaces, spacesIssue)
  const trustedAgentInput = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === windows.panel.webContents && event.senderFrame === event.sender.mainFrame
  ipcMain.handle(IPC.agentGet, () => agent.current)
  ipcMain.handle(IPC.agentAnnouncement, (event, id: unknown, command: unknown) => {
    if (
      event.sender !== windows.panel.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      settings.settings.voiceMode !== 'gpt-live'
    )
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
    return agent.announcementCommand(
      id,
      command as import('./../shared/conversationEvents').AnnouncementCommand,
    )
  })
  ipcMain.handle(IPC.agentLiveStart, (event, id: unknown, sdp: unknown) =>
    trustedAgentInput(event) && settings.settings.voiceMode === 'gpt-live'
      ? agent.startLive(id, sdp)
      : { ok: false, reason: 'Select GPT Live in the panel to start live audio.' },
  )
  ipcMain.handle(IPC.agentLiveOpen, (event, id: unknown, text: unknown) =>
    trustedAgentInput(event)
      ? agent.openLive(id, text)
      : { ok: false, reason: 'Live is only available in the panel.' },
  )
  ipcMain.on(IPC.agentLiveStop, (event, id: unknown) => {
    if (trustedAgentInput(event) && typeof id === 'string') void agent.stopLive(id)
  })
  windows.panel.webContents.on('render-process-gone', () => void agent.stopLive())
  windows.panel.webContents.on('did-start-loading', () => void agent.stopLive())
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
  const hotkey = new TalkHotkey({
    toggle: () => windows.panel.webContents.send(IPC.talkToggle),
    hold: (phase) => windows.panel.webContents.send(IPC.talkHold, phase),
  })
  let hotkeyProblem = hotkey.set(initial.talkHotkey) ?? hotkey.setMode(voiceHotkeyMode(initial))
  const reportHotkey = () => windows.panel.webContents.send(IPC.hotkeyProblem, hotkeyProblem)
  windows.panel.webContents.on('did-finish-load', reportHotkey)
  // While a new hotkey is typed into Settings, the current one must not swallow the keys.
  // (The settings view resumes it before saving, so the new key is still checked for clashes.)
  // A pause chosen in the tray wins: capturing never quietly turns the hotkey back on.
  ipcMain.on(IPC.hotkeyCapture, (_event, capturing: unknown) => {
    if (!trayPaused) hotkey.setPaused(capturing === true)
  })
  ipcMain.on(IPC.talkState, (_event, state: unknown) => {
    if (state === 'idle' || state === 'listening' || state === 'transcribing') {
      windows.setTalking(state !== 'idle')
      windows.dot.webContents.send(IPC.talkState, state)
    }
  })
  ipcMain.on(IPC.openPanelQuietly, () => windows.openPanel({ focus: false }))

  // Settings apply live. The hotkey is checked first: if another app owns the new one, the
  // change is refused and the old hotkey keeps working.
  const applyLive = (next: Settings) => {
    tracker.configure(next.listWindowHours, next.maxSessions)
    codexTracker.configure(next.listWindowHours, next.maxSessions)
    publish()
    void sessions.refresh()
    void checkProviders()
    windows.send(IPC.settingsChanged, next)
  }
  ipcMain.handle(IPC.getSettings, () => settings.settings)
  ipcMain.handle(IPC.updateSettings, async (_event, patch: unknown) => {
    const previousProviders = settings.settings.enabledProviders
    const previousVoiceMode = settings.settings.voiceMode
    const result = await settings.update(patch, (next, previous) => {
      const hotkeyError =
        next.talkHotkey === previous.talkHotkey ? null : hotkey.set(next.talkHotkey)
      if (hotkeyError) return hotkeyError
      if (next.launchAtSignIn !== previous.launchAtSignIn) {
        try {
          setLaunchAtSignIn(next.launchAtSignIn)
        } catch (error) {
          if (next.talkHotkey !== previous.talkHotkey) hotkey.set(previous.talkHotkey)
          return `Could not update Windows startup: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      return null
    })
    if (result.ok) {
      if (previousVoiceMode !== result.settings.voiceMode) await agent.stopLive()
      if (result.settings.enabledProviders.join() !== previousProviders.join()) {
        if (!enabled('claude')) holds.releaseAll()
        if (!enabled('codex')) codexHolds.releaseAll()
        syncPolling(SCAN_INTERVAL_MS)
      }
      hotkeyProblem = hotkey.setMode(voiceHotkeyMode(result.settings))
      reportHotkey()
      agent.refreshDefaults()
      applyLive(result.settings)
    }
    return result
  })
  // Restore the watcher after an app update, as well as the Windows sign-in entry.
  try {
    setLaunchAtSignIn(initial.launchAtSignIn)
  } catch (error) {
    console.error('Could not restore Windows startup:', error)
  }

  let trayPaused = false
  const tray = createTray({
    showSessions: () => windows.openPanel(),
    openSettings: () => {
      windows.openPanel()
      windows.panel.webContents.send(IPC.openSettings)
    },
    setPaused: (paused) => {
      trayPaused = paused
      hotkeyProblem = hotkey.setPaused(paused)
      reportHotkey()
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
  app.on('before-quit', (event) => {
    if (agentRetiredForQuit) return
    event.preventDefault()
    if (retiringForQuit) return
    retiringForQuit = true
    void Promise.allSettled([
      agent.close(),
      spaces?.close(),
      messageStore.flush(),
      gitStates.close(),
    ]).finally(() => {
      agentRetiredForQuit = true
      app.quit()
    })
  })
  app.on('will-quit', () => {
    clearInterval(threadDiffPolling)
    void gitStates.close()
    holds.releaseAll() // Claude carries on with every held card itself from here on
    codexHolds.releaseAll()
    hotkey.dispose()
    stt.stop()
    tray.destroy()
  })

  sessions.start(SCAN_INTERVAL_MS)

  // Keep a paused dot accessible when both sources are off, so Settings is still one click away.
  const checkProviders = async () => {
    // The launcher watches either app, independently of the selected chat sources.
    const running = await Promise.all([
      isClaudeAppRunning(paths.appLockFile),
      codexProcesses().then((result) => result.running),
    ])
    windows.setClaudeRunning(
      settings.settings.enabledProviders.length === 0 ||
        running.some(Boolean) ||
        agentBusy(agent.current),
    )
  }
  void checkProviders()
  setInterval(() => void checkProviders(), CLAUDE_CHECK_INTERVAL_MS)

  // Each time another window comes to the front, the dot is raised again (windows.ts keepOnTop).
  let inFront: bigint | null = null
  setInterval(() => {
    const now = foregroundWindowId()
    // Codex does not persist a reliable foreground-chat identifier. Release conservatively
    // when its app comes forward, as well as immediately for our own Open actions.
    if (/^(Codex|ChatGPT)$/.test(foregroundTitle() || '')) codexHolds.releaseAll()
    if (now === inFront) return
    inFront = now
    windows.keepOnTop()
  }, ON_TOP_CHECK_MS)

  if (!app.isPackaged) devAids(windows)
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
