import { mkdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, win32 } from 'node:path'

import { app, clipboard, ipcMain, session, shell, type WebContents } from 'electron'

import { agentBusy } from '../shared/agent'
import { IPC } from '../shared/ipc'
import { registerMicIndicator } from './micIndicator'
import type { Settings } from '../shared/settings'
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
import { listChanges, readFileDiff } from './sessions/gitChanges'
import { GitStates } from './sessions/gitDiff'
import { Tracker } from './sessions/tracker'
import { SettingsStore } from './settings'
import { runSetup, setupArgs } from './setupMode'
import { SttService } from './stt/service'
import { createTray } from './tray'
import { WindowManager } from './windows'
import { startMemory } from './memory/integration'

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
  })
  // Each folder's git state, counted in the background; a new count is shown at once.
  const gitStates = new GitStates(() => void sessions.refresh())
  const tracker = new Tracker({
    paths,
    hooks,
    windowHours: initial.listWindowHours,
    maxSessions: initial.maxSessions,
    held: (id) => holds.held(id),
    gitFor: (folder) => gitStates.get(folder),
    hiddenFolder: () => agentWorkspace,
  })
  const claudeSessions = new SessionService(tracker, (snapshot) => {
    letHeldCardsGo(holds, snapshot)
    if (enabled('claude')) publish()
  })
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
  })
  const codexTracker = new CodexTracker(
    codex,
    codexHolds,
    (folder) => gitStates.get(folder),
    (id, cwd) =>
      agentSessionIds.has(id) ||
      win32.normalize(cwd.replace(/^\\\\\?\\/, '')).toLowerCase() ===
        win32.normalize(agentWorkspace.replace(/^\\\\\?\\/, '')).toLowerCase(),
  )
  codexTracker.configure(initial.listWindowHours, initial.maxSessions)
  const codexSessions = new SessionService(codexTracker, () => {
    if (enabled('codex')) publish()
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
  function publish() {
    const snapshot = sessions.snapshot
    windows.send(IPC.sessionsChanged, snapshot.sessions)
    windows.panel.webContents.send(IPC.snapshotChanged, snapshot)
  }
  const sessions = {
    get snapshot() {
      return combinedSnapshot(
        settings.settings.enabledProviders,
        {
          claude: excludeAgentChats(claudeSessions.snapshot, agentSessionIds),
          codex: excludeAgentChats(codexSessions.snapshot, agentSessionIds),
        },
        settings.settings.maxSessions,
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
  // Codex hooks use a separate port and contracts. Claude's routes and plugin stay intact.
  startHookServer({
    port: 47616,
    status: () => ({ app: 'threadlight-codex', version: app.getVersion() }),
    onEvent: (payload) => codexHolds.event(payload),
    onAsk: (payload, reply, dropped) => {
      if (isObject(payload) && agentSessionIds.has(`codex:${payload.session_id}`)) return false
      codexHolds.event(payload)
      if (!enabled('codex') || /^(Codex|ChatGPT)$/.test(foregroundTitle() || '')) return false
      const held = codexHolds.hold(payload, reply)
      if (held) dropped(() => codexHolds.dropped(reply))
      return held
    },
    onStop: (payload, reply, dropped) => {
      if (isObject(payload) && agentSessionIds.has(`codex:${payload.session_id}`)) return false
      codexHolds.event(payload)
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
      Array.isArray(list) && list.length <= 500 && list.every((item) => typeof item === 'string')
    const raw = (typeof view === 'object' && view !== null ? view : {}) as Record<string, unknown>
    sessions.setView({
      expanded: raw['expanded'] === null ? null : valid(raw['expanded']) ? raw['expanded'] : null,
      showAll: valid(raw['showAll']) ? raw['showAll'] : [],
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
  ipcMain.on(IPC.panelClose, () => windows.closePanel())
  ipcMain.on(IPC.panelLeave, () => windows.closeOnPointerLeave())
  ipcMain.on(IPC.panelStayOpen, (_event, on: unknown) => windows.setStayOpen(on === true))
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
  ipcMain.handle(IPC.answerQuestion, (_event, sessionId: unknown, answers: unknown) =>
    typeof sessionId === 'string'
      ? holds.answerQuestion(sessionId, answers)
      : { ok: false, reason: 'Invalid answer.' },
  )
  ipcMain.handle(IPC.answerNextStep, (_event, sessionId: unknown, choice: unknown) =>
    typeof sessionId === 'string'
      ? holds.answerNextStep(sessionId, choice)
      : { ok: false, reason: 'Invalid answer.' },
  )
  ipcMain.handle(IPC.answerApproval, (_event, sessionId: unknown, choice: unknown) => {
    if (typeof sessionId !== 'string') return { ok: false, reason: 'Invalid answer.' }
    const result = holds.answerApproval(sessionId, choice)
    // Answered: the session works on, whatever Claude's permission notice said before.
    if (result.ok) hooks.apply({ session_id: sessionId, hook_event_name: 'PreToolUse' })
    return result
  })
  ipcMain.handle(IPC.answerOffer, (_event, sessionId: unknown, choice: unknown) =>
    typeof sessionId === 'string'
      ? holds.answerOffer(sessionId, choice)
      : { ok: false, reason: 'Invalid answer.' },
  )
  // The Changes view. A thread is named by its id; its repository comes from Threadlight's own
  // scan, and only files that are among its changes are ever read or opened.
  const rootOf = (sessionId: unknown) =>
    typeof sessionId === 'string'
      ? (everySession(sessions.snapshot).find((s) => s.id === sessionId)?.git?.root ?? null)
      : null
  const changedPath = async (sessionId: unknown, path: unknown) => {
    const root = rootOf(sessionId)
    if (!root || typeof path !== 'string') return null
    const files = await listChanges(root)
    return files.some((f) => f.path === path) ? { root, path } : null
  }
  ipcMain.handle(IPC.getChanges, async (_event, sessionId: unknown) => {
    const root = rootOf(sessionId)
    if (!root) return null
    const session = everySession(sessions.snapshot).find((s) => s.id === sessionId)
    return { branch: session?.git?.branch ?? null, files: await listChanges(root) }
  })
  // A plan step's activity, read from the thread's own transcript, which Threadlight's scan found.
  ipcMain.handle(IPC.getStepActivity, (_event, sessionId: unknown, step: unknown) => {
    if (typeof sessionId !== 'string' || typeof step !== 'string') return null
    const path = tracker.transcriptPath(sessionId)
    return path ? readStepActivity(path, step) : null
  })
  ipcMain.handle(IPC.getFileDiff, async (_event, sessionId: unknown, path: unknown) => {
    const found = await changedPath(sessionId, path)
    return found ? readFileDiff(found.root, found.path) : { kind: 'unavailable' }
  })
  ipcMain.on(IPC.openChangedFile, (_event, sessionId: unknown, path: unknown) => {
    void changedPath(sessionId, path).then((found) => {
      if (found) void shell.openPath(join(found.root, found.path))
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
  ipcMain.handle(IPC.answerCodex, (_event, id: unknown, holdId: unknown, answer: unknown) =>
    typeof id === 'string' && codexSessions.find(id)
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
    (id) => codexSessions.find(id),
    () => publishRelays(),
  )
  function publishRelays() {
    const statuses = [...relays.list(), ...codexRelays.list()]
    for (const status of statuses) if (status.attemptId) memoryReceipt?.(status)
    windows.send(IPC.relaysChanged, statuses)
  }
  ipcMain.handle(IPC.sendMessage, (_event, sessionId: unknown, text: unknown) =>
    typeof sessionId === 'string' && typeof text === 'string'
      ? !enabled(sessionProvider(sessionId))
        ? { ok: false, reason: 'Enable this application in Settings before sending.' }
        : sessionId.startsWith('codex:')
          ? codexRelays.send(sessionId, text)
          : relays.send(sessionId, text)
      : { ok: false, reason: 'Invalid message.' },
  )
  ipcMain.handle(IPC.getRelays, () => [...relays.list(), ...codexRelays.list()])

  const stopMemory = await startMemory(app.getPath('userData'), windows.panel, {
    find: (id) => sessions.find(id),
    statuses: () => [...relays.list(), ...codexRelays.list()],
    watch: (listener) => {
      memoryReceipt = listener
      return () => {
        if (memoryReceipt === listener) memoryReceipt = undefined
      }
    },
    send: (id, text, context) =>
      !enabled(sessionProvider(id))
        ? { ok: false, reason: 'Enable the destination provider in Settings.' }
        : id.startsWith('codex:')
          ? codexRelays.send(id, text, context)
          : relays.send(id, text, context),
  })
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

  const agent = new AgentService({
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
    },
    onRateLimit: (info) => usage.note(info),
    onLive: (event) => windows.panel.webContents.send(IPC.agentLiveEvent, event),
  })
  await agent.store
    .load()
    .catch(() =>
      console.error('Agent history metadata is unavailable; monitoring remains available.'),
    )
  for (const record of agent.store.all())
    agentSessionIds.add(
      record.provider === 'codex' ? `codex:${record.providerId}` : record.providerId,
    )
  // Complete previously requested cleanup before allowing a history continuation to race it.
  await agent.retryArchives().catch(() => {})
  ipcMain.handle(IPC.agentGet, () => agent.current)
  ipcMain.handle(IPC.agentLiveStart, (event, id: unknown, sdp: unknown) =>
    event.sender === windows.panel.webContents
      ? agent.startLive(id, sdp)
      : { ok: false, reason: 'Live is only available in the panel.' },
  )
  ipcMain.handle(IPC.agentLiveOpen, (event, id: unknown, text: unknown) =>
    event.sender === windows.panel.webContents
      ? agent.openLive(id, text)
      : { ok: false, reason: 'Live is only available in the panel.' },
  )
  ipcMain.on(IPC.agentLiveStop, (event, id: unknown) => {
    if (event.sender === windows.panel.webContents && typeof id === 'string')
      void agent.stopLive(id)
  })
  windows.panel.webContents.on('render-process-gone', () => void agent.stopLive())
  windows.panel.webContents.on('did-start-loading', () => void agent.stopLive())
  ipcMain.handle(IPC.agentSend, (_event, text: unknown) => agent.send(text))
  ipcMain.handle(IPC.agentRespond, (_event, id: unknown, response: unknown) =>
    agent.respond(id, response),
  )
  ipcMain.handle(IPC.agentInterrupt, () => agent.interrupt())
  ipcMain.handle(IPC.agentModels, () =>
    agent.models().catch((error: Error) => ({ models: [], error: error.message })),
  )
  ipcMain.on(IPC.agentDecide, (_event, id: unknown, allow: unknown) => {
    if (typeof id === 'string') agent.decide(id, allow === true)
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
  let hotkeyProblem = hotkey.set(initial.talkHotkey) ?? hotkey.setMode(initial.talkMode)
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
    setLaunchAtSignIn(next.launchAtSignIn)
    windows.send(IPC.settingsChanged, next)
  }
  ipcMain.handle(IPC.getSettings, () => settings.settings)
  ipcMain.handle(IPC.updateSettings, async (_event, patch: unknown) => {
    const previousProviders = settings.settings.enabledProviders
    const result = await settings.update(patch, (next, previous) =>
      next.talkHotkey === previous.talkHotkey ? null : hotkey.set(next.talkHotkey),
    )
    if (result.ok) {
      if (result.settings.enabledProviders.join() !== previousProviders.join()) {
        if (!enabled('claude')) holds.releaseAll()
        if (!enabled('codex')) codexHolds.releaseAll()
        syncPolling(SCAN_INTERVAL_MS)
      }
      hotkeyProblem = hotkey.setMode(result.settings.talkMode)
      reportHotkey()
      agent.refreshDefaults()
      applyLive(result.settings)
    }
    return result
  })
  setLaunchAtSignIn(initial.launchAtSignIn) // the setting is the source of truth

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
    quit: () => app.quit(),
  })

  let agentRetiredForQuit = false
  let retiringForQuit = false
  app.on('before-quit', (event) => {
    if (agentRetiredForQuit) return
    event.preventDefault()
    if (retiringForQuit) return
    retiringForQuit = true
    void Promise.allSettled([agent.close(), messageStore.flush()]).finally(() => {
      agentRetiredForQuit = true
      app.quit()
    })
  })
  app.on('will-quit', () => {
    holds.releaseAll() // Claude carries on with every held card itself from here on
    codexHolds.releaseAll()
    hotkey.dispose()
    stt.stop()
    tray.destroy()
  })

  sessions.start(SCAN_INTERVAL_MS)

  // Keep a paused dot accessible when both sources are off, so Settings is still one click away.
  const checkProviders = async () => {
    const selected = [...settings.settings.enabledProviders]
    const running = await Promise.all(
      selected.map((provider) =>
        provider === 'codex'
          ? codexProcesses().then((result) => result.running)
          : isClaudeAppRunning(paths.appLockFile),
      ),
    )
    if (selected.join() === settings.settings.enabledProviders.join())
      windows.setClaudeRunning(
        selected.length === 0 || running.some(Boolean) || agentBusy(agent.current),
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
