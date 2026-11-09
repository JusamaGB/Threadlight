const vscode = require('vscode')
const { basename } = require('node:path')
const { sourceChanges } = require('./proposalReview.cjs')
const scheme = 'threadlight-file-review'
const uriKey = (uri) => uri?.toString()
const xml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function displayText(text, tabSize) {
  let expanded = ''
  for (const char of text)
    expanded += char === '\t' ? ' '.repeat(tabSize - (expanded.length % tabSize)) : char
  return expanded
}

function metrics(q) {
  const cfg = vscode.workspace.getConfiguration('editor', q.doc),
    size = cfg.get('fontSize', 14)
  const configured = cfg.get('lineHeight', 0)
  const line = Math.max(
    8,
    Math.round(configured === 0 ? size * 1.35 : configured < 8 ? size * configured : configured),
  )
  const lensSize = cfg.get('codeLensFontSize', 0)
  const lens = Math.max(
    5,
    Math.floor((lensSize >= 5 ? lensSize : Math.floor(size * 0.9)) * Math.max(1.3, line / size)),
  )
  const tab = Number(q.editor.options.tabSize) || 4
  let longest = 1
  const measure = (text) => {
    longest = Math.max(longest, Array.from(displayText(text, tab)).length)
  }
  for (const range of q.editor.visibleRanges)
    for (let i = range.start.line; i <= Math.min(range.end.line, q.doc.lineCount - 1); i++)
      measure(q.doc.lineAt(i).text)
  const sourceColumns = longest
  for (const row of q.rows) measure(row.text)
  return {
    size,
    line,
    lens,
    tab,
    sourceColumns,
    highlightLine: ['line', 'all'].includes(cfg.get('renderLineHighlight', 'line')),
    font: cfg.get('fontFamily', 'Consolas, monospace'),
    // Leave room in the image for wide fonts. Each visible fill is sized in
    // the editor font's own character units, independently of the canvas.
    width: Math.ceil((longest + 5) * size * 0.8),
  }
}

// Only claim empty space. A native CodeLens supplies one row before a real
// source line. A further addition may use an existing blank line. More complex
// hunks use a read-only file review instead of painting over unrelated source.
function inlinePlan(q, changes) {
  const bands = new Map(),
    lenses = new Set()
  function at(line) {
    if (!bands.has(line)) bands.set(line, {})
    return bands.get(line)
  }
  for (const [line, old] of changes.originals) at(line).old = old
  for (const [boundary, added] of changes.insertions) {
    if (boundary === q.doc.lineCount) {
      if (
        added.length > 2 ||
        !vscode.workspace.getConfiguration('editor', q.doc).get('scrollBeyondLastLine', true)
      )
        return
      at(boundary).tail = added
      continue
    }
    const next = boundary + 1
    lenses.add(next)
    at(next).prefix = added[0]
    if (added.length > 1) {
      if (added.length !== 2 || q.doc.lineAt(next - 1).text !== '' || changes.originals.has(next))
        return
      at(next).addition = added[1]
    }
  }
  return { bands, lenses }
}

