import { app, ipcMain } from 'electron'

import { IPC } from '../shared/ipc'
import { isClaudeAppRunning, openThread } from './claudeApp'
import { DEFAULT_HOOK_PORT, startHookServer } from './hookServer'
import { HookStateStore } from './sessions/hookState'
import { defaultPaths } from './sessions/paths'
import { SessionService } from './sessions/service'
import { Tracker } from './sessions/tracker'
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
  ipcMain.on(IPC.openInClaude, (_event, appId: unknown) => {
    if (typeof appId === 'string' && openThread(appId)) windows.closePanel()
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
