/* global getComputedStyle */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

async function check({ session, descriptor, EditorCoach, until, page }) {
  const heard = [],
    aborted = []
  const bridge = new EditorCoach(
    () => session,
    async () => {},
    descriptor,
    async (_id, e) => {
      if (e.needsNotes) await prepare(await run({ action: 'walkthrough_page', token: e.token }))
    },
    undefined,
    async (_id, line, signal) => {
      heard.push(line)
      await new Promise((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted.push(line)
            resolve()
          },
          { once: true },
        ),
      )
    },
  )
  const run = (cmd) => bridge.run(session, cmd)
  const command = (name) => vscode.commands.executeCommand('threadlight.coach.' + name)
  const prepare = (p) =>
    run({
      action: 'walkthrough_notes',
      token: p.token,
      explanations: p.lines.map((r) => 'Explain ' + r.line),
    })
  const heardCount = (count) => until(() => heard.length === count)
  const source = Array.from({ length: 13 }, (_, i) =>
    i === 0 ? '  value = 1' : 'print(' + i + ')',
  ).join('\n')
  const doc = await vscode.workspace.openTextDocument({ language: 'python', content: source })
  await vscode.window.showTextDocument(doc)
  const ghost = () =>
    page.locator(
      '.monaco-editor .ghost-text, .monaco-editor .ghost-text-decoration, .monaco-editor .ghost-text-decoration-preview',
    )
  const visible = (str) =>
    until(async () => (await ghost().allTextContents()).join('').includes(str))
  const pause = () => new Promise((resolve) => setTimeout(resolve, 180))
  try {
    const s = await run({ action: 'context' })
    const p = await run({
      action: 'ghost_practice_text',
      text: source,
      snapshot: s.snapshot,
      spoken: true,
    })
    assert.equal(p.lines.length, 8)
    await visible('value')
    assert.equal(heard.length, 0)
    await page.keyboard.type('  v')
    await pause()
    assert.equal(heard.length, 0, 'Wait for notes when typing early')
    await prepare(p)
    await heardCount(1)
    assert.equal(heard[0], 'Explain 1')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('v')
    await pause()
    assert.equal(heard.length, 1)
    await page.keyboard.press('Enter')
    await visible('print')
    await page.keyboard.type('p')
    await heardCount(2)
    assert.deepEqual(aborted, ['Explain 1'])
    await command('toggleTraceSpeech')
    await until(() => aborted.length === 2)
    await page.keyboard.press('Enter')
    await page.keyboard.type('p')
    await pause()
    assert.equal(heard.length, 2)
    await command('toggleTraceSpeech')
    await command('replayTraceLine')
    await heardCount(3)
    await page.locator('.monaco-editor .line-numbers').filter({ hasText: /^12$/ }).first().click()
    await visible('print')
    await page.keyboard.type('p')
    await heardCount(4)
    assert.equal(heard.at(-1), 'Explain 12')
    await page.keyboard.press('Enter')
    await visible('print')
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit')
    await until(() => vscode.window.activeTextEditor.document.lineAt(12).text === 'print(12)')
    await pause()
    assert.equal(heard.length, 4)
    assert.equal(doc.getText(), source)
    await command('cancelGuide')
    const reopened = await vscode.window.showTextDocument(doc)
    reopened.selection = new vscode.Selection(1, 1, 2, 3)
    const sel = await run({ action: 'context' })
    const part = await run({
      action: 'ghost_practice',
      scope: 'selection',
      snapshot: sel.snapshot,
      spoken: true,
    })
    assert.deepEqual(
      part.lines.map((r) => r.text),
      ['rint(1)', 'pri'],
    )
    assert.equal(part.location, 'current')
    assert.equal(vscode.window.activeTextEditor.document, doc)
    await command('cancelGuide')
    await vscode.window.showTextDocument(doc)
    const review = await run({ action: 'review' })
    const proposal = await run({
      action: 'propose',
      snapshot: review.snapshot,
      proposals: [
        {
          explanation: 'Change the value',
          edits: [{ line: 1, column: 10, oldText: '1', newText: '2' }],
        },
      ],
    })
    const diff = await run({ action: 'ghost_practice_diff', token: proposal.token, spoken: true })
    assert.deepEqual(
      diff.lines.map((r) => [r.kind, r.text]),
      [
        ['remove', '  value = 1'],
        ['add', '  value = 2'],
      ],
    )
    assert.equal(doc.getText(), source)
    await command('cancelGuide')
    const blank = await vscode.workspace.openTextDocument({ language: 'python', content: '' })
    await vscode.window.showTextDocument(blank)
    const ctx = await run({ action: 'context' })
    const block = await run({
      action: 'trace',
      snapshot: ctx.snapshot,
      anchor: { line: 1, column: 0, expectedLine: '' },
      text: 'first\nsecond',
      spoken: true,
    })
    await prepare(block)
    await visible('first')
    await page.keyboard.type('f')
    await heardCount(5)
    await page.keyboard.type('irst')
    await page.keyboard.press('Enter')
    await page.keyboard.type('s')
    await heardCount(6)
    assert.equal(heard.at(-1), 'Explain 2')
    await command('dismissTrace')
    await until(() => aborted.length === 6)
    const silent = await run({ action: 'context' })
    await run({
      action: 'trace',
      snapshot: silent.snapshot,
      anchor: { line: 2, column: 1, expectedLine: 's' },
      text: 'ilent',
    })
    await page.keyboard.type('i')
    await pause()
    assert.equal(heard.length, 6)
    await command('dismissTrace')
    const extra = await run({ action: 'context' })
    await run({
      action: 'ghost_practice_text',
      snapshot: extra.snapshot,
      text: 'pasted',
      spoken: true,
    }).then(prepare)
    await vscode.window.activeTextEditor.edit((e) => e.insert(new vscode.Position(0, 0), 'pasted'))
    await pause()
    assert.equal(heard.length, 6)
    await vscode.commands.executeCommand('undo')
    await vscode.commands.executeCommand('redo')
    await pause()
    assert.equal(heard.length, 6)
    await command('cancelGuide')
    const tiny = await run({ action: 'context' })
    await run({
      action: 'ghost_practice_text',
      snapshot: tiny.snapshot,
      text: 'x\ny',
      spoken: true,
    }).then(prepare)
    await visible('x')
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit')
    await until(() => vscode.window.activeTextEditor.document.lineAt(0).text === 'x')
    await pause()
    assert.equal(heard.length, 6, 'A one-character acceptance is silent')
    await page.keyboard.press('Enter')
    await visible('y')
    await page.keyboard.type('y')
    await heardCount(7)
    assert.equal(heard.at(-1), 'Explain 2')
    await command('cancelGuide')
    await vscode.workspace
      .getConfiguration('editor')
      .update('inlineSuggest.enabled', false, vscode.ConfigurationTarget.Global)
    const copy = await run({ action: 'context' })
    await run({
      action: 'ghost_practice_text',
      snapshot: copy.snapshot,
      text: 'fallback',
      spoken: true,
    }).then(prepare)
    const painted = (word) =>
      page
        .locator('.monaco-editor .view-lines span')
        .evaluateAll(
          (nodes, text) =>
            nodes.some((node) => getComputedStyle(node, '::after').content.includes(text)),
          word,
        )
    await until(() => painted('fallback'))
    await page.keyboard.type('f')
    await heardCount(8)
    await until(() => painted('allback'))
    await command('cancelGuide')
    await vscode.workspace
      .getConfiguration('editor')
      .update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global)
    const settings = path.join(path.dirname(descriptor), 'settings.json')
    fs.writeFileSync(settings, JSON.stringify({ spokenGhostWalkthroughs: false }))
    await new Promise((resolve) => setTimeout(resolve, 1900))
    const last = await run({ action: 'context' })
    const disabled = await run({
      action: 'ghost_practice_text',
      snapshot: last.snapshot,
      text: 'hello\nworld',
      spoken: true,
    })
    assert.equal(disabled.speechEnabled, false)
    await page.keyboard.type('h')
    await pause()
    assert.equal(heard.length, 8)
    await command('cancelGuide')
    const targetPath = path.join(process.env.THREADLIGHT_COACH_TEST_DIR, 'problem.py')
    const program = Array.from({ length: 63 }, (_, i) => '# context ' + (i + 1))
      .concat('def main():', '    return 1', 'main()')
      .join('\n')
    fs.writeFileSync(targetPath, program)
    const target = await vscode.workspace.openTextDocument(targetPath)
    const editor = await vscode.window.showTextDocument(target)
    const version = target.version
    for (const location of ['current', 'copy']) {
      fs.writeFileSync(
        settings,
        JSON.stringify({ ghostPracticeLocation: location, spokenGhostWalkthroughs: true }),
      )
      const ctx = await run({ action: 'context', line: 64 })
      const result = await run({
        action: 'ghost_practice',
        scope: 'file',
        snapshot: ctx.snapshot,
        line: 64,
        spoken: true,
      })
      assert.deepEqual([result.location, result.firstLine, result.lastLine], [location, 64, 66])
      const active = vscode.window.activeTextEditor
      assert.equal(active.document === target, location === 'current')
      assert.equal(active.selection.active.line, 63)
      assert.equal(active.document.getText(), program)
      await prepare(result)
      const count = heard.length
      await page.keyboard.type('d')
      await heardCount(count + 1)
      assert.equal(heard.at(-1), 'Explain 64')
      assert.equal(active.selection.active.character, 1)
      await page.keyboard.type('z')
      assert.equal(active.selection.active.character, 1)
      const dimmed = () =>
        page.locator('.monaco-editor .view-line span').evaluateAll((spans) =>
          spans
            .filter((s) => getComputedStyle(s).opacity === '0.55')
            .map((s) => s.textContent)
            .join(''),
        )
      await until(async () => (await dimmed()).includes('main'))
      assert.ok(!(await dimmed()).includes('context'))
      await page.keyboard.type('ef main():')
      await until(() => active.selection.active.character === 'def main():'.length)
      await page.keyboard.press('Backspace')
      await until(() => active.selection.active.character === 'def main()'.length)
      await page.keyboard.type(':')
      await page.keyboard.press('Enter')
      await page.keyboard.type('r')
      await heardCount(count + 2)
      assert.equal(heard.at(-1), 'Explain 65')
      assert.equal(active.document.getText(), program)
      await page.keyboard.press('Escape')
      await until(async () => (await dimmed()) === '')
      assert.equal(target.version, version)
      assert.equal(fs.readFileSync(targetPath, 'utf8'), program)
      await vscode.window.showTextDocument(target)
      editor.selection = new vscode.Selection(0, 0, 0, 0)
    }
    const explicit = await run({
      action: 'ghost_practice',
      scope: 'file',
      snapshot: (await run({ action: 'context' })).snapshot,
      line: 64,
      endLine: 65,
      location: 'current',
      spoken: true,
    })
    assert.equal(explicit.location, 'current')
    assert.deepEqual(
      explicit.lines.map((row) => row.line),
      [64, 65],
    )
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await until(() => vscode.window.activeTextEditor.selection.active.character === 4)
    await page.keyboard.press('Enter')
    assert.equal(target.version, version)
    console.log(
      'PASS line 64 overlay, syntax-preserving dimming, current file and copy settings, actual typing, unchanged file and Undo history.',
    )
    console.log(
      'PASS typed ghost blocks, file and selection practice, diff isolation, deferred notes, clicks, paste/commit suppression, mute, replay, settings and interrupted playback.',
    )
  } finally {
    bridge.close()
  }
}
module.exports = { check }
