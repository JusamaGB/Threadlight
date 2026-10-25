import { join } from 'node:path'

import { app, ipcMain, session, type WebContents } from 'electron'

import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { isClaudeAppRunning, openThread } from './claudeApp'
import { DEFAULT_HOOK_PORT, startHookServer } from './hookServer'
import { TalkHotkey } from './hotkeys'
import { setLaunchAtSignIn } from './loginItem'
import { findClaudeCli, isHeldByRunningProcess, type CliCommand } from './relay'
import { RelayService } from './relayService'
import { HookStateStore } from './sessions/hookState'
import { defaultPaths } from './sessions/paths'
import { SessionService } from './sessions/service'
import { Tracker } from './sessions/tracker'
import { SettingsStore } from './settings'
import { runSetup, setupArgs } from './setupMode'
import { SttService } from './stt/service'
import { createTray } from './tray'
import { WindowManager } from './windows'

const SCAN_INTERVAL_MS = 1000
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
  const tracker = new Tracker({
    paths,
    hooks,
    windowHours: initial.listWindowHours,
    maxSessions: initial.maxSessions,
  })
  const sessions = new SessionService(tracker, (snapshot) => {
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
    if (typeof appId === 'string' && openThread(appId)) windows.closePanel()
  })

  // The UI passes only a session id and text; folder, permission mode and model come from
  // Threadlight's own scan, so a misbehaving page cannot choose them.
  let cli: CliCommand | null = null
  const relays = new RelayService(
    async () => ({ cli: (cli ??= await findClaudeCli(paths)), isHeld: isHeldByRunningProcess }),
    (id) => sessions.find(id),
    (list) => windows.send(IPC.relaysChanged, list),
  )
  ipcMain.handle(IPC.sendMessage, (_event, sessionId: unknown, text: unknown) =>
    typeof sessionId === 'string' && typeof text === 'string'
      ? relays.send(sessionId, text)
      : { ok: false, reason: 'Invalid message.' },
  )
  ipcMain.handle(IPC.getRelays, () => relays.list())

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
