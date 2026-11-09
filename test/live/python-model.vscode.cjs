const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function run() {
  const dir = process.env.THREADLIGHT_COACH_TEST_DIR
  const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT)
  const port = fs
    .readFileSync(path.join(dir, 'profile', 'DevToolsActivePort'), 'utf8')
    .split('\n')[0]
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes('workbench'))
  const fixture = vscode.extensions.getExtension('threadlight-test.coach-test-model')
  assert.ok(fixture)
  const provider = await fixture.activate()
  const models = await vscode.lm.selectChatModels({ vendor: 'threadlight-test' })
  assert.ok(models.length, 'VS Code must expose the fixture model')
  const doc = await vscode.workspace.openTextDocument({
    language: 'python',
    content: 'def calculate(result):',
  })
  await vscode.window.showTextDocument(doc)
  const exec = (command, ...args) => vscode.commands.executeCommand(command, ...args)
  const config = vscode.workspace.getConfiguration('threadlight.coach')
  await config.update('pythonSuggestions', true, vscode.ConfigurationTarget.Global)
  await vscode.workspace
    .getConfiguration('editor', doc)
    .update('quickSuggestions', false, vscode.ConfigurationTarget.Global)
  const companion = vscode.extensions.getExtension('threadlight.threadlight-live-coach')
  for (let i = 0; i < 60 && !companion.isActive; i++) await wait(100)
  assert.ok(companion.isActive, 'Opening Python should activate Coach')
  const storage = path.join(
    dir,
    'profile',
    'User',
    'globalStorage',
    'threadlight.threadlight-live-coach',
  )
  fs.mkdirSync(storage, { recursive: true })
  const prefs = path.join(storage, 'settings.json')
  const setMode = async (mode) => {
    fs.writeFileSync(prefs + '.tmp', JSON.stringify({ pythonSuggestions: mode }))
    fs.renameSync(prefs + '.tmp', prefs)
    await wait(1800)
  }
  await setMode('off')
  assert.equal(await vscode.commands.executeCommand('threadlight.coach.showPredicted'), undefined)
  const probe = await vscode.workspace.openTextDocument({
    language: 'python',
    content: 'print(value)\npri',
  })
  const probeEditor = await vscode.window.showTextDocument(probe)
  const end = probe.lineAt(1).range.end
  probeEditor.selection = new vscode.Selection(end, end)
  const ghosts = page.locator('.ghost-text, .ghost-text-decoration, .ghost-text-decoration-preview')
  await exec('editor.action.inlineSuggest.trigger')
  assert.ok(!(await ghosts.allTextContents()).join('').includes('nt(value)'))
  await config.update('pythonSuggestions', false, vscode.ConfigurationTarget.Global)
  await setMode('on')
  await exec('editor.action.inlineSuggest.trigger')
  for (let i = 0; i < 40 && !(await ghosts.allTextContents()).join('').includes('nt(value)'); i++)
    await wait(100)
  assert.ok((await ghosts.allTextContents()).join('').includes('nt(value)'))
  assert.ok(!fs.existsSync(path.join(storage, 'editor-coach.json')))
  console.log(
    'PASS Python file activates the companion, Threadlight On/Off overrides the VS Code checkbox, and local ghost text works with no Live connection.',
  )
  for (const label of ['print', 'private_value']) {
    const items = vscode.languages.registerCompletionItemProvider('python', {
      provideCompletionItems: () => [new vscode.CompletionItem(label)],
    })
    try {
      await exec('editor.action.inlineSuggest.hide')
      await exec('editor.action.triggerSuggest')
      const selected = page.locator('.suggest-widget.visible .monaco-list-row.focused')
      await selected.filter({ hasText: label }).waitFor()
      if (label === 'print') {
        await ghosts.filter({ hasText: '(value)' }).first().waitFor({ timeout: 6000 })
        assert.ok((await ghosts.allTextContents()).join('').includes('nt(value)'))
        await exec('editor.action.inlineSuggest.commit')
        assert.equal(probe.lineAt(1).text, 'print(value)')
        await exec('undo')
        assert.equal(probe.lineAt(1).text, 'pri')
      } else {
        await wait(600)
        assert.ok(!(await ghosts.allTextContents()).join('').includes('nt(value)'))
      }
    } finally {
      await exec('hideSuggestWidget')
      items.dispose()
    }
  }
  console.log(
    'PASS local Python ghost extends the matching IntelliSense item, accepts once, and yields to a different item.',
  )
  let editor = await vscode.window.showTextDocument(doc)
  const choose = exec('threadlight.coach.choosePythonModel')
  await page.locator('.quick-input-list').getByText('Coach fixture model', { exact: true }).click()
  // The disposable profile may request model-use consent.
  const grant = page.getByRole('button', { name: 'Allow', exact: true })
  await Promise.race([
    choose,
    grant
      .waitFor({ timeout: 5000 })
      .then(() => grant.click())
      .catch(() => {}),
  ])
  await choose
  const ghost = page.locator('.ghost-text, .ghost-text-decoration, .ghost-text-decoration-preview')
  const visible = async (word) => {
    for (let i = 0; i < 60; i++) {
      if (
        (await ghost.allTextContents())
          .join('')
          .replace(/\u00a0/g, ' ')
          .includes(word) ||
        (await page.locator('.view-zones').allTextContents())
          .join('')
          .replace(/\u00a0/g, ' ')
          .includes(word)
      )
        return
      await wait(100)
    }
    const view = await page
      .locator('.monaco-editor.focused')
      .first()
      .textContent()
      .catch(() => '')
    await page.screenshot({ path: path.join(dir, 'python-model.png') })
    throw Error(
      'Editor text ' +
        view.slice(-600) +
        '; missing ghost text ' +
        word +
        ' (provider ' +
        JSON.stringify(provider.stats()) +
        ')',
    )
  }
  try {
    const end = doc.lineAt(0).range.end
    editor.selection = new vscode.Selection(end, end)
    await exec('editor.action.inlineSuggest.trigger')
    await visible('return result')
    await page.screenshot({ path: path.join(dir, 'python-model.png') })
    await exec('editor.action.inlineSuggest.commit')
    assert.equal(doc.lineAt(1).text, '    return result')
    await exec('undo')
    const partial = await vscode.workspace.openTextDocument({
      language: 'python',
      content: 'partial_value = ',
    })
    const partialEditor = await vscode.window.showTextDocument(partial)
    const at = partial.lineAt(0).range.end
    partialEditor.selection = new vscode.Selection(at, at)
    await exec('editor.action.inlineSuggest.trigger')
    await visible('result + 1')
    await exec('editor.action.inlineSuggest.acceptNextWord')
    assert.equal(partial.getText(), 'partial_value = result')
    await page.keyboard.press('Escape')
    editor = await vscode.window.showTextDocument(doc)
    const source = 'before = 1\nbreakpoint()\nprint(before)'
    await editor.edit((b) =>
      b.replace(
        new vscode.Range(doc.positionAt(0), doc.lineAt(doc.lineCount - 1).range.end),
        source,
      ),
    )
    await editor.edit((b) => b.replace(new vscode.Range(0, 0, 0, 10), 'after = 2'))
    await wait(900)
    const result = await exec('threadlight.coach.showPredicted')
    assert.equal(result?.line, 2)
    assert.equal(doc.lineAt(1).text, 'breakpoint()')
    await exec('threadlight.coach.acceptProposal')
    assert.equal(doc.lineAt(1).text, '')
    await exec('undo')
    assert.equal(doc.lineAt(1).text, 'breakpoint()')
    // Change the buffer before a deliberately late completion can be displayed.
    const stale = await vscode.workspace.openTextDocument({
      language: 'python',
      content: 'model_delay',
    })
    const se = await vscode.window.showTextDocument(stale)
    const last = stale.lineAt(0).range.end
    se.selection = new vscode.Selection(last, last)
    const initial = provider.stats().requests
    const request = exec('editor.action.inlineSuggest.trigger')
    for (let i = 0; i < 30 && provider.stats().requests === initial; i++) await wait(40)
    assert.ok(provider.stats().requests > initial)
    await se.edit((b) => b.insert(last, '_changed'))
    await vscode.window.showTextDocument(doc)
    await request
    await wait(800)
    assert.ok(!(await ghost.allTextContents()).join('').includes('never_display_stale'))
    assert.ok(provider.stats().cancelled)
    const failure = await vscode.workspace.openTextDocument({
      language: 'python',
      content: 'provider_failure',
    })
    const fe = await vscode.window.showTextDocument(failure)
    const fend = failure.lineAt(0).range.end
    fe.selection = new vscode.Selection(fend, fend)
    await exec('editor.action.inlineSuggest.trigger')
    await page
      .getByText(/Python model unavailable.*Continuing with local suggestions/)
      .first()
      .waitFor()
    assert.equal(failure.getText(), 'provider_failure')
    console.log(
      'PASS VS Code fixture model: multiline Python completion, native accept and partial word, predictive deletion and Undo, cancelled late request, provider failure with local fallback.',
    )
  } finally {
    await exec('threadlight.coach.stop')
  }
}
module.exports = { run }
