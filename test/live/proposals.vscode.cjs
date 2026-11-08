/* global document, getComputedStyle */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

// Scroll the intended editor even while a review control holds keyboard focus.
function scrollEightPages(editor, to) {
  const top = editor.visibleRanges[0]
  const page = Math.max(1, top.end.line - top.start.line + 1)
  const target =
    to === 'up'
      ? editor.selection.start.line
      : Math.min(editor.document.lineCount - 1, editor.selection.start.line + page * 8)
  editor.revealRange(new vscode.Range(target, 0, target, 0), vscode.TextEditorRevealType.AtTop)
}

async function checkProposals({ root, coach, session, page, until }) {
  const file = path.join(root, 'changes.py'),
    disk = '# saved fixture\n'
  fs.writeFileSync(file, disk)
  const doc = await vscode.workspace.openTextDocument(file)
  const editor = await vscode.window.showTextDocument(doc)
  const run = (cmd) => coach.run(session, cmd)
  const command = (name) => vscode.commands.executeCommand('threadlight.coach.' + name)
  const status = () => run({ action: 'proposal_status' })
  const source = [
    'total = 1',
    'print(total)',
    ...Array.from({ length: 90 }, () => '# this misleading comment claims total is undefined'),
    'print(total)',
    'print("🐍")',
  ].join('\n')
  const groups = [
    {
      explanation: 'Rename both references here.',
      edits: [
        { line: 1, column: 0, oldText: 'total', newText: 'subtotal' },
        { line: 2, column: 6, oldText: 'total', newText: 'subtotal' },
      ],
    },
    {
      explanation: 'Remove the repeated line.',
      edits: [{ line: 93, column: 0, oldText: 'print(total)\n', newText: '' }],
    },
    {
      explanation: 'Insert a label after the snake.',
      edits: [{ line: 94, column: 9, oldText: '', newText: ' label' }],
    },
  ]
  const review = async () => {
    let p = await run({ action: 'review' })
    while (p.nextPage) p = await run({ action: 'review', nextPage: p.nextPage })
    assert.equal(p.status, 'complete')
    return p.snapshot
  }
  const start = async (g = groups) =>
    run({ action: 'propose', snapshot: await review(), proposals: g })
  assert.ok((await run({ action: 'capabilities' })).actions.includes('propose'))
  for (const eol of [vscode.EndOfLine.LF, vscode.EndOfLine.CRLF]) {
    await editor.edit((b) => {
      b.setEndOfLine(eol)
      b.replace(
        new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end),
        source,
      )
    })
    const before = doc.getText(),
      version = doc.version
    editor.selection = new vscode.Selection(0, 0, 0, 0)
    const invalid = (g) => start([{ explanation: 'Check the original text', edits: g }])
    await assert.rejects(
      invalid([{ line: 1, column: 1, oldText: 'total', newText: 'value' }]),
      /does not match/,
    )
    await assert.rejects(
      invalid([{ line: 94, column: 8, oldText: '', newText: 'x' }]),
      /does not match/,
    )
    await assert.rejects(start([groups[0], groups[0]]), /overlap/)
    assert.equal((await status()).status, 'idle')
    const t = Date.now()
    const first = await start()
    console.log('PASS paged review to visible proposal in ' + (Date.now() - t) + 'ms.')
    assert.equal(first.status, 'shown')
    if (page) {
      const widget = page.locator('.review-widget')
      const code = widget.locator('pre code')
      await code.waitFor()
      const diff = await code.textContent()
      assert.match(diff, /1 − total = 1/)
      assert.match(diff, /1 \+ subtotal = 1/)
      const backgrounds = await code
        .locator('span[style]')
        .evaluateAll(
          (spans) => new Set(spans.map((span) => getComputedStyle(span).backgroundColor)).size,
        )
      assert.ok(backgrounds >= 6, 'row tint and fade survived the comment renderer')
      await widget.getByRole('link', { name: 'Result', exact: true }).click()
      await widget.getByRole('link', { name: 'Hide result' }).waitFor()
      assert.doesNotMatch(await code.textContent(), /−|\+/)
      assert.match(await code.textContent(), /subtotal = 1/)
      await widget.getByRole('link', { name: 'Why this edit?' }).click()
      await widget.getByText(groups[0].explanation, { exact: true }).waitFor()
      const scroll = (to) => scrollEightPages(editor, to)
      const seesTarget = () =>
        editor.visibleRanges.some((range) => range.contains(editor.selection.start))
      await scroll('down')
      await until(() => !seesTarget())
      // Stay away past the old scroll-to-dismiss timeout.
      await new Promise((resolve) => setTimeout(resolve, 400))
      const offscreen = await status()
      assert.equal(offscreen.status, 'pending')
      assert.equal(offscreen.explanation, undefined)
      assert.equal(offscreen.token, first.token)
      await command('acceptProposal')
      assert.equal(doc.version, version)
      assert.equal((await status()).token, first.token)
      await scroll('up')
      await until(seesTarget)
      assert.equal((await status()).status, 'shown')
      assert.equal((await status()).token, first.token)
      await widget.getByRole('link', { name: 'Hide result' }).waitFor()
      await widget.getByText(groups[0].explanation, { exact: true }).waitFor()
      await widget.getByRole('link', { name: 'Hide result' }).click()
      await until(async () => (await code.textContent()) === diff)
      await widget.getByRole('link', { name: 'Why this edit?' }).click()
      await widget.getByText(groups[0].explanation, { exact: true }).waitFor({ state: 'hidden' })
      if (eol === vscode.EndOfLine.LF)
        await widget.screenshot({ path: path.join(root, 'compact-proposal.png') })
      assert.equal(doc.version, version)
      await vscode.window.showTextDocument(doc)
    }
    const second = await run({ action: 'proposal_next', token: first.token })
    assert.equal(second.line, 93)
    assert.equal((await run({ action: 'proposal_next', token: first.token })).applied, false)
    if (page) {
      await page.keyboard.press('Alt+Backspace')
      await until(async () => {
        const s = await status()
        return s.line === 94 && s.status === 'shown'
      })
    } else await command('skipProposal')
    assert.equal((await status()).line, 94)
    assert.equal(doc.version, version)
    await command('nextProposal')
    assert.equal((await status()).status, 'shown')
    assert.equal((await status()).line, 1)
    if (page) {
      const focused = () =>
        page.evaluate(() => ({
          focus: document.activeElement.className,
          hasFocus: document.hasFocus(),
        }))
      const previous = await focused()
      await page.keyboard.press('Tab')
      try {
        await until(() => doc.lineAt(0).text === 'subtotal = 1')
      } catch (error) {
        await page.screenshot({ path: path.join(root, 'proposal-key.png') })
        throw Error(
          'Tab interaction ' +
            JSON.stringify({
              previous,
              now: await focused(),
              state: await status(),
              selection: doc.getText(editor.selection),
              line: doc.lineAt(0).text,
            }) +
            ' ' +
            error.message,
          { cause: error },
        )
      }
    } else await command('acceptProposal')
    assert.equal(
      doc.getText(),
      before.replace('total =', 'subtotal =').replace('print(total)', 'print(subtotal)'),
    )
    assert.equal((await status()).status, 'pending')
    await command('nextProposal')
    assert.equal((await status()).line, 94)
    await command('acceptProposal')
    assert.equal(doc.lineAt(93).text, 'print("🐍 label")')
    await vscode.commands.executeCommand('undo')
    await vscode.commands.executeCommand('undo')
    assert.equal(doc.getText(), before)
    await start([groups[1]])
    if (page) {
      const anchor = editor.selection.start
      editor.revealRange(doc.lineAt(0).range, vscode.TextEditorRevealType.AtTop)
      await until(async () => (await status()).status === 'pending')
      editor.revealRange(doc.lineAt(anchor.line).range, vscode.TextEditorRevealType.InCenter)
      await until(async () => (await status()).status === 'shown')
    }
    await command('acceptProposal')
    assert.equal(doc.lineAt(92).text, 'print("🐍")')
    await vscode.commands.executeCommand('undo')
    assert.equal(doc.getText(), before)
    assert.equal(fs.readFileSync(file, 'utf8'), disk)
  }
  const old = await review()
  await editor.edit((b) => b.insert(doc.lineAt(1).range.end, ' # my correction'))
  await assert.rejects(run({ action: 'propose', snapshot: old, proposals: groups }), /Review/)
  await start()
  assert.equal(
    vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection),
    'total',
  )
  await vscode.commands.executeCommand('type', { text: 'my_total' })
  assert.equal(doc.lineAt(0).text, 'my_total = 1')
  assert.equal((await status()).status, 'idle')
  const before = doc.getText()
  await command('acceptProposal')
  assert.equal(doc.getText(), before)
  await start([groups[1]])
  const other = await vscode.workspace.openTextDocument({ language: 'python', content: 'pass' })
  await vscode.window.showTextDocument(other)
  await vscode.window.showTextDocument(doc)
  assert.equal((await status()).status, 'idle')
  console.log(
    'PASS selection-free dirty paged Python proposals, duplicate anchors, grouped edits, LF/CRLF deletion/insertion, navigation, stale tokens, typing, switched editor, unchanged disk and Undo.',
  )
  if (page) {
    const receiptText = [
      'inv = {"apple": 0.50}',
      'order = {}',
      '',
      'while True:',
      '    choice = input("Item: ").strip().lower()',
      '',
      '    if choice in inv:',
      '        if choice in order:',
      '            order[choice] =+ 1',
      '    else:',
      '        order[choice] = 1',
      '    elif choice == "done":',
      '        break',
    ].join('\n')
    const receipt = await vscode.workspace.openTextDocument({
      language: 'python',
      content: receiptText,
    })
    await vscode.window.showTextDocument(receipt)
    const version = receipt.version
    const explanation = 'Count repeat items with += and align else with the existing-order check.'
    await start([
      {
        explanation,
        edits: [
          { line: 9, column: 26, oldText: '=+', newText: '+=' },
          { line: 10, column: 4, oldText: '', newText: '    ' },
          { line: 11, column: 8, oldText: '', newText: '    ' },
        ],
      },
    ])
    const widget = page.locator('.review-widget')
    const code = widget.locator('pre code')
    await until(async () => (await code.textContent()).includes('····else:'))
    assert.equal(await widget.getByText(explanation, { exact: true }).count(), 0)
    await widget.screenshot({ path: path.join(root, 'receipt-inline-review.png') })
    await widget.getByRole('link', { name: 'Result', exact: true }).focus()
    await page.keyboard.press('Enter')
    await until(async () => (await code.textContent()).includes('10           else:'))
    assert.equal(receipt.version, version)
    await command('acceptProposal')
    assert.equal(receipt.lineAt(8).text, '            order[choice] += 1')
    assert.equal(receipt.lineAt(9).text, '        else:')
    assert.equal(receipt.lineAt(10).text, '            order[choice] = 1')
    await vscode.commands.executeCommand('undo')
    assert.equal(receipt.getText().replace(/\r\n/g, '\n'), receiptText)
    console.log(
      'PASS receipt diff, changed indentation, keyboard Result toggle, group acceptance and single Undo.',
    )
  }
  const py = await vscode.workspace.openTextDocument({
    language: 'python',
    content: 'subtotal = 1\nprint(subtotal)\n',
  })
  const pe = await vscode.window.showTextDocument(py)
  const config = vscode.workspace.getConfiguration('threadlight.coach')
  await config.update('pythonSuggestions', true, vscode.ConfigurationTarget.Global)
  try {
    pe.selection = new vscode.Selection(2, 0, 2, 0)
    if (page) {
      await page.keyboard.type('pri')
      const start = Date.now()
      const ghost = page.locator(
        '.ghost-text, .ghost-text-decoration, .ghost-text-decoration-preview',
      )
      await until(async () => (await ghost.allTextContents()).join('').includes('nt(subtotal)'))
      console.log(
        'PASS automatic Python ghost visible after ' +
          (Date.now() - start) +
          'ms from typed prefix.',
      )
      await page.keyboard.press('Escape')
      await page.keyboard.type('xyz')
      await new Promise((r) => setTimeout(r, 450))
      assert.ok(!(await ghost.allTextContents()).join('').includes('subtotal'))
    }
    const peer = vscode.languages.registerInlineCompletionItemProvider(
      { language: 'python' },
      {
        provideInlineCompletionItems(d, pos) {
          if (d === py && d.lineAt(pos.line).text === 'xyz')
            return [new vscode.InlineCompletionItem('_peer', new vscode.Range(pos, pos))]
          return []
        },
      },
    )
    try {
      if (page) {
        const negatives = ['# quiet comment', 'isolated_choice_zz', 'pass', 'xyz']
        let noisy = 0
        for (const input of negatives) {
          const ln = py.lineCount - 1
          pe.selection = new vscode.Selection(ln, 0, ln, py.lineAt(ln).text.length)
          await vscode.commands.executeCommand('type', { text: input })
          await new Promise((r) => setTimeout(r, 450))
          const ghost = page.locator(
            '.ghost-text, .ghost-text-decoration, .ghost-text-decoration-preview',
          )
          const displayed = (await ghost.allTextContents()).join('')
          if (input === 'xyz') {
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')
            await until(async () => (await ghost.allTextContents()).join('').includes('_peer'))
          } else if (displayed.trim()) noisy++
        }
        assert.equal(noisy, 0)
        console.log(
          'PASS 0 unwanted ghosts in three negative examples; second inline provider rendered its own suggestion.',
        )
        await page.keyboard.press('Escape')
      }
    } finally {
      peer.dispose()
    }
    await pe.edit((b) => b.replace(new vscode.Range(0, 0, 0, 8), 'a'))
    await pe.edit((b) => b.insert(new vscode.Position(0, 1), 'mount'))
    await new Promise((r) => setTimeout(r, 500))
    await command('showPredicted')
    assert.equal((await status()).line, 2)
    if (page) {
      await until(() =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('.view-line span')).some((el) =>
            getComputedStyle(el, '::after').content.includes('amount'),
          ),
        ),
      )
      await page.screenshot({ path: path.join(root, 'related-edit.png') })
    }
    await command('acceptProposal')
    assert.equal(py.lineAt(1).text, 'print(amount)')
    await vscode.commands.executeCommand('undo')
    assert.equal(py.lineAt(1).text, 'print(subtotal)')
    const repeat = await vscode.workspace.openTextDocument({
      language: 'python',
      content: 'breakpoint()\nvalue = 1\nbreakpoint()\nprint(value)',
    })
    const re = await vscode.window.showTextDocument(repeat)
    await re.edit((b) => b.delete(repeat.lineAt(0).rangeIncludingLineBreak))
    await new Promise((r) => setTimeout(r, 450))
    const proposed = await command('showPredicted')
    assert.equal(proposed.line, 2)
    await command('acceptProposal')
    assert.equal(repeat.getText(), 'value = 1\nprint(value)')
    await vscode.commands.executeCommand('undo')
    assert.equal(repeat.getText(), 'value = 1\nbreakpoint()\nprint(value)')
    console.log(
      'PASS Python related rename and whole-statement deletion, navigation, accept and Undo.',
    )
  } finally {
    await config.update('pythonSuggestions', undefined, vscode.ConfigurationTarget.Global)
  }
}
async function checkProposalSpeech({ coach, session, descriptor, EditorCoach, until }) {
  coach.close()
  await new Promise((r) => setTimeout(r, 80))
  const doc = await vscode.workspace.openTextDocument({
    language: 'python',
    content: 'first = 1\nsecond = 2',
  })
  const editor = await vscode.window.showTextDocument(doc)
  let release,
    delayedVoice,
    queuedExplanations = 0,
    interrupted = 0
  const held = new Promise((r) => {
      release = r
    }),
    spoken = []
  const live = new EditorCoach(
    () => session,
    async (_id, phrase) => {
      if (delayedVoice) {
        queuedExplanations++
        return delayedVoice.coachStep(phrase, true, true)
      }
      if (phrase === 'Speech unavailable') throw Error('Fixture voice disconnected')
      spoken.push(phrase)
      assert.ok(editor.visibleRanges.some((r) => r.contains(editor.selection.start)))
      await held
    },
    descriptor,
    undefined,
    () => {
      interrupted++
      delayedVoice?.interruptProposal()
    },
  )
  try {
    const page = await live.run(session, { action: 'review' })
    const propose = live.run(session, {
      action: 'propose',
      snapshot: page.snapshot,
      narrate: true,
      proposals: ['first', 'second'].map((name, i) => ({
        explanation: name,
        edits: [
          {
            line: i + 1,
            column: 0,
            oldText: name,
            newText: name + '_value',
          },
        ],
      })),
    })
    await until(() => spoken.length === 1)
    await vscode.commands.executeCommand('threadlight.coach.nextProposal')
    await vscode.commands.executeCommand('type', { text: 'mine' })
    await until(() => doc.lineAt(1).text === 'mine = 2')
    release()
    assert.equal((await propose).status, 'interrupted')
    await new Promise((r) => setTimeout(r, 80))
    assert.deepEqual(spoken, ['first'])
    assert.ok(interrupted >= 1)
    assert.equal(doc.getText(), 'first = 1\nmine = 2')
    assert.equal((await live.run(session, { action: 'proposal_status' })).status, 'idle')
    const fresh = await live.run(session, { action: 'review' })
    const silent = await live.run(session, {
      action: 'propose',
      snapshot: fresh.snapshot,
      narrate: true,
      proposals: [
        {
          explanation: 'Speech unavailable',
          edits: [{ line: 1, column: 0, oldText: 'first', newText: 'other' }],
        },
      ],
    })
    assert.equal(silent.status, 'shown')
    assert.equal(silent.narration, 'unavailable')
    assert.equal(doc.getText(), 'first = 1\nmine = 2')
    await editor.edit((edit) =>
      edit.insert(doc.positionAt(doc.getText().length), '\n' + 'pass\n'.repeat(240)),
    )
    const scrollPage = await live.run(session, { action: 'review' })
    const visible = await live.run(session, {
      action: 'propose',
      snapshot: scrollPage.snapshot,
      narrate: true,
      proposals: [
        {
          explanation: 'Explain only while visible',
          edits: [{ line: 1, column: 0, oldText: 'first', newText: 'replacement' }],
        },
      ],
    })
    assert.equal(visible.narration, 'submitted')
    const count = spoken.length
    const status = () => live.run(session, { action: 'proposal_status' })
    const scroll = (to) => scrollEightPages(editor, to)
    await scroll('down')
    await until(async () => (await status()).status === 'pending')
    const hidden = await status()
    assert.equal(hidden.token, visible.token)
    assert.equal(hidden.explanation, undefined)
    await scroll('up')
    await until(async () => (await status()).status === 'shown')
    assert.equal((await status()).token, visible.token)
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(spoken.length, count)
    console.log(
      'PASS offscreen proposal retained its token with no explanation or repeat narration on return.',
    )
    const { CodexLive } = require('../../src/main/agent/codexLive.ts')
    const submissions = []
    delayedVoice = new CodexLive(
      {
        request: async (_method, params) => {
          submissions.push(params.text)
          return {}
        },
      },
      'fixture-thread',
      'fixture-session',
      () => {},
      () => {},
    )
    delayedVoice.beginTurn('progress-turn')
    const ack = 'I’ll check the current editor buffer.'
    delayedVoice.completedCommentary('progress-turn', {
      type: 'agentMessage',
      phase: 'commentary',
      id: 'reading',
      text: ack,
    })
    delayedVoice.playbackBoundary('assistant', 'progress-audio')
    const pendingPage = await live.run(session, { action: 'review' })
    const waiting = live.run(session, {
      action: 'propose',
      snapshot: pendingPage.snapshot,
      narrate: true,
      proposals: [
        {
          explanation: 'Do not speak this offscreen change',
          edits: [{ line: 1, column: 0, oldText: 'first', newText: 'alternative' }],
        },
      ],
    })
    await until(() => queuedExplanations === 1)
    assert.equal(submissions.length, 1)
    await scroll('down')
    await until(() => !editor.visibleRanges.some((range) => range.contains(editor.selection.start)))
    assert.notEqual((await waiting).narration, 'submitted')
    const retained = await status()
    assert.equal(retained.status, 'pending')
    assert.equal(retained.explanation, undefined)
    delayedVoice.playbackBoundary('done', 'progress-audio', ack)
    editor.revealRange(new vscode.Range(0, 0, 0, 1), vscode.TextEditorRevealType.AtTop)
    await until(async () => (await status()).status === 'shown')
    assert.equal((await status()).token, retained.token)
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(submissions.length, 1)
    assert.equal(queuedExplanations, 1)
    delayedVoice.disconnect('test completed')
    console.log(
      'PASS scrolling out of view during progress playback cancelled queued instruction; returning retained the proposal without unauthorized narration.',
    )
    console.log(
      'PASS typing wins during narration, stale queued speech cancelled, old receipt returned interrupted.',
    )
  } finally {
    release()
    live.close()
    await new Promise((r) => setTimeout(r, 80))
  }
}
module.exports = { checkProposals, checkProposalSpeech }
