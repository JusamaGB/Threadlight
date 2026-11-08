/* global getComputedStyle */
const vscode = require('vscode')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

async function checkTrace({ root, coach, session, page, until }) {
  const file = path.join(root, 'trace.py')
  const saved = 'def greet():\n\n    return 1\n# 🐍'
  fs.writeFileSync(file, saved)
  const doc = await vscode.workspace.openTextDocument(file)
  const editor = await vscode.window.showTextDocument(doc)
  const run = (cmd) => coach.run(session, cmd)
  const context = () => run({ action: 'context' })
  const suggestion = '    name = "café"'
  const propose = async (line, column, text, info = undefined) => {
    const s = info || (await context())
    return run({
      action: 'trace',
      snapshot: s.snapshot,
      text,
      anchor: { line, column, expectedLine: s.lines.find((l) => l.line === line).text },
    })
  }
  const ghost = () =>
    page.locator(
      '.monaco-editor .ghost-text, .monaco-editor .ghost-text-decoration, .monaco-editor .ghost-text-decoration-preview',
    )
  const visible = async (text) => {
    if (page) await until(async () => (await ghost().allTextContents()).join('').includes(text))
  }
  // Isolated profile only. Inspect rendering with VS Code's syntax setting enabled.
  await vscode.workspace
    .getConfiguration('editor', doc)
    .update('inlineSuggest.syntaxHighlightingEnabled', true, vscode.ConfigurationTarget.Global)
  await vscode.workspace
    .getConfiguration('editor', doc)
    .update('quickSuggestions', false, vscode.ConfigurationTarget.Global)
  for (const eol of [vscode.EndOfLine.LF, vscode.EndOfLine.CRLF]) {
    await editor.edit((e) => e.setEndOfLine(eol))
    const original = doc.getText(),
      version = doc.version
    await propose(2, 0, suggestion)
    assert.equal(doc.version, version)
    assert.equal(editor.selection.active.line, 1)
    await visible('café')
    if (page) {
      const styles = await ghost().evaluateAll((nodes) =>
        nodes.map((n) => ({
          cls: n.className,
          text: n.textContent,
          style: getComputedStyle(n).color,
          opacity: getComputedStyle(n).opacity,
        })),
      )
      assert.ok(styles.filter((s) => s.cls.includes('syntax-highlighted')).length >= 2)
      assert.ok(new Set(styles.map((s) => s.style)).size >= 2)
      assert.ok(styles.every((s) => Number(s.opacity) > 0 && Number(s.opacity) < 1))
      await page.screenshot({ path: path.join(root, 'trace.png') })
      await page.keyboard.press('Tab')
    } else await vscode.commands.executeCommand('tab')
    await until(() => doc.lineAt(1).text === '    ')
    await visible('café')
    await vscode.commands.executeCommand('type', { text: 'na' })
    await visible('me')
    await vscode.commands.executeCommand('deleteLeft')
    await visible('ame')
    assert.equal((await context()).trace.typed, '    n')
    await vscode.commands.executeCommand('type', { text: 'X' })
    await until(async () => !(await context()).trace)
    assert.equal(doc.lineAt(1).text, '    nX')
    await editor.edit((e) => e.delete(doc.lineAt(1).range))
    assert.equal(doc.getText(), original)
    const stale = await context()
    await editor.edit((e) => e.insert(doc.lineAt(3).range.end, '!'))
    await assert.rejects(propose(2, 0, suggestion, stale), /changed/)
    await vscode.commands.executeCommand('undo')
    const line = doc.lineAt(3)
    await assert.rejects(propose(4, line.text.length - 1, 'x'), /valid insertion column/)
    await propose(4, line.text.length, '\nprint("fin")')
    await visible('fin')
    if (page) await page.keyboard.press('Escape')
    else await vscode.commands.executeCommand('threadlight.coach.dismissTrace')
    await until(async () => !(await context()).trace)
    await propose(1, doc.lineAt(0).text.length, '\n    value = 2\n    print(value)')
    await visible('value')
    if (page) {
      const start = doc.lineAt(0).range.end
      await page.keyboard.press('Enter')
      await until(() => editor.selection.active.line === 1)
      const entered = await context()
      assert.ok(entered.trace && entered.trace.suggestion.startsWith(entered.trace.typed))
      await visible('value')
      await editor.edit((edit) => edit.delete(new vscode.Range(start, editor.selection.active)))
      assert.equal(doc.getText(), original)
      await propose(1, doc.lineAt(0).text.length, '\n    value = 2\n    print(value)')
      await visible('value')
    }
    await vscode.commands.executeCommand('editor.action.inlineSuggest.commit')
    await until(() => doc.getText() !== original)
    assert.equal(
      doc.getText(),
      original.replace(
        'def greet():',
        'def greet():' +
          (eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') +
          '    value = 2' +
          (eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') +
          '    print(value)',
      ),
    )
    await vscode.commands.executeCommand('undo')
    assert.equal(doc.getText(), original)
    await propose(2, 0, suggestion)
    await editor.edit((e) => e.insert(doc.lineAt(3).range.end, '!'))
    assert.equal((await context()).trace, undefined)
    await vscode.commands.executeCommand('undo')
    assert.equal(fs.readFileSync(file, 'utf8'), saved)
  }
  const before = doc.getText()
  const current = await context()
  await assert.rejects(
    run({
      action: 'trace',
      snapshot: current.snapshot,
      anchor: { line: 2, column: 0, expectedLine: 'old' },
      text: 'abc',
    }),
    /exact observed/,
  )
  if (page) {
    await propose(2, 0, 'trace_alternative')
    const completion = vscode.languages.registerCompletionItemProvider('python', {
      provideCompletionItems() {
        const item = new vscode.CompletionItem('menu_choice')
        item.preselect = true
        return [item]
      },
    })
    try {
      await vscode.commands.executeCommand('editor.action.triggerSuggest')
      await page
        .locator('.suggest-widget.visible')
        .getByText('menu_choice', { exact: true })
        .first()
        .waitFor()
      await page.keyboard.press('Tab')
      await until(() => doc.lineAt(1).text === 'menu_choice')
      await vscode.commands.executeCommand('undo')
      assert.equal(doc.getText(), before)
    } finally {
      completion.dispose()
    }
    await propose(2, 0, 'ab')
    // A snippet's Tab must still advance through its placeholders.
    await editor.insertSnippet(new vscode.SnippetString('${1:a}${2:b}$0'))
    await page.keyboard.press('Tab')
    await until(() => doc.getText(editor.selection) === 'b')
    await vscode.commands.executeCommand('leaveSnippet')
    await vscode.commands.executeCommand('undo')
    assert.equal(doc.getText(), before)
    await propose(2, 0, 'print("value")')
    await vscode.commands.executeCommand('type', { text: 'print' })
    await page.keyboard.type('(')
    await visible('value')
    assert.equal(doc.lineAt(1).text, 'print()')
    await page.keyboard.press('Escape')
    await editor.edit((e) => e.delete(doc.lineAt(1).range))
    assert.equal(doc.getText(), before)
  }
  await propose(2, 0, suggestion)
  const other = await vscode.workspace.openTextDocument({ content: 'other' })
  await vscode.window.showTextDocument(other)
  await vscode.window.showTextDocument(doc)
  assert.equal((await context()).trace, undefined)
  const temp = await vscode.workspace.openTextDocument({ content: 'abc' })
  await vscode.window.showTextDocument(temp)
  await propose(1, 3, '123')
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await vscode.window.showTextDocument(doc)
  assert.equal((await context()).trace, undefined)
  await propose(2, 0, suggestion)
  coach.close()
  await new Promise((r) => setTimeout(r, 100))
  assert.equal((await context()).trace, undefined)
  console.log(
    'PASS trace anchors, native ghost typing and divergence, LF/CRLF, append, multiline insertion, explicit accept and Undo, invalidation.',
  )
  if (process.env.THREADLIGHT_TRACE_AGENT === '1') {
    const agentEditor = await vscode.window.showTextDocument(doc)
    await agentEditor.edit((b) =>
      b.insert(
        doc.lineAt(doc.lineCount - 1).range.end,
        '\n' +
          Array.from(
            { length: 90 },
            () => '# doubled uses the correct argument and increment always returns a number.',
          ).join('\n') +
          '\ndef doubled(n):\n    return number * 2\n\ndef increment(n):\n    return n + "1"\n',
      ),
    )
    agentEditor.selection = new vscode.Selection(0, 0, 0, 0)
    coach.close()
    const version = doc.version
    const log = path.join(root, 'trace-agent.log')
    await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(
        process.env.THREADLIGHT_TEST_NODE,
        [path.join(__dirname, 'trace-agent.proof.cjs')],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      child.stdout.on('data', (data) => fs.appendFileSync(log, data))
      child.stderr.on('data', (data) => fs.appendFileSync(log, data))
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(Error('Backing Agent routing check failed. See ' + log)),
      )
    })
    assert.equal(doc.version, version)
    console.log('PASS signed-in text-only backing Agent trace and live diff routing.')
  }
}
module.exports = { checkTrace }
