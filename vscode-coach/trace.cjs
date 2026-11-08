const vscode = require('vscode')

function createTrace(context, connected) {
  let active
  const commands = vscode.commands
  function clear() {
    if (!active) return
    const old = active
    active = undefined
    clearTimeout(old.timer)
    old.provider.dispose()
    void commands.executeCommand('setContext', 'threadlight.coach.trace', false)
    if (old.offered && old.editor === vscode.window.activeTextEditor)
      void commands.executeCommand('editor.action.inlineSuggest.hide')
  }

  // The tracked span is only text the learner inserted at this anchor. VS Code
  // may insert a paired closing character on the far side of the caret.
  function remaining(t, position) {
    const doc = t.editor.document
    const caret = doc.offsetAt(position)
    if (caret < t.start || caret > t.start + t.length) return
    const prefix = doc.getText(new vscode.Range(doc.positionAt(t.start), position))
    const suffix = doc.getText(new vscode.Range(position, doc.positionAt(t.start + t.length)))
    if (!t.text.startsWith(prefix)) return
    const rest = t.text.slice(prefix.length)
    if (!suffix) return rest
    const close = rest.indexOf(suffix)
    return close < 0 ? undefined : rest.slice(0, close)
  }
  function valid(t) {
    return (
      active === t &&
      t.editor === vscode.window.activeTextEditor &&
      connected() &&
      vscode.workspace.isTrusted &&
      !t.editor.document.isClosed
    )
  }
  function refresh(t) {
    clearTimeout(t.timer)
    t.timer = setTimeout(() => {
      if (active !== t) return
      if (!valid(t) || t.editor.selections.length !== 1 || !t.editor.selection.isEmpty)
        return clear()
      const rest = remaining(t, t.editor.selection.active)
      if (rest === undefined) return clear()
      // VS Code carries matching ghost text through normal typing. Re-triggering
      // the explicit command here also replays its accessibility sound on every
      // edit or caret move. Only the initial, requested trace needs that command.
    }, 45)
  }
  function inspect(editor) {
    const t = active
    if (!t || t.editor !== editor || !valid(t)) return
    const doc = editor.document
    t.checkedVersion = doc.version
    const from = doc.positionAt(t.start)
    return {
      line: from.line + 1,
      column: from.character,
      suggestion: t.text,
      typed: doc.getText(new vscode.Range(from, doc.positionAt(t.start + t.length))),
    }
  }
  async function show(s, anchor, text) {
    const editor = s.editor
    const doc = editor.document
    if (
      !s.traceEligible ||
      editor.selections.length !== 1 ||
      !s.cursorSelection.isEqual(editor.selection) ||
      s.cursorSelection.isReversed !== editor.selection.isReversed ||
      !connected() ||
      !vscode.workspace.isTrusted ||
      editor !== vscode.window.activeTextEditor ||
      doc.version !== s.version
    )
      throw Error('Read fresh context from the intended editor before placing a trace.')
    if (
      !anchor ||
      !Number.isInteger(anchor.line) ||
      anchor.line < s.first ||
      anchor.line > s.last ||
      !Number.isInteger(anchor.column) ||
      anchor.column < 0 ||
      doc.lineAt(anchor.line - 1).text !== anchor.expectedLine ||
      anchor.column > anchor.expectedLine.length ||
      /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(
        anchor.expectedLine.slice(Math.max(0, anchor.column - 1), anchor.column + 1),
      ) ||
      typeof text !== 'string' ||
      !text.length ||
      text.length > 2000
    )
      throw Error('Trace needs an exact observed line and a valid insertion column.')
    if (!vscode.workspace.getConfiguration('editor', doc).get('inlineSuggest.enabled', true))
      throw Error('Enable Editor: Inline Suggest Enabled in VS Code to see the trace.')
    clear()
    const at = new vscode.Position(anchor.line - 1, anchor.column)
    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
    const t = (active = {
      editor,
      start: doc.offsetAt(at),
      length: 0,
      version: doc.version,
      text: text.replace(/\r\n?|\n/g, eol),
    })
    t.provider = vscode.languages.registerInlineCompletionItemProvider(
      { scheme: doc.uri.scheme, language: doc.languageId },
      {
        provideInlineCompletionItems(document, position, completionContext) {
          if (
            !valid(t) ||
            document !== doc ||
            document.version !== t.version ||
            editor.selections.length !== 1 ||
            !editor.selection.isEmpty ||
            !position.isEqual(editor.selection.active) ||
            completionContext.selectedCompletionInfo
          )
            return
          const rest = remaining(t, position)
          if (!rest) return
          t.offered = true
          return [
            new vscode.InlineCompletionItem(
              rest.replace(/\r\n/g, '\n'),
              new vscode.Range(position, position),
            ),
          ]
        },
      },
    )
    try {
      editor.selection = new vscode.Selection(at, at)
      editor.revealRange(
        new vscode.Range(at, at),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      )
      await commands.executeCommand('setContext', 'threadlight.coach.trace', true)
      // Moving the caret and registering a provider cross the workbench boundary.
      // Give the editor time to observe both before reporting a failed request.
      for (let attempt = 0; attempt < 4 && !t.offered && valid(t); attempt++) {
        await commands.executeCommand('editor.action.inlineSuggest.trigger')
        if (!t.offered) await new Promise((resolve) => setTimeout(resolve, 75))
      }
      if (!valid(t) || !t.offered)
        throw Error(
          'VS Code did not request the trace at this cursor. Check inline suggestion settings and request it again.',
        )
      return {
        tracing: true,
        line: anchor.line,
        column: anchor.column,
        instruction: 'Let the learner type. Wait for their explicit next step.',
      }
    } catch (error) {
      if (active === t) clear()
      throw error
    }
  }

  context.subscriptions.push(
    commands.registerCommand('threadlight.coach.dismissTrace', clear),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (active && active.editor !== editor) clear()
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (active?.editor.document === doc) clear()
    }),
    vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
      if (active?.editor === textEditor) refresh(active)
    }),
    vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
      const t = active
      if (!t || document !== t.editor.document || !contentChanges.length) return
      const [change] = contentChanges
      if (
        !valid(t) ||
        contentChanges.length !== 1 ||
        document.version !== t.version + 1 ||
        change.rangeOffset < t.start ||
        change.rangeOffset + change.rangeLength > t.start + t.length
      )
        return clear()
      t.length += change.text.length - change.rangeLength
      t.version = document.version
      if (t.length > t.text.length) return clear()
      refresh(t)
    }),
    { dispose: clear },
  )
  return {
    show,
    clear,
    inspect,
    active: () => !!active,
    checked: () => !active || active.checkedVersion === active.editor.document.version,
  }
}
module.exports = { createTrace }