function artwork(metrics, entries, gutter = '', current = false) {
  const { size, line, lens, tab, font } = metrics,
    prefix = entries.prefix ? lens : 0
  const light = [vscode.ColorThemeKind.Light, vscode.ColorThemeKind.HighContrastLight].includes(
    vscode.window.activeColorTheme.kind,
  )
  const gutterWidth = gutter ? (gutter.length + 1) * size * 0.6 : 0
  const width = metrics.width + gutterWidth,
    height = prefix + line * (1 + (entries.tail?.length ?? 0))
  const ink = light ? '#373737' : '#ddd'
  const shapes = []
  const gradients = []
  function background(id, color, opacity, columns, y, height) {
    const end = columns + (gutter ? gutter.length + 1 : 0) + 0.5
    const extent = end + 4
    gradients.push(
      `<linearGradient id="${id}"><stop stop-color="${color}" stop-opacity="${opacity}"/><stop offset="${end / extent}" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`,
    )
    shapes.push(`<rect y="${y}" width="${extent}ch" height="${height}" fill="url(#${id})"/>`)
  }
  if (current && metrics.highlightLine)
    background('current', light ? '#444' : '#bbb', '.105', metrics.sourceColumns, prefix, line)
  function paint(row, y, h, proposedText) {
    if (!row) return
    const removed = row.kind === 'remove'
    background(
      (removed ? 'removed' : 'added') + y,
      removed ? '#d35c69' : '#439c69',
      '.16',
      Array.from(displayText(row.text, tab)).length,
      y + 1,
      Math.max(1, h - 2),
    )
    if (!proposedText) return
    let text = row.text
    if (row.parts && /^ +$/.test(row.parts[1]))
      text = row.parts[0] + '·'.repeat(row.parts[1].length) + row.parts[2]
    const point = Math.min(size, h)
    shapes.push(
      `<text y="${y + (h - point) / 2 + point * 0.82}" fill="${ink}" font-family="${xml(font)}" font-size="${point}" xml:space="preserve">${xml(displayText(text, tab))}</text>`,
    )
  }
  paint(entries.prefix, 0, lens, true)
  paint(entries.old || entries.addition, prefix, line, !!entries.addition && !gutter)
  for (const [i, row] of (entries.tail ?? []).entries())
    paint(row, prefix + (i + 1) * line, line, true)
  if (gutter)
    shapes.push(
      `<text x="${gutterWidth - size * 0.6}" text-anchor="end" y="${line / 2 + size * 0.33}" font-size="${size}" font-family="${xml(font)}" fill="${ink}" xml:space="preserve">${xml(gutter)}</text>`,
    )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-family="${xml(font)}" font-size="${size}" width="${width}" height="${height}"><defs>${gradients.join('')}</defs>${shapes.join('')}</svg>`
  return {
    contentIconPath: vscode.Uri.parse(
      'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
    ),
    width: width + 'px',
    height: height + 'px',
    verticalAlign: 'top',
    margin: `-${prefix}px -${width - gutterWidth}px ${prefix + line - height}px 0`,
  }
}

function fileRows(q, changes, result) {
  const rows = []
  for (let line = 0; line <= q.doc.lineCount; line++) {
    const old = changes.originals.get(line)
    if (line && !(old && result))
      rows.push(old ?? { kind: 'context', line, text: q.doc.lineAt(line - 1).text })
    rows.push(...(changes.insertions.get(line) ?? []))
  }
  return rows
}

function createProposalSurface(context, invalidate) {
  const emitter = new vscode.EventEmitter(),
    docs = new Map()
  const layer = vscode.window.createTextEditorDecorationType({})
  const currentLine = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.background'),
  })
  const changed = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
  })
  const walkMark = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    border: '1px solid',
    borderColor: new vscode.ThemeColor('focusBorder'),
  })
  let active
  const provider = vscode.languages.registerCodeLensProvider('*', {
    onDidChangeCodeLenses: emitter.event,
    provideCodeLenses(doc) {
      if (!active?.plan || active.q.doc !== doc) return []
      const lenses = [...active.plan.lenses].map(
        (line) =>
          new vscode.CodeLens(new vscode.Range(line - 1, 0, line - 1, 0), {
            command: '',
            title: '',
          }),
      )
      active.ready?.()
      return lenses
    },
  })
  const content = vscode.workspace.registerTextDocumentContentProvider(scheme, {
    provideTextDocumentContent: (uri) =>
      docs
        .get(uriKey(uri))
        ?.map((row) => row.text)
        .join('\n') ?? '',
  })
  function draw() {
    if (!active?.plan || !vscode.window.visibleTextEditors.includes(active.q.editor)) return
    const { q, plan } = active,
      geometry = metrics(q)
    const layers = [],
      marks = []
    const cursor = q.editor.selection.active.line
    const bands = new Map(plan.bands)
    if (geometry.highlightLine && !bands.has(cursor + 1)) bands.set(cursor + 1, {})
    q.editor.setDecorations(currentLine, geometry.highlightLine ? [q.doc.lineAt(cursor).range] : [])
    for (const [line, band] of bands) {
      const anchor = new vscode.Range(line - 1, 0, line - 1, 0)
      layers.push({
        range: anchor,
        renderOptions: { before: artwork(geometry, band, '', line === cursor + 1) },
      })
      if (band.old?.parts?.[1]) {
        const [before, removed] = band.old.parts
        marks.push(
          new vscode.Range(line - 1, before.length, line - 1, before.length + removed.length),
        )
      }
    }
    q.editor.setDecorations(layer, layers)
    q.editor.setDecorations(changed, marks)
  }
  function isPreview(editor, q) {
    return !!q?.preview && uriKey(editor?.document.uri) === uriKey(q.preview)
  }
  async function closePreview(q) {
    const uri = q.preview
    if (!uri) return
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((t) => uriKey(t.input?.uri) === uriKey(uri))
    q.preview = undefined
    docs.delete(uriKey(uri))
    if (tab) await vscode.window.tabGroups.close(tab, true)
  }
  async function source(q) {
    if (!q.preview) return
    q.returning = true
    try {
      if (isPreview(vscode.window.activeTextEditor, q)) {
        q.editor = await vscode.window.showTextDocument(q.doc, {
          viewColumn: q.column,
          preserveFocus: false,
        })
      }
      await closePreview(q)
    } finally {
      q.returning = false
    }
  }
  async function openPreview(q, result) {
    const state = active
    if (!state || state.q !== q) return
    await source(q)
    if (active !== state || q.doc.isClosed || q.doc.version !== q.version)
      throw Error('The source changed during review.')
    const rows = fileRows(q, state.changes, result)
    const name = basename(q.doc.fileName)
    const uri = vscode.Uri.from({
      scheme,
      path: '/' + (result ? 'Result' : 'Review') + '/' + name,
      query: q.token,
    })
    q.preview = uri
    docs.set(uriKey(uri), rows)
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.languages.setTextDocumentLanguage(doc, q.doc.languageId)
    if (active !== state || q.doc.version !== q.version || uriKey(q.preview) !== uriKey(uri))
      throw Error('Review interrupted.')
    const ed = await vscode.window.showTextDocument(doc, {
      viewColumn: q.column,
      preserveFocus: false,
      preview: false,
    })
    if (active !== state || uriKey(q.preview) !== uriKey(uri)) return
    let index = result
      ? Math.min(q.target.start.line, rows.length - 1)
      : rows.findIndex((row) => row.kind !== 'context')
    index = Math.max(0, index)
    q.previewAnchor = new vscode.Position(index, 0)
    if (!result) {
      ed.options = { lineNumbers: vscode.TextEditorLineNumbersStyle.Off }
      drawPreview(ed)
    }
    ed.selection = new vscode.Selection(q.previewAnchor, q.previewAnchor)
    ed.revealRange(ed.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  }
  async function focusRow(q, row) {
    // Inline additions can share one source position. The read-only review gives
    // every added and removed row its own selectable editor line.
    if (!q.preview || (q.result && row.kind === 'remove')) {
      q.result = false
      await openPreview(q, false)
    }
    const editor = vscode.window.activeTextEditor
    if (active?.q !== q || !isPreview(editor, q)) return false
    const index = docs.get(uriKey(q.preview))?.indexOf(row) ?? -1
    if (index < 0) return false
    const range = editor.document.lineAt(index).range
    q.previewAnchor = range.start
    editor.selection = new vscode.Selection(range.start, range.end)
    editor.setDecorations(walkMark, [range])
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    for (let i = 0; i < 12; i++) {
      if (active?.q !== q || vscode.window.activeTextEditor !== editor) return false
      if (editor.visibleRanges.some((visible) => visible.contains(range.start))) return true
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    return false
  }
  function drawPreview(ed) {
    const q = active?.q
    if (!isPreview(ed, q) || q.result) return
    const rows = docs.get(uriKey(q.preview))
    if (!rows) return
    const geometry = metrics(q)
    geometry.width = Math.min(8192, geometry.width)
    const digits = String(q.doc.lineCount).length
    const decorations = []
    const cursor = ed.selection.active.line
    ed.setDecorations(currentLine, geometry.highlightLine ? [ed.document.lineAt(cursor).range] : [])
    for (const range of ed.visibleRanges)
      for (let i = range.start.line; i <= Math.min(rows.length - 1, range.end.line); i++) {
        const row = rows[i]
        const gutter =
          row.kind === 'add'
            ? '+'.padStart(digits + 2)
            : String(row.line).padStart(digits) + (row.kind === 'remove' ? ' −' : '  ')
        decorations.push({
          range: new vscode.Range(i, 0, i, 0),
          renderOptions: {
            before: artwork(
              geometry,
              row.kind === 'remove' ? { old: row } : row.kind === 'add' ? { addition: row } : {},
              gutter,
              i === cursor,
            ),
          },
        })
      }
    ed.setDecorations(layer, decorations)
  }
  function clear() {
    const previous = active
    active = undefined
    previous?.ready?.()
    if (previous) {
      if (vscode.window.visibleTextEditors.includes(previous.q.editor)) {
        previous.q.editor.setDecorations(layer, [])
        previous.q.editor.setDecorations(changed, [])
        previous.q.editor.setDecorations(currentLine, [])
      }
      emitter.fire()
      void closePreview(previous.q)
    }
  }
  async function show(q) {
    clear()
    const state = (active = { q, changes: sourceChanges(q.rows) })
    const cfg = vscode.workspace.getConfiguration('editor', q.doc)
    let plan =
      cfg.get('wordWrap', 'off') === 'off' && metrics(q).width <= 8192
        ? inlinePlan(q, state.changes)
        : undefined
    if (plan?.lenses.size && cfg.get('codeLens', true)) {
      let timer
      const existing = await Promise.race([
        vscode.commands.executeCommand('vscode.executeCodeLensProvider', q.doc.uri),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 1500)
        }),
      ]).catch(() => undefined)
      clearTimeout(timer)
      if (!existing || existing.some((lens) => plan.lenses.has(lens.range.start.line + 1)))
        plan = undefined
    }
    if (active !== state || q.doc.version !== q.version) throw Error('Review interrupted.')
    if (
      (!cfg.get('codeLens', true) && plan?.lenses.size) ||
      cfg.get('accessibilitySupport') === 'on'
    )
      plan = undefined
    if (plan) {
      state.plan = plan
      if (plan.lenses.size) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            state.plan = undefined
            resolve()
          }, 1800)
          state.ready = () => {
            clearTimeout(timer)
            resolve()
          }
          emitter.fire()
        })
        state.ready = undefined
      }
      if (active !== state) throw Error('Review interrupted.')
      if (state.plan) {
        draw()
        return
      }
    }
    await openPreview(q, false)
  }
  context.subscriptions.push(
    { dispose: clear },
    provider,
    content,
    layer,
    currentLine,
    changed,
    walkMark,
    emitter,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!active || !event.affectsConfiguration('editor', active.q.doc.uri)) return
      if (
        active.plan?.lenses.size &&
        !vscode.workspace.getConfiguration('editor', active.q.doc).get('codeLens', true)
      ) {
        const q = active.q
        active.plan = undefined
        emitter.fire()
        q.editor.setDecorations(layer, [])
        q.editor.setDecorations(changed, [])
        q.editor.setDecorations(currentLine, [])
        if (!q.result) void openPreview(q, false).catch(() => invalidate(q))
      } else draw()
    }),
    vscode.window.onDidChangeActiveColorTheme(draw),
    vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor }) => {
      if (active?.plan && active.q.editor === textEditor) draw()
      else drawPreview(textEditor)
    }),
    vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
      if (active?.plan && active.q.editor === textEditor) draw()
      else drawPreview(textEditor)
    }),
  )
  return {
    show,
    clear,
    source,
    isPreview,
    focusRow,
    hasInline: (q) => active?.q === q && !!active.plan,
    redraw(q) {
      if (active?.q === q) draw()
    },
    async result(q, on) {
      if (on || !active?.plan) await openPreview(q, on)
      else {
        await source(q)
        draw()
      }
    },
  }
}
module.exports = { createProposalSurface }
