const vscode = require('vscode')
const { createTrace } = require('./trace.cjs')
const { createGhostLesson } = require('./ghostLesson.cjs')
const { createInlinePreview } = require('./inlinePreview.cjs')
const { createWholeFileReview } = require('./wholeFileReview.cjs')
const { createProposals } = require('./proposals.cjs')
const { createPythonSuggestions } = require('./pythonSuggestions.cjs')
const { createWalkthrough } = require('./walkthrough.cjs')
const net = require('node:net')
const { homedir } = require('node:os')
const { join, dirname, basename } = require('node:path')
const { randomBytes, randomUUID } = require('node:crypto')
const fs = require('node:fs')

// Only this rendezvous record is persisted. Code, hints and comparisons live in memory.
const scheme = 'threadlight-coach-preview'
const coachActions = [
  'capabilities',
  'propose',
  'proposal_status',
  'proposal_next',
  'proposal_line',
  'context',
  'trace',
  'ghost_practice',
  'ghost_practice_diff',
  'ghost_practice_text',
  'review',
  'guide',
  'diff',
  'inline',
  'progress',
  'guide_status',
  'walkthrough',
  'walkthrough_page',
  'walkthrough_notes',
]
function activate(context) {
  const directory =
    context.extensionMode === vscode.ExtensionMode.Production
      ? join(homedir(), '.threadlight')
      : context.globalStorageUri.fsPath
  const addressFile = join(directory, 'editor-coach.json')
  let server, address, client, snapshot, plan, lastGuide
  let peerSupportsGutter = false
  const peers = new Set()
  const previews = new Map()
  const lenses = new vscode.EventEmitter()
  const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
  })
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  const inline = createInlinePreview(context, () => client && !client.destroyed && ownsWindow())
  const connected = () => client && !client.destroyed && ownsWindow()
  let spokenGhost = true
  let practiceLocation = 'current'
  const ghost = createGhostLesson(context, connected, send, () => spokenGhost)
  const trace = createTrace(context, connected, ghost)
  const review = createWholeFileReview(vscode)
  // Live sharing still requires the explicit window connection. Local typing uses only
  // the saved preference and never creates a rendezvous record or claims another window.
  const preferenceFile =
    context.extensionMode === vscode.ExtensionMode.Production
      ? join(process.env.APPDATA || homedir(), 'Threadlight', 'settings.json')
      : join(directory, 'settings.json')
  let preference = 'editor'
  function readPreference() {
    try {
      const settings = JSON.parse(fs.readFileSync(preferenceFile, 'utf8'))
      spokenGhost = settings.spokenGhostWalkthroughs !== false
      practiceLocation = settings.ghostPracticeLocation === 'copy' ? 'copy' : 'current'
      const value = settings.pythonSuggestions
      preference = value === 'on' || value === 'off' ? value : 'editor'
    } catch (error) {
      if (error.code === 'ENOENT') {
        preference = 'editor'
        spokenGhost = true
        practiceLocation = 'current'
      }
    }
  }
  function pythonEnabled() {
    return (
      process.platform === 'win32' &&
      (preference === 'editor'
        ? vscode.workspace
            .getConfiguration('threadlight.coach', vscode.window.activeTextEditor?.document)
            .get('pythonSuggestions', false)
        : preference === 'on')
    )
  }
  const proposals = createProposals(
    context,
    (q) => (q.localPrediction ? pythonEnabled() : server && ownsWindow()),
    send,
  )
  const walk = createWalkthrough(
    vscode,
    decoration,
    () => client && !client.destroyed && ownsWindow(),
    send,
    () => {
      updateStatus()
      lenses.fire()
    },
  )
  const python = createPythonSuggestions(
    context,
    pythonEnabled,
    () =>
      !!plan ||
      !!walk.current() ||
      ghost.practicing() ||
      inline.active() ||
      trace.active() ||
      proposals.status().status !== 'idle',
    proposals,
  )
  function refreshPython() {
    const before = preference,
      speechBefore = spokenGhost
    readPreference()
    if (preference !== before) python.remember()
    if (speechBefore !== spokenGhost) ghost.updatePreference()
  }
  readPreference()
  python.remember()
  // Watch the atomic settings-file replacement even if Threadlight has not been opened yet.
  fs.watchFile(preferenceFile, { persistent: false, interval: 1500 }, refreshPython)
  context.subscriptions.push(
    { dispose: () => fs.unwatchFile(preferenceFile, refreshPython) },
    vscode.workspace.onDidGrantWorkspaceTrust(() => python.remember()),
  )
  function updateStatus() {
    status.command = plan
      ? {
          command: 'threadlight.coach.next',
          title: label(),
          arguments: [{ id: plan.id, index: plan.index, token: plan.token }],
        }
      : 'threadlight.coach.stop'
    status.text =
      plan &&
      (plan.paused ||
        vscode.workspace.getConfiguration('editor', plan.editor.document).get('codeLens') === false)
        ? '$(arrow-right) ' + label()
        : '$(mortar-board) Threadlight Coach'
    status.tooltip = plan
      ? label()
      : 'Live Coach ' +
        context.extension.packageJSON.version +
        ' · File proposals and Trace. Click to stop coaching.'
    if (walk.current()) {
      const w = walk.current()
      status.text = '$(book) ' + walk.state().hint + ' · ' + stepLabel(w)
      status.tooltip = 'Walkthrough controls'
      status.command = 'threadlight.coach.walkthroughControls'
    }
    if (server) status.show()
    else status.hide()
  }
  function label() {
    if (plan.paused) return 'Refresh guide from updated source'
    const step = plan.steps[plan.index]
    const hint = step.hint.replace(/\s+/g, ' ')
    return (
      (hint.length > 120 ? hint.slice(0, 119) + '…' : hint) +
      (plan.index + 1 === plan.steps.length ? ' · Finish guide' : ' · Next step ›')
    )
  }
  function stepLabel(w) {
    if (w.status === 'paused') return 'Resume'
    if (!w.started) return 'Start'
    return w.finished && w.endLine === w.editor.document.lineCount ? 'Finish' : 'Next'
  }
  async function walkthroughControls() {
    const w = walk.current()
    if (!w) return
    const token = w.token
    const actions = [stepLabel(w), w.auto ? 'Turn Auto off' : 'Turn Auto on', 'End walkthrough']
    const pick = await vscode.window.showQuickPick(actions, { title: 'Walkthrough' })
    if (!pick || walk.current() !== w) return
    if (pick === actions[0] && token === w.token) walk.step(token)
    else if (pick === actions[1] && (pick === 'Turn Auto off') === w.auto) walk.toggle(w.token)
    else if (pick === actions[2]) walk.stop()
  }
  function send(message) {
    if (client && !client.destroyed) client.write(JSON.stringify(message) + '\n')
  }
  function state(p = plan, status = p?.paused ? 'paused' : 'shown') {
    if (!p) return lastGuide || { status: 'idle' }
    return {
      status,
      plan: p.id,
      guideId: p.guideId,
      token: p.token,
      step: p.base + p.index + 1,
      total: p.base + p.steps.length,
      goal: p.goal,
      hint: p.steps[p.index].hint,
      line: p.paused ? undefined : p.steps[p.index].line,
    }
  }
  function pausePlan(invalidate = false) {
    if (!plan) return
    clearTimeout(plan.verifyTimer)
    if (plan.paused && !invalidate && !plan.refreshRequested && !plan.observedWhilePaused) return
    plan.observedWhilePaused = false
    plan.refreshRequested = false
    plan.resumeSnapshot = undefined
    plan.verifiedVersion = undefined
    plan.paused = true
    plan.token = randomUUID()
    plan.pending = false
    if (vscode.window.visibleTextEditors.includes(plan.editor))
      plan.editor.setDecorations(decoration, [])
    lenses.fire()
    updateStatus()
    send({ guideEvent: state() })
  }
  function checkExpectedEdit(p) {
    clearTimeout(p.verifyTimer)
    if (!p.watchExpected || !p.paused || p.narratedIndex !== p.index || p.refreshRequested) return
    const step = p.steps[p.index],
      doc = p.editor.document
    if (doc.lineAt(step.line - 1).text !== step.expectedLine) return
    const token = p.token,
      version = doc.version,
      owner = client
    // Only debounce a proven match. A quiet but incomplete edit never starts this timer.
    p.verifyTimer = setTimeout(() => {
      if (
        p !== plan ||
        p.token !== token ||
        p.refreshRequested ||
        owner !== client ||
        !client ||
        client.destroyed ||
        !ownsWindow() ||
        !vscode.workspace.isTrusted ||
        vscode.window.activeTextEditor !== p.editor ||
        doc.isClosed ||
        doc.version !== version
      )
        return
      let fresh
      try {
        fresh = getContext()
      } catch {
        return
      }
      if (!fresh.lines.some((line) => line.line === step.line && line.text === step.expectedLine))
        return
      p.verifiedVersion = version
      void transition(token, 'next', 'verified_edit').catch(() => {})
    }, 180)
  }
  function clearPlan(outcome = 'cancelled', origin = 'editor') {
    if (!plan) return
    trace.clear()
    const old = plan
    clearTimeout(old.verifyTimer)
    plan = undefined
    if (vscode.window.visibleTextEditors.includes(old.editor))
      old.editor.setDecorations(decoration, [])
    lenses.fire()
    updateStatus()
    lastGuide = { ...state(old, outcome), origin }
    send({ finished: old.id, guideEvent: lastGuide })
  }
  function stop() {
    walk.stop()
    ghost.stop()
    python.stop()
    proposals.clear()
    review.clear()
    trace.clear()
    inline.clear()
    clearPlan()
    lastGuide = undefined
    snapshot = undefined
    client = undefined
    for (const peer of peers) peer.destroy()
    server?.close()
    server = undefined
    if (address) {
      try {
        if (JSON.parse(fs.readFileSync(addressFile, 'utf8')).id === address.id)
          fs.unlinkSync(addressFile)
      } catch {
        /* An already removed endpoint needs no cleanup. */
      }
    }
    address = undefined
    updateStatus()
  }
  function ownsWindow() {
    try {
      return address && JSON.parse(fs.readFileSync(addressFile, 'utf8')).id === address.id
    } catch {
      return false
    }
  }
  function getContext(line) {
    const editor = vscode.window.activeTextEditor
    if (!editor || !['file', 'untitled', 'vscode-remote'].includes(editor.document.uri.scheme))
      throw Error('Open the source file you want to discuss in the connected editor.')
    const doc = editor.document
    const selected = editor.selection
    if (line !== undefined && (!Number.isInteger(line) || line < 1 || line > doc.lineCount))
      throw Error('Choose a line within the active file.')
    const anchor = line === undefined ? selected.start.line : line - 1
    const first = line === undefined ? Math.max(0, anchor - 12) : anchor
    const end = Math.min(doc.lineCount, first + 60)
    let size = 0
    const lines = []
    for (let i = first; i < end; i++) {
      const text = doc.lineAt(i).text
      if (line !== undefined && !lines.length && text.length > 12000) {
        lines.push({ line, text: text.slice(0, 12000), truncated: true })
        break
      }
      if (size + text.length > 12000) break
      size += text.length
      lines.push({ line: i + 1, text })
    }
    if (!lines.length || anchor >= first + lines.length)
      throw Error('The selected line is too large for a coaching excerpt.')
    const bounded =
      editor.selections.length === 1 &&
      !selected.isEmpty &&
      selected.start.line >= first &&
      selected.end.line < first + lines.length &&
      doc.offsetAt(selected.end) - doc.offsetAt(selected.start) <= 12000
    snapshot = {
      traceEligible: editor.selections.length === 1,
      cursorSelection: selected,
      selection: bounded ? selected : undefined,
      selectedText: bounded ? doc.getText(selected) : undefined,
      id: randomUUID(),
      editor,
      version: doc.version,
      first: first + 1,
      last: first + lines.length,
      truncated: !!lines[0].truncated,
    }
    if (plan?.paused && plan.editor.document === doc) {
      plan.observedWhilePaused = true
      if (plan.refreshRequested) plan.resumeSnapshot = snapshot.id
    }
    return {
      snapshot: snapshot.id,
      file: basename(doc.fileName),
      language: doc.languageId,
      lineCount: doc.lineCount,
      cursor: { line: selected.active.line + 1, column: selected.active.character },
      trace: trace.inspect(editor),
      selectedText: snapshot.selectedText,
      selection: [selected.start.line + 1, selected.end.line + 1],
      lines,
    }
  }
  function source(command) {
    const s = snapshot
    if (
      !s ||
      command.snapshot !== s.id ||
      s.editor !== vscode.window.activeTextEditor ||
      s.editor.document.version !== s.version
    )
      throw Error('The active file or its text changed. Read fresh context first.')
    if (s.truncated && command.action !== 'walkthrough')
      throw Error('The line is too long for a complete coaching excerpt.')
    return s
  }
  function inExcerpt(s, line) {
    return Number.isInteger(line) && line >= s.first && line <= s.last
  }
  async function showStep(p) {
    const active = vscode.window.activeTextEditor
    if (active?.document === p.editor.document) p.editor = active
    if (
      plan !== p ||
      p.paused ||
      p.editor !== vscode.window.activeTextEditor ||
      p.editor.document.version !== p.version
    )
      throw Error('Return to the source file and request fresh coaching.')
    const range = p.editor.document.lineAt(p.steps[p.index].line - 1).range
    p.pending = true
    const step = p.steps[p.index]
    p.watchExpected =
      typeof step.expectedLine === 'string' &&
      p.editor.document.lineAt(step.line - 1).text !== step.expectedLine
    p.editor.setDecorations(decoration, [range])
    lenses.fire()
    updateStatus()
    p.editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    // Verify that the real editor reports the target line in view before allowing speech.
    for (let tries = 0; tries < 25; tries++) {
      await new Promise((r) => setTimeout(r, 40))
      if (
        plan !== p ||
        p.paused ||
        p.editor !== vscode.window.activeTextEditor ||
        p.editor.document.version !== p.version ||
        !ownsWindow()
      )
        throw Error('The editor changed before the hint was shown.')
      if (
        p.editor.visibleRanges.some(
          (r) => r.start.line <= range.start.line && r.end.line >= range.start.line,
        )
      )
        return
    }
    throw Error('VS Code could not show the requested line.')
  }
  async function handle(command) {
    if (!ownsWindow()) throw Error('Start coaching again in the intended VS Code window.')
    if (command.action === 'capabilities')
      return {
        version: context.extension.packageJSON.version,
        actions: coachActions,
        verifiedGuideEdits: true,
        ghostPracticeLocation: practiceLocation,
        walkthroughControls: true,
        gutterWalkthrough: true,
        python: python.describe(),
      }
    if (command.action === 'context') return getContext(command.line)
    if (command.action === 'review') return review.read(command.nextPage)
    if (
      ghost.practicing() &&
      ['propose', 'walkthrough', 'guide', 'inline', 'trace'].includes(command.action)
    )
      ghost.stop()
    if (command.action === 'propose') {
      const source = review.resolve(command.snapshot)
      trace.clear()
      inline.clear()
      python.remember()
      return proposals.start(source, command.proposals, command.narrate)
    }
    if (command.action === 'proposal_status') return proposals.status()
    if (command.action === 'proposal_next') return proposals.next(command.token)
    if (command.action === 'proposal_line') return proposals.line(command.token, command.row)
    if (command.action.startsWith('ghost_practice')) {
      if (command.action === 'ghost_practice') {
        const s = source(command)
        if (command.scope === 'selection' && !s.editor.selection.isEqual(s.cursorSelection))
          throw Error('The selection changed. Read fresh editor context.')
        clearPlan()
        walk.stop()
        trace.clear()
        inline.clear()
        readPreference()
        return ghost.startSource(s.editor, command, command.location ?? practiceLocation)
      }
      let doc, rows
      if (command.action === 'ghost_practice_diff') {
        const selected = proposals.practice(command.token, command.scope)
        doc = selected.source
        rows = selected.rows
      } else {
        const s = source(command)
        doc = s.editor.document
        rows = command.text.split(/\r\n?|\n/).map((text, i) => ({ text, line: i + 1 }))
      }
      clearPlan()
      walk.stop()
      trace.clear()
      inline.clear()
      return ghost.startPractice(doc, rows, command.spoken, 0)
    }
    if (command.action === 'walkthrough_page')
      return ghost.owns(command.token)
        ? ghost.page(command.token)
        : walk.page(command.token, command.fromLine)
    if (command.action === 'walkthrough_notes')
      return ghost.owns(command.token)
        ? ghost.notes(command.token, command.explanations)
        : walk.notes(command.token, command.explanations)
    if (command.action === 'walkthrough') {
      if (!peerSupportsGutter)
        throw Error(
          'Restart the updated Threadlight app to enable line-number walkthrough gestures.',
        )
      const s = source(command)
      if (plan) throw Error('End the current typing guide before starting a file walkthrough.')
      trace.clear()
      inline.clear()
      lastGuide = undefined
      return walk.start(s.editor, command.line, command.auto)
    }
    if (command.action === 'guide_status') return walk.state() || state()
    if (command.action === 'progress' && walk.current()) {
      if (walk.current().token !== command.token) return { ...walk.state(), applied: false }
      if (command.intent === 'next') {
        const applied = walk.step(command.token)
        return { ...walk.state(), applied }
      }
      walk.stop(command.intent === 'finish' ? 'ended' : 'cancelled')
      return { ...walk.state(), applied: true }
    }
    if (command.action === 'progress') return transition(command.token, command.intent, 'voice')
    const s = source(command)
    proposals.clear()
    python.remember()
    if (command.action === 'trace') {
      inline.clear()
      walk.stop()
      return trace.show(s, command.anchor, command.text, command.spoken)
    }
    if (command.action === 'inline') {
      trace.clear()
      return inline.show(s, command.replacements)
    }
    if (command.action === 'guide') {
      if (walk.current()) throw Error('End the file walkthrough before starting a typing guide.')
      walk.clearLast()
      const previous = plan
      if (command.resume) {
        if (
          !previous?.paused ||
          previous.token !== command.resume ||
          previous.editor.document !== s.editor.document ||
          previous.resumeSnapshot !== s.id ||
          !previous.refreshRequested
        )
          throw Error('Refresh the paused guide from its original source tab before resuming.')
      } else if (previous)
        throw Error('Finish or refresh the current hint before starting another guide.')
      if (
        !Array.isArray(command.steps) ||
        !command.steps.length ||
        command.steps.length > 8 ||
        !command.steps.every(
          (step) =>
            inExcerpt(s, step.line) &&
            typeof step.hint === 'string' &&
            step.hint.length <= 1000 &&
            (step.expectedLine === undefined ||
              (typeof step.expectedLine === 'string' &&
                step.expectedLine.length > 0 &&
                step.expectedLine.length <= 12000 &&
                !/[\r\n]/.test(step.expectedLine))),
        )
      )
        throw Error('A guide step is outside the observed excerpt.')
      trace.clear()
      const p = (plan = {
        id: command.plan,
        guideId: previous?.guideId || command.plan,
        token: randomUUID(),
        base: previous ? previous.base + previous.index : 0,
        goal: previous?.goal || command.goal || command.steps[0].hint,
        version: s.version,
        editor: s.editor,
        steps: command.steps,
        index: 0,
        pending: true,
      })
      try {
        await showStep(p)
        send({ guideEvent: state(p) })
        return p.id
      } catch (error) {
        if (plan === p && !p.paused) clearPlan()
        throw error
      }
    }
    if (command.action === 'diff') {
      if (
        !inExcerpt(s, command.firstLine) ||
        !inExcerpt(s, command.lastLine) ||
        command.lastLine < command.firstLine ||
        typeof command.replacement !== 'string' ||
        command.replacement.length > 12000
      )
        throw Error('Invalid comparison range.')
      const doc = s.editor.document
      if (doc.offsetAt(doc.lineAt(doc.lineCount - 1).range.end) > 1000000)
        throw Error('This file exceeds the coaching preview limit.')
      const original = doc.getText()
      const start = doc.offsetAt(doc.lineAt(command.firstLine - 1).range.start)
      const end = doc.offsetAt(doc.lineAt(command.lastLine - 1).range.end)
      const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'
      const proposal =
        original.slice(0, start) + command.replacement.replace(/\r?\n/g, eol) + original.slice(end)
      const name = basename(doc.fileName),
        id = randomUUID()
      const uri = (side) => vscode.Uri.from({ scheme, path: '/' + id + '/' + side + '/' + name })
      const left = uri('current'),
        right = uri('suggested')
      previews.set(left.toString(), original)
      previews.set(right.toString(), proposal)
      try {
        await vscode.commands.executeCommand(
          'vscode.diff',
          left,
          right,
          name + ' · Coaching preview',
          { preview: true },
        )
      } catch (error) {
        previews.delete(left.toString())
        previews.delete(right.toString())
        throw error
      }
      return { preview: true, firstLine: command.firstLine, lastLine: command.lastLine }
    }
    throw Error('Unknown editor request.')
  }
  async function transition(token, intent, origin) {
    const p = plan
    if (!ownsWindow() || !client || client.destroyed) throw Error('Coaching is disconnected.')
    if (!p || token !== p.token) return { ...state(), applied: false }
    if (intent === 'cancel') {
      proposals.clear()
      clearPlan('cancelled', origin)
      return { ...state(p, 'cancelled'), applied: true }
    }
    if (p.pending) return { ...state(), applied: false, busy: true }
    if (p.editor.document !== vscode.window.activeTextEditor?.document) {
      pausePlan()
      throw Error('Return to the guide’s original source tab, then refresh the guide.')
    }
    if (!p.paused && p.editor.document.version !== p.version) pausePlan()
    if (p.token !== token) return { ...state(), applied: false }
    if (intent === 'next' && origin === 'voice' && !trace.checked())
      throw Error('Read fresh context and check the learner’s current trace before continuing.')
    if (
      intent === 'finish' &&
      p.verifiedVersion !== undefined &&
      (!snapshot || snapshot.id !== p.resumeSnapshot || snapshot.version !== p.verifiedVersion)
    )
      throw Error('Read fresh context for the verified edit before finishing.')
    if (intent === 'next' && origin === 'voice' && !p.paused && p.watchExpected) {
      return {
        ...state(),
        applied: false,
        instruction: 'Check fresh context: the target line is not complete. Coach this step.',
      }
    }
    if (origin !== 'verified_edit') {
      proposals.clear()
      trace.clear()
    }
    if (intent === 'finish' || (!p.paused && p.index + 1 === p.steps.length)) {
      const outcome =
        intent === 'finish' &&
        ((p.paused && p.verifiedVersion === undefined) || p.index + 1 < p.steps.length)
          ? 'ended'
          : 'completed'
      clearPlan(outcome, origin)
      return { ...state(p, outcome), applied: true }
    }
    if (p.paused) {
      if (p.refreshRequested && Date.now() - p.lastRefresh < 30000)
        return { ...state(), refreshRequested: true, applied: false }
      p.refreshRequested = true
      p.resumeSnapshot = undefined
      p.lastRefresh = Date.now()
      p.token = randomUUID()
      lenses.fire()
      updateStatus()
      send({ guideEvent: { ...state(p, 'refresh_requested'), origin } })
      return { ...state(), refreshRequested: true }
    }
    p.index++
    p.token = randomUUID()
    try {
      await showStep(p)
      send({ shown: { plan: p.id, index: p.index, origin }, guideEvent: { ...state(p), origin } })
      return { ...state(p), applied: true }
    } catch (error) {
      if (plan === p) pausePlan()
      throw error
    }
  }
  async function next(arg) {
    if (walk.current()) {
      const w = walk.current()
      if (arg && (arg.id !== w.id || arg.label !== stepLabel(w))) return
      return walk.step(w.token)
    }
    if (!plan || (arg && (arg.id !== plan.id || arg.index !== plan.index))) return
    try {
      await transition(arg?.token || plan.token, 'next', 'editor')
    } catch (error) {
      void vscode.window.showWarningMessage(error.message)
    }
  }
  function accept(socket) {
    peers.add(socket)
    socket.setEncoding('utf8')
    socket.setTimeout(4000, () => socket.destroy())
    let buffer = '',
      chain = Promise.resolve()
    socket.on('error', () => {})
    socket.on('close', () => {
      peers.delete(socket)
      if (client === socket) {
        proposals.clear()
        review.clear()
        trace.clear()
        inline.clear()
        walk.stop()
        ghost.stop()
        walk.clearLast()
        client = undefined
        clearPlan()
        lastGuide = undefined
        snapshot = undefined
      }
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      // Up to three 12,000-character replacements, including JSON escaping.
      if (buffer.length > 256000) return socket.destroy()
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        chain = chain
          .then(async () => {
            if (socket.destroyed) return
            const msg = JSON.parse(frame)
            if (client !== socket) {
              if (
                !ownsWindow() ||
                msg.command?.action !== 'hello' ||
                msg.command.token !== address.token ||
                client
              )
                return socket.destroy()
              client = socket
              peerSupportsGutter = msg.command.gutterWalkthrough === true
              socket.setTimeout(0)
              send({
                id: msg.id,
                value: {
                  version: context.extension.packageJSON.version,
                  actions: coachActions,
                  verifiedGuideEdits: true,
                  sourceGhostPractice: true,
                  walkthroughControls: true,
                  gutterWalkthrough: true,
                },
              })
              return
            }
            if (msg.proposalSpeechFailed) {
              if (proposals.status().token === msg.proposalSpeechFailed)
                void vscode.window.showWarningMessage(
                  'The proposal is visible, but Live could not speak its explanation.',
                )
              return
            }
            if (msg.guideDeliveryFailed) {
              if (plan?.token === msg.guideDeliveryFailed) plan.refreshRequested = false
              void vscode.window.showWarningMessage(
                'Live could not confirm the guide update. Ask Live for the current guide status.',
              )
              return
            }
            if (msg.ghostSpeechFailed) {
              ghost.speechFailed(msg.ghostSpeechFailed)
              return
            }
            if (msg.walkthroughGutter) {
              walk.gutter(msg.walkthroughGutter, msg.gutter === true)
              return
            }
            if (msg.walkthroughRelease) {
              if (!msg.unavailable) walk.released(msg.walkthroughRelease)
              else if (walk.current()?.token === msg.walkthroughRelease)
                void vscode.window
                  .showInformationMessage(
                    'Choose when to explain the selected lines.',
                    'Explain selection',
                  )
                  .then((pick) => {
                    if (pick) walk.released(msg.walkthroughRelease)
                    else if (walk.current()?.token === msg.walkthroughRelease)
                      walk.pause(msg.walkthroughRelease)
                  })
              return
            }
            if (msg.walkthroughDone) {
              if (msg.failed && ghost.owns(msg.walkthroughDone)) {
                ghost.speechFailed(msg.walkthroughDone)
                return
              }
              if (msg.failed) {
                if (walk.current()?.token === msg.walkthroughDone) {
                  walk.pause(msg.walkthroughDone)
                  void vscode.window.showWarningMessage(
                    'Walkthrough paused. Click a line or use the status bar to resume.',
                  )
                }
              } else walk.spoken(msg.walkthroughDone)
              return
            }
            if (msg.narrated) {
              if (plan && msg.narrated.plan === plan.id && msg.narrated.index === plan.index) {
                plan.pending = false
                plan.narratedIndex = plan.index
                checkExpectedEdit(plan)
              }
              return
            }
            try {
              const value = await handle(msg.command)
              if (client === socket) send({ id: msg.id, value })
            } catch (error) {
              if (client === socket) send({ id: msg.id, error: error.message })
            }
          })
          .catch(() => socket.destroy())
      }
    })
  }
  async function start() {
    if (server && ownsWindow()) return
    if (server) stop()
    if (process.platform !== 'win32' || !vscode.workspace.isTrusted)
      throw Error('Live coaching requires trusted desktop VS Code on Windows.')
    address = { id: randomUUID(), token: randomBytes(32).toString('hex') }
    server = net.createServer(accept)
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen('\\\\.\\pipe\\threadlight-coach-' + address.id, resolve)
      })
      fs.mkdirSync(dirname(addressFile), { recursive: true, mode: 0o700 })
      const temporary = addressFile + '.' + address.id
      fs.writeFileSync(temporary, JSON.stringify(address), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, addressFile)
      python.remember()
      updateStatus()
      void vscode.window.showInformationMessage(
        'Coaching enabled for this window. Ask Threadlight Live about your code.',
      )
    } catch (error) {
      stop()
      throw error
    }
  }
  context.subscriptions.push(
    { dispose: stop },
    decoration,
    status,
    lenses,
    vscode.commands.registerCommand('threadlight.coach.start', start),
    vscode.commands.registerCommand('threadlight.coach.stop', stop),
    vscode.commands.registerCommand('threadlight.coach.startGhostPractice', async () => {
      if (!connected())
        return vscode.window.showInformationMessage(
          'Start Live Coaching in this window and ask your foreground GPT Live Agent to connect to the editor.',
        )
      const s = getContext()
      const selected = snapshot.cursorSelection
      const sourceEditor = snapshot.editor
      const choice = await vscode.window.showQuickPick(
        spokenGhost ? ['Trace with explanations', 'Trace silently'] : ['Trace silently'],
        { title: selected.isEmpty ? 'Practise this file' : 'Practise the selection' },
      )
      if (!choice) return
      try {
        if (
          sourceEditor !== vscode.window.activeTextEditor ||
          !sourceEditor.selection.isEqual(selected)
        )
          throw Error('The selection changed. Start practice again.')
        const result = await handle({
          action: 'ghost_practice',
          snapshot: s.snapshot,
          scope: selected.isEmpty ? 'file' : 'selection',
          spoken: choice === 'Trace with explanations',
        })
        ghost.askForNotes(result.token)
      } catch (error) {
        void vscode.window.showWarningMessage(error.message)
      }
    }),
    vscode.commands.registerCommand('threadlight.coach.next', next),
    vscode.commands.registerCommand('threadlight.coach.walkthroughAuto', (id, auto) => {
      const w = walk.current()
      if (w && id === w.id && auto === w.auto) walk.toggle(w.token)
    }),
    vscode.commands.registerCommand('threadlight.coach.walkthroughControls', walkthroughControls),
    vscode.commands.registerCommand('threadlight.coach.cancelGuide', () => {
      if (ghost.practicing()) return ghost.stop()
      if (walk.current()) return walk.stop()
      if (plan) return transition(plan.token, 'cancel', 'editor')
    }),
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-remote' }],
      {
        onDidChangeCodeLenses: lenses.event,
        provideCodeLenses(doc) {
          const w = walk.current()
          if (w?.editor.document === doc) {
            const range = doc.lineAt(w.line - 1).range
            return [
              new vscode.CodeLens(range, {
                command: 'threadlight.coach.walkthroughAuto',
                title: w.auto ? '☑ Auto' : '☐ Auto',
                tooltip: 'Advance after each spoken explanation',
                arguments: [w.id, w.auto],
              }),
              new vscode.CodeLens(range, {
                command: 'threadlight.coach.next',
                title: stepLabel(w),
                arguments: [{ id: w.id, label: stepLabel(w) }],
              }),
            ]
          }
          if (!plan || doc !== plan.editor.document) return []
          if (plan.paused)
            return [
              new vscode.CodeLens(doc.lineAt(0).range, {
                command: 'threadlight.coach.next',
                title: label(),
                arguments: [{ id: plan.id, index: plan.index, token: plan.token }],
              }),
            ]
          if (doc.version !== plan.version) return []
          return [
            new vscode.CodeLens(doc.lineAt(plan.steps[plan.index].line - 1).range, {
              command: 'threadlight.coach.next',
              title: label(),
              tooltip: plan.steps[plan.index].hint,
              arguments: [{ id: plan.id, index: plan.index, token: plan.token }],
            }),
          ]
        },
      },
    ),
    vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent(uri) {
        return previews.get(uri.toString()) ?? ''
      },
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (walk.current()?.editor.document === doc) walk.stop('ended')
      previews.delete(doc.uri.toString())
      if (plan?.editor.document === doc) clearPlan()
      if (snapshot?.editor.document === doc) snapshot = undefined
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      review.clear()
      if (walk.current() && walk.current().editor !== editor) walk.stop('ended')
      if (plan && editor !== plan.editor) {
        plan.watchExpected = false
        pausePlan(true)
      }
      if (snapshot && snapshot.editor !== editor) {
        snapshot.selection = undefined
        snapshot.traceEligible = false
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(({ textEditor, selections, kind }) => {
      const w = walk.current()
      if (
        w?.editor === textEditor &&
        kind === vscode.TextEditorSelectionChangeKind.Mouse &&
        selections.length === 1
      ) {
        walk.selected(selections[0])
      }
      if (
        snapshot?.editor === textEditor &&
        (selections.length !== 1 ||
          !selections[0].isEqual(snapshot.cursorSelection) ||
          selections[0].isReversed !== snapshot.cursorSelection.isReversed)
      )
        snapshot.traceEligible = false
      if (
        snapshot?.editor === textEditor &&
        snapshot.selection &&
        (selections.length !== 1 ||
          !selections[0].isEqual(snapshot.selection) ||
          selections[0].isReversed !== snapshot.selection.isReversed)
      )
        snapshot.selection = undefined
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      if (!plan || plan.paused) return
      const editor = editors.find((e) => e.document === plan.editor.document)
      if (editor && editor !== plan.editor && editor.document.version === plan.version) {
        plan.editor = editor
        editor.setDecorations(decoration, [
          editor.document.lineAt(plan.steps[plan.index].line - 1).range,
        ])
      }
    }),
    vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
      if (walk.current()?.editor.document === document && contentChanges.length) walk.stop('ended')
      const p = plan
      if (
        !p ||
        document !== p.editor.document ||
        document.version === p.version ||
        !contentChanges.length
      )
        return
      const line = p.steps[p.index].line - 1
      if (
        contentChanges.some(
          (change) =>
            change.range.start.line !== line ||
            change.range.end.line !== line ||
            /[\r\n]/.test(change.text),
        )
      )
        p.watchExpected = false
      pausePlan()
      checkExpectedEdit(p)
    }),
  )
}
module.exports = { activate }
