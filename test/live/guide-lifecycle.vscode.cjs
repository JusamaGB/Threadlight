const assert = require('node:assert/strict')
const vscode = require('vscode')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await delay(30)
  }
  throw Error('Guide state timed out')
}
async function checkGuideLifecycle({ coach, session, descriptor, EditorCoach }) {
  const original = vscode.window.activeTextEditor.document
  coach.close()
  await delay(80)
  const doc = await vscode.workspace.openTextDocument({ content: 'a = 1\nb = 2\nprint(a + b)' })
  const editor = await vscode.window.showTextDocument(doc)
  const receipts = [],
    spoken = []
  let hold, started
  const bridge = new EditorCoach(
    () => session,
    async (_id, text) => {
      const line = await lens()
      assert.ok(line && editor.visibleRanges.some((r) => r.contains(line.range.start)))
      spoken.push(text)
      if (started) {
        started()
        await hold
      }
    },
    descriptor,
    async (_id, e) => receipts.push(e),
  )
  const run = (cmd) => bridge.run(session, cmd)
  const status = () => run({ action: 'guide_status' })
  const lens = async () =>
    (await vscode.commands.executeCommand('vscode.executeCodeLensProvider', doc.uri)).find(
      (l) => l.command?.command === 'threadlight.coach.next',
    )
  const click = async (item) =>
    vscode.commands.executeCommand(item.command.command, ...item.command.arguments)
  const steps = [
    { line: 1, hint: 'First', explanation: 'First step.' },
    { line: 3, hint: 'Last', explanation: 'Last step.' },
  ]
  const guide = async (extra = {}) =>
    run({
      action: 'guide',
      snapshot: (await run({ action: 'context' })).snapshot,
      steps,
      goal: 'Understand the sum',
      ...extra,
    })
  try {
    // Reproduce the receipt walkthrough using only a disposable editor.
    const beforeCheck = spoken.length
    const target = 'for entry in order:'
    const replaceLine = (text) => editor.edit((edit) => edit.replace(doc.lineAt(0).range, text))
    await replaceLine('for enrty in order')
    const exercise = () =>
      guide({
        steps: [
          {
            line: 1,
            hint: 'Spell entry and end with a colon.',
            explanation: 'Check the loop header.',
            expectedLine: target,
          },
        ],
      })
    await exercise()
    await replaceLine('for enrty in order:')
    await delay(260)
    assert.equal((await status()).status, 'paused')
    assert.equal(
      receipts.some((e) => e.origin === 'verified_edit'),
      false,
    )
    assert.equal(spoken.length, beforeCheck + 1)
    // A transient exact match must not complete if typing continues.
    await replaceLine(target)
    await replaceLine('for entry in order')
    await delay(240)
    assert.equal(
      receipts.some((e) => e.origin === 'verified_edit'),
      false,
    )
    await replaceLine(target)
    await waitFor(() => receipts.some((e) => e.origin === 'verified_edit'))
    const verified = receipts.find((e) => e.origin === 'verified_edit')
    assert.equal(verified.status, 'refresh_requested')
    await assert.rejects(
      run({ action: 'progress', intent: 'finish', token: verified.token }),
      /fresh context/,
    )
    const checkedHeader = await run({ action: 'context' })
    assert.equal(checkedHeader.lines[0].text, target)
    await replaceLine('for enrty in order:')
    assert.equal(
      (await run({ action: 'progress', intent: 'finish', token: verified.token })).applied,
      false,
    )
    await assert.rejects(
      run({ action: 'guide', resume: verified.token, snapshot: checkedHeader.snapshot, steps }),
      /refresh|changed/i,
    )
    // A natural done/check request follows the explicit fresh-context and token path.
    const current = await status()
    await run({ action: 'context' })
    const recheck = await run({ action: 'progress', intent: 'next', token: current.token })
    await guide({
      resume: recheck.token,
      steps: [
        { line: 1, hint: 'Check the spelling.', explanation: 'Check entry.', expectedLine: target },
      ],
    })
    await replaceLine(target)
    const ending = await status()
    await run({ action: 'progress', intent: 'cancel', token: ending.token })
    await delay(260)
    assert.equal(
      receipts.filter((e) => e.origin === 'verified_edit').length,
      1,
      'cancel invalidates pending check',
    )
    await replaceLine('for enrty in order')
    await exercise()
    await replaceLine('for enrty in order:')
    await replaceLine(target)
    await waitFor(() => receipts.filter((e) => e.origin === 'verified_edit').length === 2)
    const secondVerified = await status()
    const confirmed = await run({ action: 'context' })
    assert.equal(confirmed.lines[0].text, target)
    const nextGuide = await run({
      action: 'guide',
      resume: secondVerified.token,
      snapshot: confirmed.snapshot,
      steps: [{ line: 3, hint: 'Print the values.', explanation: 'Now print the values.' }],
    })
    assert.equal(nextGuide.line, 3)
    assert.equal(spoken.at(-1), 'Now print the values.')
    await run({ action: 'progress', intent: 'finish', token: nextGuide.token })
    await replaceLine('a = 1')
    receipts.length = 0
    spoken.length = 0
    const first = await guide()
    const firstLens = await lens()
    assert.equal(first.status, 'shown')
    await assert.rejects(
      bridge.run('different-owner', { action: 'progress', intent: 'next', token: first.token }),
      /Live has closed/,
    )
    editor.selection = new vscode.Selection(1, 0, 1, 0)
    assert.equal((await status()).token, first.token)
    const second = await run({ action: 'progress', intent: 'next', token: first.token })
    assert.equal(second.step, 2)
    await click(firstLens)
    assert.equal(
      (await run({ action: 'progress', intent: 'next', token: first.token })).applied,
      false,
    )
    assert.deepEqual(spoken, ['First step.', 'Last step.'])
    const lastLens = await lens()
    assert.match(lastLens.command.title, /Finish guide/)
    await click(lastLens)
    await waitFor(() => receipts.filter((e) => e.status === 'completed').length === 1)
    await click(lastLens)
    assert.equal((await status()).status, 'completed')
    await guide()
    const observed = await run({ action: 'context' })
    const expectedLine = doc.lineAt(0).text
    await run({
      action: 'trace',
      snapshot: observed.snapshot,
      anchor: { line: 1, column: expectedLine.length, expectedLine },
      text: ' # sum',
    })
    await vscode.commands.executeCommand('type', { text: ' # sum' })
    const pausedTrace = await status()
    assert.equal(pausedTrace.status, 'paused')
    assert.equal(pausedTrace.step, 1)
    await assert.rejects(
      run({ action: 'progress', token: pausedTrace.token, intent: 'next' }),
      /fresh context/,
    )
    const checked = await run({ action: 'context' })
    assert.equal(checked.trace.typed, ' # sum')
    const deliberate = await run({ action: 'progress', token: pausedTrace.token, intent: 'next' })
    assert.ok(deliberate.refreshRequested)
    const afterTrace = await guide({
      resume: deliberate.token,
      steps: [{ line: 3, hint: 'Now print', explanation: 'Print the checked sum.' }],
    })
    assert.equal(afterTrace.line, 3)
    await run({ action: 'progress', token: afterTrace.token, intent: 'finish' })
    await vscode.commands.executeCommand('undo')
    receipts.length = 0
    const originalSnapshot = (await run({ action: 'context' })).snapshot
    let release
    hold = new Promise((r) => {
      release = r
    })
    const speaking = new Promise((r) => {
      started = r
    })
    const request = run({
      action: 'guide',
      goal: 'Understand the sum',
      snapshot: originalSnapshot,
      steps,
    })
    await speaking
    await click(await lens()) // busy narration cannot advance
    await editor.edit((e) => e.insert(doc.positionAt(0), '# change during speech\n'))
    await waitFor(() => receipts.some((e) => e.status === 'paused'))
    release()
    await request
    started = null
    let paused = await status()
    assert.equal(paused.status, 'paused')
    assert.match((await lens()).command.title, /Refresh guide/)
    assert.equal(paused.step, 1)
    const refreshLens = await lens()
    await click(refreshLens)
    await click(refreshLens)
    await waitFor(() => receipts.some((e) => e.status === 'refresh_requested'))
    paused = await status()
    assert.equal(receipts.filter((e) => e.status === 'refresh_requested').length, 1)
    await assert.rejects(
      run({ action: 'guide', snapshot: originalSnapshot, resume: paused.token, steps }),
      /changed/,
    )
    const resumed = await guide({
      resume: paused.token,
      steps: [{ line: 4, hint: 'Updated sum', explanation: 'Updated line.' }],
    })
    assert.equal(resumed.goal, 'Understand the sum')
    assert.equal(resumed.guideId, paused.guideId)
    assert.equal(resumed.line, 4)
    await vscode.window.showTextDocument(original)
    await waitFor(async () => (await status()).status === 'paused')
    paused = await status()
    await assert.rejects(
      run({ action: 'progress', token: paused.token, intent: 'next' }),
      /original source/,
    )
    await vscode.window.showTextDocument(doc)
    const refresh = await run({ action: 'progress', token: paused.token, intent: 'next' })
    await run({ action: 'progress', token: refresh.token, intent: 'cancel' })
    assert.equal((await status()).status, 'cancelled')
    const early = await guide()
    assert.equal(
      (await run({ action: 'progress', token: early.token, intent: 'finish' })).status,
      'ended',
    )
    await guide()
    bridge.close()
    await waitFor(() => receipts.some((e) => e.status === 'disconnected'))
    console.log(
      'PASS real exact-line completion, quiet partial/typo edits, fresh-context continuation, stale and cancelled match protection, guide voice-command transition, stale click/token replay, final click acknowledgement, edit during speech, fresh-source refresh, file switch, cancellation and disconnection.',
    )
  } finally {
    bridge.close()
    await delay(80)
    await vscode.window.showTextDocument(original)
  }
}
async function exerciseLiveClicks({ root, editor, document, lenses }) {
  const fs = require('node:fs'),
    path = require('node:path')
  async function eventually(check) {
    for (let i = 0; i < 1200; i++) {
      const result = await check()
      if (result) return result
      await delay(100)
    }
    throw Error('Timed out waiting for signed-in guide transition')
  }
  await eventually(() => fs.existsSync(path.join(root, 'guide-second-speech')))
  await editor.edit((edit) =>
    edit.insert(document.positionAt(document.getText().length), '# learner edit'),
  )
  for (const title of [/Refresh guide/, /Finish guide/]) {
    const lens = await eventually(async () =>
      (await lenses()).find(
        (l) => l.command?.command === 'threadlight.coach.next' && title.test(l.command.title),
      ),
    )
    if (title.test('Finish guide')) {
      await eventually(() => fs.existsSync(path.join(root, 'guide-resumed-speech')))
      await delay(350)
    }
    await vscode.commands.executeCommand(lens.command.command, ...lens.command.arguments)
  }
}
module.exports = { checkGuideLifecycle, exerciseLiveClicks }
