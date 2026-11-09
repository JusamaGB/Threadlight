'use strict'
const vscode = require('vscode')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { createInterface } = require('node:readline')
const path = require('node:path')

// Only annotated rows get a pin. While moving a card, the other visible rows
// temporarily get markers so the drop can resolve the exact native editor row.
class Overlay {
  constructor(context, notes, patch, report) {
    this.context = context
    this.notes = notes
    this.patch = patch
    this.report = report
    this.prefix = 0x207080 | (randomBytes(3).readUIntBE(0, 3) & 0x3f3f3f)
    this.types = []
    this.drag = false
    this.documents = new Map()
  }
  type(i) {
    if (!this.types[i]) {
      const hex = (n) => n.toString(16).padStart(6, '0')
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path fill="#' +
        hex(this.prefix) +
        '" d="M0 4h6v4H0z"/><path fill="#' +
        hex(this.color(i)) +
        '" d="M6 4h6v4H6z"/></svg>'
      this.types[i] = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.parse(
          'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
        ),
        gutterIconSize: 'auto',
      })
    }
    return this.types[i]
  }
  color(i) {
    return 0x905040 + i * 17
  }
  refresh() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.draw(), 12)
  }
  focus(id) {
    this.focusId = id
    this.refresh()
  }
  start() {
    if (this.proc || this.failed) return
    const exe = path.join(this.context.extensionPath, 'dist', 'MarginNotes.exe')
    const proc = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    const lines = createInterface({ input: proc.stdout })
    lines.on('line', (line) => {
      let m
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
      if (m.type === 'drag') {
        this.drag = Boolean(m.active)
        this.refresh()
        return
      }
      if (m.type === 'focused' && this.focusId === m.id) this.focusId = null
      if (m.type === 'unlocated' && this.focusId === m.id) {
        this.focusId = null
        this.refresh()
        vscode.window.showInformationMessage(
          'Your annotation is saved. The overlay could not locate its gutter mark. Bring its line into view and use Margin Notes: Find Annotation to try again.',
        )
      }
      if (m.type === 'patch' || m.type === 'delete') {
        const doc = this.documents.get(m.uri)
        if (doc && !doc.isClosed) this.patch(doc, m.id, m.patch || {}, m.type === 'delete')
      }
    })
    proc.stdin.on('error', () => {})
    const failed = (e) => {
      if (this.disposed || this.failed) return
      this.failed = true
      this.report(e)
    }
    proc.on('error', failed)
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null
      if (code !== 0) failed(new Error('The Windows card window stopped. Your notes are saved.'))
    })
    proc.stderr.resume()
  }
  draw() {
    if (this.disposed || process.platform !== 'win32') return
    const ed = vscode.window.activeTextEditor
    if (this.last && this.last !== ed) this.types.forEach((t) => this.last.setDecorations(t, []))
    this.last = ed
    const all = ed ? this.notes(ed.document) : []
    if (all.length) this.start()
    if (!this.proc || this.proc.stdin.destroyed) return
    const ranges = ed?.visibleRanges || []
    const visible = (line) => ranges.some((r) => line >= r.start.line && line <= r.end.line)
    const cards = all.filter((n) => visible(n.line))
    const wanted = new Set(cards.map((n) => n.line))
    if (this.drag && ed)
      for (const r of ranges) for (let i = r.start.line; i <= r.end.line; i++) wanted.add(i)
    const lines = [...wanted].sort((a, b) => a - b)
    const markers = lines.map((line, i) => {
      const range = new vscode.Range(line, 0, line, 0)
      ed.setDecorations(this.type(i), [range])
      return { line, color: this.color(i) }
    })
    if (ed)
      for (let i = lines.length; i < this.types.length; i++) ed.setDecorations(this.types[i], [])
    if (ed) this.documents.set(ed.document.uri.toString(), ed.document)
    for (const [uri, doc] of this.documents) if (doc.isClosed) this.documents.delete(uri)
    const theme = vscode.window.activeColorTheme.kind
    const config = vscode.workspace.getConfiguration(
      'editor',
      ed && { uri: ed.document.uri, languageId: ed.document.languageId },
    )
    const zoom = vscode.workspace.getConfiguration('window').get('zoomLevel', 0)
    const data = {
      uri: ed?.document.uri.toString() || '',
      cards,
      markers,
      prefix: this.prefix,
      fontFamily: config.get('fontFamily', 'Consolas, monospace'),
      fontSize: config.get('fontSize', 14) * Math.pow(1.2, zoom),
      dark: theme === vscode.ColorThemeKind.Dark || theme === vscode.ColorThemeKind.HighContrast,
      focus: this.focusId || '',
      pid: Number(process.env.VSCODE_PID) || 0,
      active: vscode.window.state.focused,
    }
    this.proc.stdin.write(JSON.stringify(data) + '\n')
  }
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    this.types.forEach((t) => t.dispose())
    this.proc?.stdin.end()
  }
}
module.exports = { Overlay }
