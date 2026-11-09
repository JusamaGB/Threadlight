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
  let editor = await vscode.window.showTextDocument(doc)
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
  assert.ok((await run({ action: 'capabilities' })).actions.includes('proposal_line'))
  const tracker = await vscode.workspace.openTextDocument({
    language: 'python',
    content: '# Write your solution below.\n',
  })
  await vscode.window.showTextDocument(tracker)
  const beforeWalk = tracker.getText(),
    beforeVersion = tracker.version
  const solution = [
    'def round_up_to_six(minutes):',
    '    return ((minutes + 5) // 6) * 6',
    '',
    'def main():',
    '    sessions = 0',
  ]
  const proposal = await start([
    {
      explanation: 'Round each session up to a six-minute unit.',
      edits: [{ line: 2, column: 0, oldText: '', newText: solution.join('\n') + '\n' }],
    },
  ])
  const walk = (row) => run({ action: 'proposal_line', token: proposal.token, row })
  const firstRow = await walk()
  assert.equal(firstRow.text, solution[0])
  assert.equal(firstRow.highlighted, true)
  const rounding = await walk(2)
  assert.equal(rounding.kind, 'add')
  assert.equal(rounding.text, solution[1])
  assert.equal(rounding.highlighted, true)
  const preview = vscode.window.activeTextEditor
  assert.equal(preview.document.uri.scheme, 'threadlight-file-review')
  assert.equal(preview.document.getText(preview.selection), rounding.text)
  assert.deepEqual(await walk(), rounding, 'a follow-up stays on the rounding line')
  assert.equal((await walk(3)).text, '')
  assert.equal((await walk(2)).text, rounding.text)
  assert.equal((await walk(5)).text, solution[4])
  await assert.rejects(walk(6), /changed rows/)
  assert.equal((await status()).walkRow, 5)
  assert.equal((await status()).token, proposal.token)
  assert.equal(tracker.getText(), beforeWalk)
  assert.equal(tracker.version, beforeVersion)
  await command('dismissProposals')
  await assert.rejects(walk(2), /proposal changed/)
  assert.equal(tracker.getText(), beforeWalk)
  await vscode.window.showTextDocument(tracker)
  const replacement = await start([
    {
      explanation: 'Replace the exercise comment.',
      edits: [{ line: 1, column: 0, oldText: '# Write your solution below.', newText: 'pass' }],
    },
  ])
  const replacementLine = (row) => run({ action: 'proposal_line', token: replacement.token, row })
  assert.equal((await replacementLine(1)).kind, 'remove')
  assert.equal((await replacementLine(2)).text, 'pass')
  await command('acceptProposal')
  assert.equal(tracker.lineAt(0).text, 'pass')
  await vscode.commands.executeCommand('undo')
  assert.equal(tracker.getText(), beforeWalk)
  await assert.rejects(replacementLine(2), /proposal changed/)
  const changed = await start([
    {
      explanation: 'Insert the tracker helper.',
      edits: [{ line: 2, column: 0, oldText: '', newText: solution.join('\n') }],
    },
  ])
  await run({ action: 'proposal_line', token: changed.token, row: 2 })
  const externalEdit = new vscode.WorkspaceEdit()
  externalEdit.insert(tracker.uri, tracker.lineAt(0).range.end, ' edited')
  assert.ok(await vscode.workspace.applyEdit(externalEdit))
  await assert.rejects(
    run({ action: 'proposal_line', token: changed.token, row: 3 }),
    /proposal changed/,
  )
  editor = await vscode.window.showTextDocument(doc)
  console.log(
    'PASS tracker pending proposal walkthrough, highlight, follow-up, navigation and dismissal.',
  )
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
      assert.equal(await page.locator('.review-widget').count(), 0)
      assert.ok(editor.selection.isEmpty)
      const control = (name) => page.locator('.statusbar-item').getByText(name, { exact: true })
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
      await control('Result').click()
      await until(
        () => vscode.window.activeTextEditor?.document.uri.scheme === 'threadlight-file-review',
      )
      assert.match(
        vscode.window.activeTextEditor.document.getText(),
        /^subtotal = 1\r?\nprint\(subtotal\)/,
      )
      await control('Hide result').click()
      await until(() => vscode.window.activeTextEditor?.document === doc)
      editor = vscode.window.activeTextEditor
      await control('Why this edit?').click()
      await page.getByText(groups[0].explanation, { exact: true }).first().waitFor()
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
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    await vscode.commands.executeCommand('undo')
    await until(() => doc.lineAt(93).text === 'print("🐍")')
    await vscode.commands.executeCommand('undo')
    await until(() => doc.getText() === before)
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
  assert.equal(vscode.window.activeTextEditor.selection.isEmpty, true)
  await vscode.commands.executeCommand('type', { text: 'my_' })
  assert.equal(doc.lineAt(0).text, 'my_total = 1')
  assert.equal((await status()).status, 'idle')
  const before = doc.getText()
  await command('acceptProposal')
  assert.equal(doc.getText(), before)
  const retained = await start([groups[1]])
  const other = await vscode.workspace.openTextDocument({ language: 'python', content: 'pass' })
  await vscode.window.showTextDocument(other)
  assert.equal((await status()).status, 'pending')
  await command('acceptProposal')
  assert.equal(other.getText(), 'pass')
  editor = await vscode.window.showTextDocument(doc)
  await until(async () => (await status()).status === 'shown')
  assert.equal((await status()).token, retained.token)
  await command('dismissProposals')
  console.log(
    'PASS selection-free dirty paged Python proposals, duplicate anchors, grouped edits, LF/CRLF deletion/insertion, navigation, stale tokens, typing, switched editor, unchanged disk and Undo.',
  )
  if (page) {
    const receiptText = [
      'inv = {"apple": 0.50, "pear": 1.0, "bread": 1.50}',
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
      '',
      '    break',
      '',
      'total = 0',
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
          {
            line: 13,
            column: 4,
            oldText: 'break',
            newText: 'elif choice == "done":\n        break',
          },
        ],
      },
    ])
    assert.equal(await page.locator('.review-widget').count(), 0)
    assert.ok(vscode.window.activeTextEditor.selection.isEmpty)
    assert.equal(vscode.window.activeTextEditor.document, receipt)
    const images = () =>
      page.locator('.view-line span').evaluateAll((spans) =>
        spans
          .map((el) => getComputedStyle(el, '::before').content)
          .filter((text) => text.includes('data:image/svg+xml;base64,'))
          .map((text) => atob(text.split('base64,')[1].split('"')[0])),
      )
    await until(async () => (await images()).some((image) => image.includes('elif choice')))
    assert.ok((await images()).some((image) => image.includes('break</text>')))
    assert.ok(
      (await images()).every(
        (image) => !image.includes('>    break</text>') || image.includes('url(#added'),
      ),
    )
    await vscode.commands.executeCommand('workbench.action.closeSidebar')
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
    await page
      .locator('.editor-instance')
      .first()
      .screenshot({ path: path.join(root, 'receipt-source-rows.png') })
    assert.equal(receipt.version, version)
    await command('acceptProposal')
    assert.equal(receipt.lineAt(8).text, '            order[choice] += 1')
    assert.equal(receipt.lineAt(9).text, '        else:')
    assert.equal(receipt.lineAt(10).text, '            order[choice] = 1')
    assert.equal(receipt.lineAt(12).text, '    elif choice == "done":')
    assert.equal(receipt.lineAt(13).text, '        break')
    await vscode.commands.executeCommand('undo')
    assert.equal(receipt.getText().replace(/\r\n/g, '\n'), receiptText)
    console.log(
      'PASS in-file stacked replacements, standalone addition, empty caret, no comment widget, group acceptance and Undo.',
    )
    const loop = [
      'for entry in order:',
      '    print(f"{entry}: £{inv[entry]:.2f}")',
      '    total += inv[entry]',
    ].join('\n')
    const replacement = [
      'for entry, quantity in order.items():',
      '    line_total = quantity * inv[entry]',
      '    print(f"{entry}: {quantity} x £{inv[entry]:.2f} = £{line_total:.2f}")',
      '    total += line_total',
    ].join('\n')
    const loopDoc = await vscode.workspace.openTextDocument({
      language: 'python',
      content: receiptText + '\n\n\nprint("Receipt: ")\n' + loop + '\n',
    })
    const loopEditor = await vscode.window.showTextDocument(loopDoc)
    const loopChange = [
      {
        explanation: 'Use the quantity in the receipt total.',
        edits: [{ line: 19, column: 0, oldText: loop, newText: replacement }],
      },
    ]
    await start(loopChange)
    assert.equal(vscode.window.activeTextEditor.document, loopDoc)
    assert.ok(loopEditor.selection.isEmpty)
    await until(async () => (await images()).some((image) => image.includes('total += line_total')))
    const art = (await images()).join('')
    for (const row of [...loop.split('\n'), ...replacement.split('\n')]) {
      assert.ok(art.includes(`width="${row.length + 4.5}ch"`), 'Own fade width for ' + row)
    }
    assert.match(
      art,
      new RegExp(
        'width="' +
          (receiptText.split('\n')[0].length + 4.5) +
          'ch" height="\\d+" fill="url\\(#current\\)"',
      ),
    )
    await vscode.commands.executeCommand('notifications.clearAll')
    await page
      .locator('.editor-instance')
      .first()
      .screenshot({ path: path.join(root, 'receipt-loop-in-file.png') })
    const tokenBeforeClick = (await status()).token
    const codeLine = (content) => page.locator('.view-line').filter({ hasText: content }).first()
    const oldLine = await codeLine('for entry in order:').boundingBox()
    assert.ok(oldLine)
    await page.mouse.click(oldLine.x + 65, oldLine.y + oldLine.height + 5)
    assert.equal((await status()).token, tokenBeforeClick)
    await codeLine('print("Receipt: ")').click({ position: { x: 80, y: 8 } })
    await until(() => loopEditor.selection.active.line === 17)
    await page.keyboard.press('Shift+ArrowRight')
    await until(() => !loopEditor.selection.isEmpty)
    assert.equal((await status()).token, tokenBeforeClick)
    assert.ok((await images()).some((image) => image.includes('total += line_total')))
    await page.keyboard.press('Tab')
    await until(() => loopDoc.getText().replace(/\r\n/g, '\n').includes(replacement))
    assert.ok(loopDoc.getText().replace(/\r\n/g, '\n').includes(replacement))
    await vscode.commands.executeCommand('undo')
    const extra = [
      {
        explanation: 'Show three additional receipt rows.',
        edits: [{ line: 19, column: 0, oldText: '', newText: 'first()\nsecond()\nthird()\n' }],
      },
    ]
    await start(extra)
    const preview = vscode.window.activeTextEditor.document
    assert.equal(preview.uri.scheme, 'threadlight-file-review')
    assert.deepEqual(
      [18, 19, 20, 21].map((i) => preview.lineAt(i).text),
      ['first()', 'second()', 'third()', 'for entry in order:'],
    )
    assert.equal(loopDoc.lineAt(18).text, 'for entry in order:')
    await command('acceptProposal')
    assert.equal(vscode.window.activeTextEditor.document, loopDoc)
    assert.equal(loopDoc.lineAt(18).text, 'first()')
    await vscode.commands.executeCommand('undo')
    const fallback = await start(extra)
    const reviewDoc = vscode.window.activeTextEditor.document
    await vscode.window.showTextDocument(loopDoc)
    await until(async () => (await status()).status === 'pending')
    await command('acceptProposal')
    assert.equal(loopDoc.lineAt(18).text, 'for entry in order:')
    await vscode.window.showTextDocument(reviewDoc)
    await until(async () => (await status()).status === 'shown')
    assert.equal((await status()).token, fallback.token)
    await command('dismissProposals')
    console.log(
      'PASS receipt loop at line 19 in source and safe full-file fallback with original gutter numbers, acceptance, Undo and cancellation.',
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
    await vscode.commands.executeCommand('type', { text: 'my_' })
    await until(() => doc.lineAt(1).text === 'my_second = 2')
    release()
    assert.equal((await propose).status, 'interrupted')
    await new Promise((r) => setTimeout(r, 80))
    assert.deepEqual(spoken, ['first'])
    assert.ok(interrupted >= 1)
    assert.equal(doc.getText(), 'first = 1\nmy_second = 2')
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
    assert.equal(doc.getText(), 'first = 1\nmy_second = 2')
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
