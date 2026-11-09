const vscode = require('vscode')

function practiceRange(editor, command) {
  const doc = editor.document
  if (command.scope === 'selection') {
    if (editor.selections.length !== 1 || editor.selection.isEmpty)
      throw Error('Select the code to practise and read fresh context.')
    return editor.selection
  }
  const start = command.line ?? 1
  const end = command.endLine ?? doc.lineCount
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > doc.lineCount
  )
    throw Error('Choose a practice range within the active file.')
  return new vscode.Range(new vscode.Position(start - 1, 0), doc.lineAt(end - 1).range.end)
}

function sourceRows(doc, range) {
  const rows = []
  for (let i = range.start.line; i <= range.end.line; i++) {
    if (i > range.start.line && i === range.end.line && range.end.character === 0) break
    const text = doc
      .lineAt(i)
      .text.slice(
        i === range.start.line ? range.start.character : 0,
        i === range.end.line ? range.end.character : undefined,
      )
    if (text.length > 12000)
      throw Error('Choose an exercise with lines of at most 12,000 characters.')
    rows.push({ line: i + 1, text })
  }
  return rows
}

// Practice keystrokes advance across existing characters without touching the buffer or Undo.
function attachSourcePractice(editor, rows, range, { connected, select, speak, stop }) {
  const origin = range.start.line
  const progress = new Map()
  const dim = vscode.window.createTextEditorDecorationType({ opacity: '0.55' })
  function startColumn(i) {
    return i === 0 ? range.start.character : 0
  }
  function move(i, column) {
    const at = new vscode.Position(origin + i, column)
    editor.selection = new vscode.Selection(at, at)
    editor.revealRange(
      new vscode.Range(at, at),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    )
  }
  function draw() {
    const ranges = []
    for (const visible of editor.visibleRanges) {
      const end = Math.min(rows.length - 1, visible.end.line - origin)
      for (let i = Math.max(0, visible.start.line - origin); i <= end; i++) {
        const start = startColumn(i)
        const from = progress.get(i) ?? 0
        if (from < rows[i].text.length)
          ranges.push(
            new vscode.Range(origin + i, start + from, origin + i, start + rows[i].text.length),
          )
      }
    }
    editor.setDecorations(dim, ranges)
  }
  function cursor() {
    const selection = editor.selection
    const i = selection.active.line - origin
    if (
      vscode.window.activeTextEditor !== editor ||
      !connected() ||
      editor.selections.length !== 1 ||
      !selection.isEmpty ||
      !rows[i]
    )
      return
    const offset = selection.active.character - startColumn(i)
    if (offset < 0 || offset > rows[i].text.length) return
    return { i, offset, text: rows[i].text }
  }
  function reveal(i, end) {
    progress.set(i, end)
    move(i, startColumn(i) + end)
    draw()
  }
  function type(args) {
    const c = cursor()
    if (!c || typeof args?.text !== 'string') {
      stop()
      return vscode.commands.executeCommand('default:type', args)
    }
    select(c.i)
    const tail = c.text.slice(c.offset)
    // Permit starting directly on the first token of an indented line.
    const indent = /^\s*/u.exec(tail)[0].length
    const skip =
      !c.text.slice(0, c.offset).trim() &&
      args.text.trim() &&
      tail.slice(indent).startsWith(args.text)
        ? indent
        : 0
    if (!tail.slice(skip).startsWith(args.text)) {
      vscode.window.setStatusBarMessage(
        'Trace the dimmed text, or press Esc to return to editing.',
        1600,
      )
      return
    }
    reveal(c.i, c.offset + skip + args.text.length)
    if (args.text.trim() && !c.text.slice(0, c.offset).trim()) speak(c.i)
  }
  let typing
  try {
    typing = vscode.commands.registerCommand('type', type)
  } catch (error) {
    dim.dispose()
    throw Error(
      'VS Code could not start tracing because another extension controls typing. ' + error.message,
      { cause: error },
    )
  }
  return {
    draw,
    start() {
      move(0, startColumn(0))
      draw()
    },
    next() {
      const i = editor.selection.active.line - origin + 1
      if (i >= rows.length || i < 0) return stop()
      select(i)
      move(i, startColumn(i) + (progress.get(i) ?? 0))
    },
    back() {
      const c = cursor()
      if (!c) {
        stop()
        return vscode.commands.executeCommand('deleteLeft')
      }
      const previous = Array.from(c.text.slice(0, c.offset)).at(-1)
      if (previous) reveal(c.i, c.offset - previous.length)
    },
    indent() {
      const c = cursor()
      if (!c) {
        stop()
        return vscode.commands.executeCommand('tab')
      }
      const spaces = /^\s+/u.exec(c.text.slice(c.offset))
      if (spaces) reveal(c.i, c.offset + spaces[0].length)
    },
    selected(selection, kind) {
      const i = selection.start.line - origin
      if (!rows[i]) return stop()
      select(i)
      if (!selection.isEmpty && kind === vscode.TextEditorSelectionChangeKind.Mouse)
        move(i, startColumn(i) + (progress.get(i) ?? 0))
    },
    dispose() {
      typing.dispose()
      dim.dispose()
    },
  }
}

module.exports = { practiceRange, sourceRows, attachSourcePractice }
