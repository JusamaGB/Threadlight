import { join } from 'node:path'

import { app, ipcMain, session, type WebContents } from 'electron'

import { IPC } from '../shared/ipc'
import { isClaudeAppRunning, openThread } from './claudeApp'
import { DEFAULT_HOOK_PORT, startHookServer } from './hookServer'
import { DEFAULT_TALK_HOTKEY, registerTalkHotkey, unregisterAll } from './hotkeys'
import { findClaudeCli, isHeldByRunningProcess, type CliCommand } from './relay'
import { RelayService } from './relayService'
import { HookStateStore } from './sessions/hookState'
import { defaultPaths } from './sessions/paths'
import { SessionService } from './sessions/service'
import { Tracker } from './sessions/tracker'
import { SttService } from './stt/service'
import { WindowManager } from './windows'

const SCAN_INTERVAL_MS = 1000
const CLAUDE_CHECK_INTERVAL_MS = 2000

// One Threadlight per user: a second launch just exits.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(start)
  // Threadlight lives in the corner, not in windows; hiding windows never quits it.
  app.on('window-all-closed', () => {})
}

function start(): void {
  const paths = defaultPaths()
  const hooks = new HookStateStore()
  const windows = new WindowManager()
  const sessions = new SessionService(new Tracker({ paths, hooks }), (list) =>
    windows.send(IPC.sessionsChanged, list),
  )

  // Hook events make state exact and immediate: apply, then rescan straight away.
  startHookServer({
    port: DEFAULT_HOOK_PORT,
    onEvent: (payload) => {
      hooks.apply(payload)
      void sessions.refresh()
    },
  }).catch((error: unknown) => {
    // Most likely another program holds the port. Threadlight still works on transcripts alone.
    console.error(`Hook server could not start on port ${DEFAULT_HOOK_PORT}`, error)
  })

  ipcMain.handle(IPC.getVersion, () => app.getVersion())
  ipcMain.handle(IPC.getSessions, () => sessions.sessions)
  ipcMain.on(IPC.dotClick, () => windows.openPanel())
  ipcMain.on(IPC.dotDrag, (_event, dx: unknown, dy: unknown) =>
    windows.dragDot(Number(dx), Number(dy)),
  )
  ipcMain.on(IPC.dotDragEnd, () => windows.endDrag())
  ipcMain.on(IPC.panelResize, (_event, height: unknown) => windows.resizePanel(Number(height)))
  ipcMain.on(IPC.panelClose, () => windows.closePanel())
  ipcMain.on(IPC.panelSemiOpen, (_event, on: unknown) => windows.setSemiOpen(on === true))
  ipcMain.on(IPC.openInClaude, (_event, appId: unknown) => {
    if (typeof appId === 'string' && openThread(appId)) windows.closePanel()
  })

  // The UI passes only a session id and text; folder, permission mode and model come from
  // Threadlight's own scan, so a misbehaving page cannot choose them.
  let cli: CliCommand | null = null
  const relays = new RelayService(
    async () => ({ cli: (cli ??= await findClaudeCli(paths)), isHeld: isHeldByRunningProcess }),
    (id) => sessions.sessions.find((s) => s.id === id),
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

  // The talk hotkey toggles recording in the (possibly hidden) panel, which does the rest.
  const hotkeyProblem = registerTalkHotkey(DEFAULT_TALK_HOTKEY, () =>
    windows.panel.webContents.send(IPC.talkToggle),
  )
  if (hotkeyProblem) console.warn(hotkeyProblem)
  windows.panel.webContents.on('did-finish-load', () =>
    windows.panel.webContents.send(IPC.hotkeyProblem, hotkeyProblem),
  )
  ipcMain.on(IPC.talkState, (_event, state: unknown) => {
    if (state === 'idle' || state === 'listening' || state === 'transcribing') {
      windows.dot.webContents.send(IPC.talkState, state)
    }
  })
  ipcMain.on(IPC.openPanelQuietly, () => windows.openPanel({ focus: false }))
  app.on('will-quit', () => {
    unregisterAll()
    stt.stop()
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
 * `--open-panel` opens the panel on start; add `--expand-first` or `--menu-first` to also
 * expand the first row or open its right-click menu.
 */
function devAids(windows: WindowManager): void {
  const flag = (name: string) => process.argv.includes(name)
  if (!flag('--open-panel')) return
  windows.panel.webContents.once('did-finish-load', () =>
    setTimeout(() => {
      windows.openPanel()
      const row = "document.querySelector('[aria-expanded]')"
      if (flag('--expand-first'))
        void windows.panel.webContents.executeJavaScript(`${row}?.click()`)
      if (flag('--menu-first')) {
        // After the panel's own "just opened" reset, which would otherwise close it again.
        setTimeout(() => {
          void windows.panel.webContents.executeJavaScript(
            `${row}?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 50 }))`,
          )
        }, 300)
      }
    }, 1500),
  )
}
