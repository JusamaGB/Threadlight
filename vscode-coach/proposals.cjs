const vscode = require('vscode')
const { randomUUID } = require('node:crypto')
const { reviewRows, resultCommand, whyCommand } = require('./proposalReview.cjs')

const { createProposalSurface } = require('./proposalSurface.cjs')

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
  const surface = createProposalSurface(context, (q) => {
    if (queue === q) clear()
  })
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
  const resultItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  const whyItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49)
  item.command = 'threadlight.coach.nextProposal'
  let queue
  const setKey = (active) =>
    vscode.commands.executeCommand('setContext', 'threadlight.coach.proposal', active)
  function hide() {
    void vscode.commands.executeCommand('setContext', 'threadlight.coach.remaining', false)
    surface.clear()
    resultItem.hide()
    whyItem.hide()
    if (queue && vscode.window.visibleTextEditors.includes(queue.editor)) {
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
  function valid(q) {
    return (
      queue === q &&
      connected(q) &&
      vscode.workspace.isTrusted &&
      !q.doc.isClosed &&
      q.doc.version === q.version
    )
  }
  function current(q) {
    const editor = vscode.window.activeTextEditor
    return valid(q) && (surface.isPreview(editor, q) || (editor === q.editor && !q.preview))
  }
  function inView(q) {
    const editor = vscode.window.activeTextEditor
    if (surface.isPreview(editor, q))
      return (
        q.previewAnchor && editor.visibleRanges.some((range) => range.contains(q.previewAnchor))
      )
    return (
      editor === q.editor && q.editor.visibleRanges.some((range) => range.contains(q.target.start))
    )
  }
  function status() {
    if (queue && !queue.applying && !valid(queue)) clear()
    if (!queue) return { status: 'idle' }
    const g = queue.groups[queue.index]
    const shown = queue.presentation === 'shown' && current(queue)
    return {
      status: shown ? 'shown' : 'pending',
      token: queue.token,
      step: g.number,
      total: queue.total,
      explanation: shown ? g.explanation : undefined,
      ...(queue.walkRow && !queue.remaining && { walkRow: queue.walkRow }),
      line: queue.doc.positionAt(g.edits[0].start).line + 1,
    }
  }
  async function line(token, requestedRow) {
    const q = queue
    if (!q || token !== q.token || !q.presentation || !current(q))
      throw Error('The displayed proposal changed. Check proposal status again.')
    if (q.switching || q.accepting) throw Error('The proposal view is switching. Try again.')
    const rows = (q.rows ?? reviewRows(q.doc, q.groups[q.index].edits)).filter(
      (row) => row.kind === 'add' || row.kind === 'remove',
    )
    const number = requestedRow ?? q.walkRow ?? 1
    if (!Number.isInteger(number) || number < 1 || number > rows.length)
      throw Error('This proposal has ' + rows.length + ' changed rows.')
    const row = rows[number - 1]
    q.switching = true
    let highlighted = false
    try {
      if (q.rows) highlighted = await surface.focusRow(q, row)
    } catch {
      // A valid proposal can still be discussed if its highlight cannot be displayed.
    } finally {
      q.switching = false
    }
    if (!valid(q) || q.token !== token || q.remaining)
      throw Error('The displayed proposal changed. Check proposal status again.')
    q.walkRow = number
    resultItem.text = q.result ? 'Hide result' : 'Result'
    return {
      token,
      row: number,
      totalRows: rows.length,
      kind: row.kind,
      line: row.line,
      text: row.text,
      highlighted,
    }
  }
  async function toggle(token, field) {
    const q = queue
    if (!q?.rows || !q.presentation || q.switching || token !== q.token || !current(q)) return
    if (field === 'why') {
      void vscode.window.showInformationMessage(q.groups[q.index].explanation)
      return
    }
    q.result = !q.result
    resultItem.text = q.result ? 'Hide result' : 'Result'
    q.switching = true
    try {
      await surface.result(q, q.result)
    } catch (error) {
      if (queue === q && q.token === token) clear()
      throw error
    } finally {
      q.switching = false
    }
  }
  async function show(q) {
    await surface.source(q)
    if (queue !== q) throw Error('Proposal interrupted.')
    hide()
    q.presentation = undefined
    emit({ proposalState: { status: 'pending' } })
    q.token = randomUUID()
    q.walkRow = undefined
    const token = q.token
    try {
      if (!current(q)) throw Error('Source changed. Review the active buffer again.')
      if (!q.localPrediction && vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview) {
        // Opening another file in a preview tab would otherwise close the reviewed source.
        await vscode.commands.executeCommand('workbench.action.keepEditor')
        if (!current(q) || q.token !== token) throw Error('Proposal interrupted.')
      }
      const g = q.groups[q.index]
      const ranges = g.edits.map(
        (e) => new vscode.Range(q.doc.positionAt(e.start), q.doc.positionAt(e.end)),
      )
      const target = ranges[0]
      q.target = target
      q.editor.selection = new vscode.Selection(target.start, target.start)
      q.editor.revealRange(
        q.editor.selection,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      )
      q.rows = undefined
      const inline =
        q.localPrediction &&
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
        q.rows = reviewRows(q.doc, g.edits)
        q.result = false
        resultItem.text = 'Result'
        whyItem.text = 'Why this edit?'
        await surface.show(q)
        resultItem.command = { command: resultCommand, title: 'Result', arguments: [token] }
        whyItem.command = { command: whyCommand, title: 'Why this edit?', arguments: [token] }
        resultItem.show()
        whyItem.show()
      }
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
          if (q.total > 1 || !q.rows) item.show()
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
      column: source.editor.viewColumn,
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
    if (!q || q.switching || q.token !== token || (!q.presentation && !q.remaining))
      return { ...status(), applied: false }
    if (!current(q)) return { ...status(), applied: false }
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
    if (!q?.presentation || q.switching || q.accepting) return
    if (!current(q)) return
    if (!inView(q)) return
    const token = q.token
    q.accepting = true
    try {
      await surface.source(q)
    } finally {
      q.accepting = false
    }
    if (queue !== q || q.token !== token) return
    if (!current(q)) return
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
  function refreshVisibility(q) {
    if (!q.presentation) return
    const presentation = current(q) && inView(q) ? 'shown' : 'offscreen'
    if (q.presentation === presentation) return
    q.presentation = presentation
    emit({ proposalState: status() })
  }
  context.subscriptions.push(
    item,
    resultItem,
    whyItem,
    oldMark,
    newMark,
    vscode.commands.registerCommand(resultCommand, (token) => run(() => toggle(token, 'result'))()),
    vscode.commands.registerCommand(whyCommand, (token) => run(() => toggle(token, 'why'))()),
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
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const q = queue
      if (!q || q.applying) return
      if (q.localPrediction && editor?.document !== q.doc && !surface.isPreview(editor, q))
        return clear()
      if (editor?.document === q.doc && editor.viewColumn === q.column) {
        q.editor = editor
        if (q.preview && !q.returning && surface.hasInline(q)) {
          q.result = false
          resultItem.text = 'Result'
          void surface.result(q, false).catch(() => {
            if (queue === q) clear()
          })
        }
        if (!q.preview) surface.redraw(q)
      }
      if (q.returning || q.switching || q.accepting) return
      const focused = current(q)
      void setKey(focused && !!q.presentation)
      void vscode.commands.executeCommand(
        'setContext',
        'threadlight.coach.remaining',
        focused && !!q.remaining,
      )
      if (focused && q.rows && q.presentation) {
        resultItem.show()
        whyItem.show()
      } else {
        resultItem.hide()
        whyItem.hide()
      }
      if (focused && (q.remaining || (q.presentation && (q.total > 1 || !q.rows)))) item.show()
      else item.hide()
      refreshVisibility(q)
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor }) => {
      const q = queue
      if (!q?.presentation || (q.editor !== textEditor && !surface.isPreview(textEditor, q))) return
      refreshVisibility(q)
    }),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (queue?.doc === document && !queue.applying && document.version !== queue.version) clear()
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (queue?.doc === doc) clear()
    }),
    vscode.window.tabGroups.onDidChangeTabs(({ closed }) => {
      const q = queue
      if (
        q?.preview &&
        !surface.hasInline(q) &&
        closed.some((tab) => tab.input?.uri?.toString() === q.preview.toString())
      )
        clear()
    }),
  )
  return {
    start,
    clear,
    status,
    next,
    line,
    practice(token, scope) {
      const q = queue
      if (!q || token !== q.token || !current(q) || q.presentation !== 'shown')
        throw Error('The displayed proposal changed. Check proposal status again.')
      const edits =
        scope === 'all' ? q.groups.flatMap((group) => group.edits) : q.groups[q.index].edits
      return {
        source: q.doc,
        rows: reviewRows(q.doc, edits)
          .filter((row) => row.kind === 'add' || row.kind === 'remove')
          .map(({ line, kind, text }) => ({ line, kind, text })),
      }
    },
    clearPrediction: () => {
      if (queue?.localPrediction) clear()
    },
  }
}
module.exports = { createProposals }
