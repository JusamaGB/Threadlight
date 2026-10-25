import { join } from 'node:path'

import { BrowserWindow, screen, shell } from 'electron'

export const DOT_SIZE = 22
const MARGIN = 8

/** Shared hardening for every window: no navigation away, no pop-ups, links open in the browser. */
function harden(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function loadView(win: BrowserWindow, view: 'dot'): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void win.loadURL(`${devServer}?view=${view}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

/** The status dot: tiny, frameless, transparent, always on top, never in the taskbar. */
export function createDotWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: DOT_SIZE,
    height: DOT_SIZE,
    x: workArea.x + workArea.width - DOT_SIZE - MARGIN,
    y: workArea.y + MARGIN,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // 'screen-saver' keeps it above full-screen windows such as borderless games.
  win.setAlwaysOnTop(true, 'screen-saver')
  harden(win)
  win.once('ready-to-show', () => win.showInactive())
  loadView(win, 'dot')
  return win
}
