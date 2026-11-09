const vscode = require('vscode')

function createInlinePreview(context, connected) {
  const commands = vscode.commands
  const controller = vscode.comments.createCommentController(
    'threadlight.coach',
    'Threadlight Coach',
  )
  const mark = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
    textDecoration: 'line-through',
  })
  let preview
  function keys(active, alternatives) {
    return Promise.all([
      commands.executeCommand('setContext', 'threadlight.coach.preview', active),
      commands.executeCommand('setContext', 'threadlight.coach.alternatives', alternatives),
    ])
  }
  function clear() {
    const p = preview
    if (!p) return
    preview = undefined
    void keys(false, false)
    p.thread.dispose()
    if (vscode.window.visibleTextEditors.includes(p.editor)) p.editor.setDecorations(mark, [])
  }
  function matches(s) {
    return (
      connected() &&
      vscode.workspace.isTrusted &&
      s.editor === vscode.window.activeTextEditor &&
      s.version === s.editor.document.version &&
      s.selection &&
      s.editor.selections.length === 1 &&
      s.selection.isEqual(s.editor.selection) &&
      s.selection.isReversed === s.editor.selection.isReversed &&
      s.editor.document.getText(s.selection) === s.selectedText
    )
  }
  function render(p) {
    const text = p.versions[p.index]
    const runs = text.match(/`+/g) || []
    const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3))
    const lang = p.editor.document.languageId.replace(/[^a-zA-Z0-9_+-]/g, '')
    const body = new vscode.MarkdownString(
      text ? fence + lang + '\n' + text + '\n' + fence : '*Delete the selection*',
    )
    const multiple = p.versions.length > 1
    p.thread.label =
      'Threadlight · ' +
      (multiple ? p.index + 1 + '/' + p.versions.length + ' · ← → versions · ' : '') +
      'Tab accept · Esc dismiss'
    p.thread.comments = [
      { body, mode: vscode.CommentMode.Preview, author: { name: 'Proposed replacement' } },
    ]
    p.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded
  }
  async function show(s, replacements) {
    if (!matches(s))
      throw Error('Select one nonempty range inside the excerpt and request fresh context.')
    if (
      !Array.isArray(replacements) ||
      replacements.length < 1 ||
      replacements.length > 3 ||
      !replacements.every((text) => typeof text === 'string' && text.length <= 12000)
    )
      throw Error('Provide one to three bounded replacements.')
    if (vscode.workspace.getConfiguration('comments').get('visible') === false)
      throw Error('Enable visible editor comments in VS Code to see an inline preview.')
    const eol = s.editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
    const versions = [...new Set(replacements.map((text) => text.replace(/\r\n?|\n/g, eol)))]
    clear()
    const thread = controller.createCommentThread(s.editor.document.uri, s.selection, [])
    const p = (preview = {
      ...s,
      document: s.editor.document,
      column: s.editor.viewColumn,
      thread,
      versions,
      index: 0,
    })
    try {
      thread.canReply = false
      render(p)
      p.editor.setDecorations(mark, [s.selection])
      p.editor.revealRange(s.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      await keys(true, versions.length > 1)
      if (current() !== p) throw Error('Source changed. Request a fresh preview.')
      return { preview: true, alternatives: versions.length, awaitingEditorAcceptance: true }
    } catch (error) {
      if (preview === p) clear()
      throw error
    }
  }
  function current() {
    const p = preview
    if (!p) return
    if (
      !connected() ||
      !vscode.workspace.isTrusted ||
      p.document.isClosed ||
      p.version !== p.document.version ||
      p.document.getText(p.selection) !== p.selectedText
    ) {
      clear()
      return
    }
    const editor = vscode.window.activeTextEditor
    if (editor?.document === p.document && editor.viewColumn === p.column) {
      p.editor = editor
      return p
    }
  }
  function cycle(delta) {
    const p = current()
    if (!p) return
    p.index = (p.index + delta + p.versions.length) % p.versions.length
    render(p)
  }
  async function accept() {
    const p = current()
    if (!p) return
    clear()
    const applied = await p.editor.edit((edit) => edit.replace(p.selection, p.versions[p.index]), {
      undoStopBefore: true,
      undoStopAfter: true,
    })
    if (!applied)
      void vscode.window.showWarningMessage('VS Code declined the edit. Request a fresh preview.')
  }
  context.subscriptions.push(
    controller,
    mark,
    commands.registerCommand('threadlight.coach.accept', accept),
    commands.registerCommand('threadlight.coach.dismiss', clear),
    commands.registerCommand('threadlight.coach.previous', () => cycle(-1)),
    commands.registerCommand('threadlight.coach.following', () => cycle(1)),
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (!preview) return
      const p = current()
      void keys(!!p, !!p && p.versions.length > 1)
      if (p) p.editor.setDecorations(mark, [p.selection])
    }),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (preview?.document === document) current()
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (preview?.editor.document === doc) clear()
    }),
  )
  return { clear, show, active: () => !!preview }
}
module.exports = { createInlinePreview }
