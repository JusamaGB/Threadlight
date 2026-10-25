import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { app, clipboard, ipcMain, session, type WebContents } from 'electron'

import { IDLE_AGENT } from '../shared/agent'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import type { Session, Snapshot, ThreadNode } from '../shared/types'
import { isClaudeAppRunning, openThread } from './claudeApp'
import { DEFAULT_HOOK_PORT, startHookServer } from './hookServer'
import { TalkHotkey } from './hotkeys'
import { AgentRun } from './agent/agentRun'
import { foregroundTitle } from './keyState'
import { setLaunchAtSignIn } from './loginItem'
import { Holds } from './holds'
import { findClaudeCli, isHeld, type CliCommand } from './relay'
import { RelayService } from './relayService'
import { HookStateStore } from './sessions/hookState'
import { defaultPaths } from './sessions/paths'
import { SessionService } from './sessions/service'
import { GitDiffs } from './sessions/gitDiff'
import { Tracker } from './sessions/tracker'
import { SettingsStore } from './settings'
import { runSetup, setupArgs } from './setupMode'
import { SttService } from './stt/service'
import { createTray } from './tray'
import { WindowManager } from './windows'

const SCAN_INTERVAL_MS = 1000
const AGENT_MODEL = 'claude-haiku-5-5'
const CLAUDE_CHECK_INTERVAL_MS = 2000

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

  const hooks = new HookStateStore()
  const windows = new WindowManager()
  // Cards held so they can be answered here (holds.ts); any change is shown at once.
  const holds = new Holds(() => void sessions.refresh())
  // Each folder's uncommitted changes, counted in the background; a new count is shown at once.
  const diffs = new GitDiffs(() => void sessions.refresh())
  const tracker = new Tracker({
    paths,
    hooks,
    windowHours: initial.listWindowHours,
    maxSessions: initial.maxSessions,
    held: (id) => holds.held(id),
    diffFor: (folder) => diffs.get(folder),
  })
  const sessions = new SessionService(tracker, (snapshot) => {
    letHeldCardsGo(holds, snapshot)
    windows.send(IPC.sessionsChanged, snapshot.sessions)
    windows.panel.webContents.send(IPC.snapshotChanged, snapshot)
  })

  // Hook events make state exact and immediate: apply, then rescan straight away.
  let hookEvents = 0
  startHookServer({
    port: DEFAULT_HOOK_PORT,
    // For the installer's check: is it running, and have the plugin's hooks reached it?
    status: () => ({ app: 'threadlight', version: app.getVersion(), hookEvents }),
    onEvent: (payload) => {
      hookEvents += 1
      hooks.apply(payload)
      void sessions.refresh()
    },
    // The question-card hook waits here for an answer (or to be let go).
    onAsk: (payload, reply, dropped) => {
      const held = holds.holdQuestion(payload, reply)
      if (held) dropped(() => holds.dropped(reply))
      return held
    },
    // The Stop hook waits here when a turn ends, in case it asked a next-step question.
    onStop: (payload, reply, dropped) => {
      const event = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >
      const sessionId = typeof event['session_id'] === 'string' ? event['session_id'] : null
      // A turn already carried on by an answer is let finish; so is anything unrecognised.
      if (!sessionId || event['stop_hook_active'] === true) return false
      dropped(() => holds.dropped(reply))
      hooks.apply(payload) // the turn has ended: idle, so the next-step card can show
      void sessions.refresh().then(() => {
        const attention = everySession(sessions.snapshot).find((s) => s.id === sessionId)?.attention
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
  ipcMain.on(IPC.dotClick, () => windows.openPanel())
  ipcMain.on(IPC.dotDrag, (_event, dx: unknown, dy: unknown) =>
    windows.dragDot(Number(dx), Number(dy)),
  )
  ipcMain.on(IPC.dotDragEnd, () => windows.endDrag())
  ipcMain.on(IPC.resetDotPosition, () => windows.resetDotPosition())
  ipcMain.on(IPC.panelResize, (_event, height: unknown) => windows.resizePanel(Number(height)))
  ipcMain.on(IPC.panelClose, () => windows.closePanel())
  ipcMain.on(IPC.panelStayOpen, (_event, on: unknown) => windows.setStayOpen(on === true))
  ipcMain.on(IPC.openInClaude, (_event, appId: unknown) => {
    if (typeof appId !== 'string') return
    // Going to the thread in Claude means answering there: let a held card go first.
    const session = everySession(sessions.snapshot).find((s) => s.appId === appId)
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
  ipcMain.on(IPC.copyText, (_event, text: unknown) => {
    if (typeof text === 'string' && text.length <= 20_000) clipboard.writeText(text)
  })
  ipcMain.on(IPC.releaseHold, (_event, sessionId: unknown) => {
    if (typeof sessionId === 'string') holds.release(sessionId)
  })

  // The UI passes only a session id and text; folder, permission mode and model come from
  // Threadlight's own scan, so a misbehaving page cannot choose them.
  let cli: CliCommand | null = null
  const relays = new RelayService(
    async () => ({
      cli: (cli ??= await findClaudeCli(paths)),
      isHeld: (id) => isHeld(paths.liveSessionsDir, id),
    }),
    (id) => sessions.find(id),
    (list) => windows.send(IPC.relaysChanged, list),
  )
  ipcMain.handle(IPC.sendMessage, (_event, sessionId: unknown, text: unknown) =>
    typeof sessionId === 'string' && typeof text === 'string'
      ? relays.send(sessionId, text)
      : { ok: false, reason: 'Invalid message.' },
  )
  ipcMain.handle(IPC.getRelays, () => relays.list())

  // The agent: one conversation Threadlight hosts itself (agent/agentRun.ts), working in its
  // own folder. The spike runs on Haiku to keep test runs cheap; a setting comes later.
  const agentWorkspace = join(app.getPath('userData'), 'agent')
  let agent: AgentRun | null = null
  const sendAgent = (state: unknown) => windows.panel.webContents.send(IPC.agentChanged, state)
  const getAgent = async () => {
    const found = (cli ??= await findClaudeCli(paths))
    if (!found) return null
    await mkdir(agentWorkspace, { recursive: true })
    agent ??= new AgentRun({
      cli: found,
      workspace: agentWorkspace,
      model: AGENT_MODEL,
      onChange: sendAgent,
    })
    return agent
  }
  ipcMain.handle(IPC.agentGet, () => agent?.current ?? IDLE_AGENT)
  ipcMain.handle(IPC.agentSend, async (_event, text: unknown) => {
    if (typeof text !== 'string') return { ok: false, reason: 'Nothing to send.' }
    const run = await getAgent()
    return run ? run.send(text) : { ok: false, reason: 'Claude Code was not found on this PC.' }
  })
  ipcMain.on(IPC.agentDecide, (_event, id: unknown, allow: unknown) => {
    if (typeof id === 'string') agent?.decide(id, allow === true)
  })
  ipcMain.on(IPC.agentClose, () => agent?.close())

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
    void sessions.refresh()
    setLaunchAtSignIn(next.launchAtSignIn)
    windows.send(IPC.settingsChanged, next)
  }
  ipcMain.handle(IPC.getSettings, () => settings.settings)
  ipcMain.handle(IPC.updateSettings, async (_event, patch: unknown) => {
    const result = await settings.update(patch, (next, previous) =>
      next.talkHotkey === previous.talkHotkey ? null : hotkey.set(next.talkHotkey),
    )
    if (result.ok) {
      hotkeyProblem = hotkey.setMode(result.settings.talkMode)
      reportHotkey()
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

  app.on('will-quit', () => {
    agent?.close()
    holds.releaseAll() // Claude carries on with every held card itself from here on
    hotkey.dispose()
    stt.stop()
    tray.destroy()
  })

  sessions.start(SCAN_INTERVAL_MS)

  // The dot only shows while the Claude desktop app is running.
  const checkClaude = async () =>
    windows.setClaudeRunning(await isClaudeAppRunning(paths.appLockFile))
  void checkClaude()
  setInterval(() => void checkClaude(), CLAUDE_CHECK_INTERVAL_MS)

  if (!app.isPackaged) devAids(windows)
}

/**
 * A held question card is let go as soon as it would be answered in Claude anyway: when the user
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
  return [...snapshot.sessions, ...snapshot.workspaces.flatMap((w) => walk(w.threads))]
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
