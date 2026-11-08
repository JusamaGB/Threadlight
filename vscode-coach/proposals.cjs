const vscode = require('vscode')
const { randomUUID } = require('node:crypto')
const { reviewRows, reviewBodies, resultCommand, whyCommand } = require('./proposalReview.cjs')

function readGroups(doc, proposals) {
  const text = doc.getText()
  const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
  const normalize = (s) => s.replace(/\r\n?|\n/g, eol)
  if (
    !Array.isArray(proposals) ||
    !proposals.length ||
    proposals.length > 12 ||
    proposals.some(
      (g) =>
        !g ||
        typeof g.explanation !== 'string' ||
        !g.explanation.trim() ||
        g.explanation.length > 400 ||
        !Array.isArray(g.edits) ||
        !g.edits.length ||
        g.edits.length > 8,
    )
  )
    throw Error('Provide up to twelve explained proposals with up to eight dependent edits each.')
  const all = []
  const groups = proposals.map(({ explanation, edits }, index) => ({
    explanation,
    number: index + 1,
    edits: edits.map(({ line, column, oldText, newText }) => {
      if (
        !Number.isInteger(line) ||
        !Number.isInteger(column) ||
        typeof oldText !== 'string' ||
        typeof newText !== 'string' ||
        oldText.length > 4000 ||
        newText.length > 4000 ||
        line < 1 ||
        line > doc.lineCount ||
        column < 0 ||
        column > doc.lineAt(line - 1).text.length
      )
        throw Error('Proposed location is outside the reviewed source.')
      const start = doc.offsetAt(new vscode.Position(line - 1, column))
      const old = normalize(oldText),
        replacement = normalize(newText)
      const end = start + old.length
      const splitsCharacter = (at) =>
        /[\uD800-\uDBFF]/.test(text.charAt(at - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(at))
      if (
        splitsCharacter(start) ||
        splitsCharacter(end) ||
        text.slice(start, end) !== old ||
        old === replacement ||
        doc.offsetAt(doc.positionAt(end)) !== end
      )
        throw Error('Proposed original text does not match this exact location. Review again.')
      const edit = { start, end, old, replacement }
      all.push(edit)
      return edit
    }),
  }))
  all.sort((a, b) => a.start - b.start)
  if (all.some((e, i) => i && (e.start < all[i - 1].end || e.start === all[i - 1].start)))
    throw Error('Proposed ranges overlap. Combine dependent edits before displaying.')
  return groups
}

function createProposals(context, connected, emit) {
  const controller = vscode.comments.createCommentController('threadlight.proposals', 'Threadlight')
  const oldMark = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
    textDecoration: 'line-through',
  })
  const newMark = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editor.foreground'),
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
      margin: '0 0 0 0.35em',
    },
  })
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 51)
  item.command = 'threadlight.coach.nextProposal'
  let queue, thread
  const setKey = (active) =>
    vscode.commands.executeCommand('setContext', 'threadlight.coach.proposal', active)
  function hide() {
    void vscode.commands.executeCommand('setContext', 'threadlight.coach.remaining', false)
    thread?.dispose()
    thread = undefined
    if (queue) {
      queue.editor.setDecorations(oldMark, [])
      queue.editor.setDecorations(newMark, [])
    }
    item.hide()
    void setKey(false)
  }
  function clear() {
    hide()
    if (queue) emit({ proposalState: { status: 'idle' } })
    queue = undefined
  }
  function current(q) {
    return (
      queue === q &&
      connected(q) &&
      vscode.workspace.isTrusted &&
      q.editor === vscode.window.activeTextEditor &&
      !q.doc.isClosed &&
      q.doc.version === q.version
    )
  }
  function inView(q) {
    return q.editor.visibleRanges.some((range) => range.contains(q.target.start))
  }
  function status() {
    if (queue && !queue.applying && !current(queue)) clear()
    if (!queue) return { status: 'idle' }
    const g = queue.groups[queue.index]
    return {
      status: queue.presentation === 'shown' ? 'shown' : 'pending',
      token: queue.token,
      step: g.number,
      total: queue.total,
      explanation: queue.presentation === 'shown' ? g.explanation : undefined,
      line: queue.doc.positionAt(g.edits[0].start).line + 1,
    }
  }
  function renderReview(q) {
    thread.comments = reviewBodies(vscode, q, q.groups[q.index].explanation).map((body) => ({
      body,
      mode: vscode.CommentMode.Preview,
      author: { name: 'Proposed change' },
    }))
  }
  function toggle(token, field) {
    const q = queue
    if (!thread || !q?.presentation || token !== q.token || !current(q)) return
    q[field] = !q[field]
    renderReview(q)
  }
  async function show(q) {
    hide()
    q.presentation = undefined
    emit({ proposalState: { status: 'pending' } })
    q.token = randomUUID()
    const token = q.token
    try {
      if (!current(q)) throw Error('Source changed. Review the active buffer again.')
      const g = q.groups[q.index]
      const ranges = g.edits.map(
        (e) => new vscode.Range(q.doc.positionAt(e.start), q.doc.positionAt(e.end)),
      )
      const target = ranges[0]
      const commentsVisible = vscode.workspace.getConfiguration('comments').get('visible', true)
      const inline =
        (q.localPrediction || !commentsVisible) &&
        g.edits.length === 1 &&
        !/[\r\n]/.test(g.edits[0].old + g.edits[0].replacement) &&
        g.edits[0].replacement.length <= 100 &&
        (g.edits[0].replacement.trim() || !g.edits[0].replacement)
      if (inline) {
        q.editor.setDecorations(oldMark, ranges)
        q.editor.setDecorations(newMark, [
          {
            range: target,
            hoverMessage: g.explanation,
            renderOptions: { after: { contentText: g.edits[0].replacement || '⌫' } },
          },
        ])
      } else {
        if (!commentsVisible)
          throw Error('Enable visible editor comments to display grouped or multiline changes.')
        q.rows = reviewRows(q.doc, g.edits)
        q.result = q.why = false
        thread = controller.createCommentThread(
          q.doc.uri,
          new vscode.Range(target.start, target.start),
          [],
        )
        thread.canReply = false
        thread.label =
          'Threadlight · ' + g.number + '/' + q.total + ' · Tab accept · Alt+] next · Esc dismiss'
        renderReview(q)
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded
      }
      q.target = target
      q.editor.selection = new vscode.Selection(target.start, target.end)
      q.editor.revealRange(target, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      for (let i = 0; i < 25; i++) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        if (!current(q) || token !== q.token)
          throw Error('Proposal interrupted. Read fresh source.')
        if (inView(q)) {
          await setKey(true)
          if (!current(q) || token !== q.token) throw Error('Proposal interrupted.')
          q.presentation = inView(q) ? 'shown' : 'offscreen'
          item.text = '$(arrow-right) Change ' + g.number + '/' + q.total
          item.tooltip = 'Next change (Alt+]). Tab accepts, Alt+Backspace skips and Esc dismisses.'
          item.show()
          const result = status()
          emit({ proposalState: result, narrate: q.narrate })
          return result
        }
      }
      throw Error('VS Code did not confirm the proposed location in view.')
    } catch (error) {
      if (queue === q && token === q.token) clear()
      throw error
    }
  }
  async function start(source, proposals, narrate = false) {
    const groups = readGroups(source.document, proposals)
    clear()
    const q = (queue = {
      localPrediction: source.localPrediction === true,
      editor: source.editor,
      doc: source.document,
      version: source.version,
      groups,
      index: 0,
      total: groups.length,
      narrate,
    })
    return show(q)
  }
  async function next(token, skip = false) {
    const q = queue
    if (!q || q.token !== token || (!q.presentation && !q.remaining))
      return { ...status(), applied: false }
    if (!current(q)) {
      clear()
      return { status: 'idle', applied: false }
    }
    if (q.remaining) {
      q.remaining = false
      return { ...(await show(q)), applied: true }
    }
    if (skip || q.groups.length === 1) q.groups.splice(q.index, 1)
    else q.index++
    if (!q.groups.length) {
      clear()
      return { status: 'finished', applied: true }
    }
    q.index %= q.groups.length
    return { ...(await show(q)), applied: true }
  }
  async function accept() {
    const q = queue
    if (!q?.presentation || !current(q)) return clear()
    if (!inView(q)) return
    if (
      (thread &&
        (!vscode.workspace.getConfiguration('comments').get('visible', true) ||
          thread.collapsibleState === vscode.CommentThreadCollapsibleState.Collapsed)) ||
      !q.editor.selection.isEqual(q.target)
    )
      return clear()
    const g = q.groups[q.index],
      prior = q.doc.getText()
    const sorted = [...g.edits].sort((a, b) => b.start - a.start)
    if (sorted.some((e) => prior.slice(e.start, e.end) !== e.old)) return clear()
    const expected = sorted.reduce(
      (s, e) => s.slice(0, e.start) + e.replacement + s.slice(e.end),
      prior,
    )
    q.presentation = undefined
    hide()
    emit({ proposalState: { status: 'pending' } })
    q.applying = true
    let ok
    try {
      ok = await q.editor.edit(
        (builder) => {
          for (const e of sorted)
            builder.replace(
              new vscode.Range(q.doc.positionAt(e.start), q.doc.positionAt(e.end)),
              e.replacement,
            )
        },
        { undoStopBefore: true, undoStopAfter: true },
      )
    } catch (error) {
      if (queue === q) clear()
      throw error
    } finally {
      q.applying = false
    }
    if (
      !ok ||
      queue !== q ||
      q.doc.version !== q.version + 1 ||
      q.doc.getText() !== expected ||
      q.editor !== vscode.window.activeTextEditor
    ) {
      if (queue === q) clear()
      return
    }
    q.version = q.doc.version
    q.groups.splice(q.index, 1)
    if (!q.groups.length) return clear()
    // Only translate across the exact set of edits we just committed. Any outside edit cancels.
    for (const group of q.groups)
      for (const e of group.edits) {
        const shift = sorted
          .filter((a) => a.end <= e.start)
          .reduce((n, a) => n + a.replacement.length - a.old.length, 0)
        e.start += shift
        e.end += shift
        if (expected.slice(e.start, e.end) !== e.old) return clear()
      }
    q.index %= q.groups.length
    q.remaining = true
    q.token = randomUUID()
    emit({ proposalState: status() })
    item.text = '$(arrow-right) Next change · ' + q.groups[q.index].number + '/' + q.total
    item.tooltip = 'Reveal the next proposal (Alt+])'
    item.show()
    await vscode.commands.executeCommand('setContext', 'threadlight.coach.remaining', true)
  }
  const run = (fn) => async () => {
    try {
      return await fn()
    } catch (error) {
      void vscode.window.showWarningMessage(error.message)
    }
  }
  context.subscriptions.push(
    controller,
    item,
    oldMark,
    newMark,
    vscode.commands.registerCommand(resultCommand, (token) => toggle(token, 'result')),
    vscode.commands.registerCommand(whyCommand, (token) => toggle(token, 'why')),
    vscode.commands.registerCommand('threadlight.coach.acceptProposal', run(accept)),
    vscode.commands.registerCommand('threadlight.coach.dismissProposals', clear),
    vscode.commands.registerCommand(
      'threadlight.coach.skipProposal',
      run(() => next(queue?.token, true)),
    ),
    vscode.commands.registerCommand(
      'threadlight.coach.nextProposal',
      run(() => next(queue?.token)),
    ),
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (queue) clear()
    }),
    vscode.window.onDidChangeTextEditorSelection(({ textEditor, kind }) => {
      if (
        (kind === vscode.TextEditorSelectionChangeKind.Keyboard ||
          kind === vscode.TextEditorSelectionChangeKind.Mouse) &&
        queue?.presentation &&
        queue.editor === textEditor &&
        !textEditor.selection.isEqual(queue.target)
      )
        clear()
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor }) => {
      const q = queue
      if (!q?.presentation || q.editor !== textEditor) return
      const presentation = inView(q) ? 'shown' : 'offscreen'
      if (q.presentation === presentation) return
      q.presentation = presentation
      // Stop queued narration when scrolling away. Returning reveals the same
      // thread with its controls intact and does not request narration again.
      emit({ proposalState: presentation === 'shown' ? status() : { status: 'pending' } })
    }),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (queue?.doc === document && !queue.applying && document.version !== queue.version) clear()
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (queue?.doc === doc) clear()
    }),
  )
  return {
    start,
    clear,
    status,
    next,
    clearPrediction: () => {
      if (queue?.localPrediction) clear()
    },
  }
}
module.exports = { createProposals }
