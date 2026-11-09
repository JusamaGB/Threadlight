/// <reference types="vite/client" />
import { BrowserWindow, type Rectangle } from 'electron'
import documentHtml from './caption.html?raw'

// The website is a separate native surface above the panel renderer. Paint
// private speech in our own click-through window, never in the website's DOM.
export class BrowserCaption {
  private window?: BrowserWindow
  private ready = false
  private text = ''
  private painted = ''
  private revision = 0
  constructor(private panel: BrowserWindow) {}

  dispose() {
    this.window?.destroy()
  }

  update(text: string, stage?: Rectangle) {
    if (!text || !stage || stage.width < 36 || stage.height < 16 || !this.panel.isVisible()) {
      this.text = ''
      this.revision++
      this.painted = ''
      if (this.window?.isVisible()) this.window.hide()
      return
    }
    this.text = text
    if (!this.window) {
      const win = new BrowserWindow({
        parent: this.panel,
        show: false,
        frame: false,
        transparent: true,
        focusable: false,
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        fullscreenable: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      })
      this.window = win
      win.setIgnoreMouseEvents(true)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (event) => event.preventDefault())
      win.once('closed', () => {
        this.window = undefined
        this.ready = false
        this.painted = ''
        this.revision++
      })
      void win
        .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(documentHtml))
        .then(() => {
          if (this.window !== win) return
          this.ready = true
          this.paint()
        })
        .catch(() => {
          if (!win.isDestroyed()) win.destroy()
        })
    }
    const origin = this.panel.getContentBounds()
    const width = Math.round((stage.width * 2) / 3)
    const bounds = {
      x: origin.x + stage.x + Math.round((stage.width - width) / 2),
      y: origin.y + stage.y,
      width,
      height: Math.min(48, stage.height),
    }
    const previous = this.window.getBounds()
    if (previous.width !== width) this.painted = ''
    if (
      previous.x !== bounds.x ||
      previous.y !== bounds.y ||
      previous.width !== width ||
      previous.height !== bounds.height
    )
      this.window.setBounds(bounds)
    this.paint()
  }

  private paint() {
    const win = this.window
    if (!this.ready || !win || !this.text || this.text === this.painted) return
    const revision = ++this.revision
    this.painted = this.text
    const words = JSON.stringify(this.text)
    void win.webContents
      .executeJavaScript(
        `{
      const line = document.getElementById('words');
      line.textContent = ${words};
      line.scrollTop = line.scrollHeight;
    }`,
      )
      .then(() => {
        if (
          this.revision === revision &&
          !win.isDestroyed() &&
          this.panel.isVisible() &&
          !win.isVisible()
        )
          win.showInactive()
      })
      .catch(() => {})
  }
}
