// Runs inside a disposable VS Code extension-development host.
const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const ts = require('typescript')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  )
const { EditorCoach } = require('../../src/main/editorCoach.ts')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(check) {
  for (let i = 0; i < 100; i++) {
    const value = await check()
    if (value) return value
    await wait(50)
  }
  throw Error('Editor check timed out.')
}
async function run() {
  const root = process.env.THREADLIGHT_COACH_TEST_DIR
  if (process.env.THREADLIGHT_COACH_COMPATIBILITY === '1')
    return require('./coach-compatibility.vscode.cjs').run(root, EditorCoach)
  const file = path.join(root, 'practice.py')
  fs.writeFileSync(file, '# starter\n')
  const document = await vscode.workspace.openTextDocument(file)
  let editor = await vscode.window.showTextDocument(document)
  const text =
    Array.from({ length: 80 }, (_, i) => '# sample ' + i).join('\n') + '\ntotal = 1\nprint(total)\n'
  await editor.edit((e) => e.replace(document.lineAt(0).rangeIncludingLineBreak, text))
  editor.selection = new vscode.Selection(80, 0, 80, 0)
  await vscode.commands.executeCommand('threadlight.coach.start')
  const descriptor = path.join(
    root,
    'profile',
    'User',
    'globalStorage',
    'threadlight.threadlight-live-coach',
    'editor-coach.json',
  )
  const lenses = () =>
    vscode.commands.executeCommand('vscode.executeCodeLensProvider', document.uri)
  let session = 'test-coach',
    spoken = []
  const coach = new EditorCoach(
    () => session,
    async (_id, phrase) => {
      const lens = (await lenses()).find((l) => l.command?.command === 'threadlight.coach.next')
      assert.ok(lens, 'hint was present before speech')
      assert.ok(
        editor.visibleRanges.some((r) => r.contains(lens.range.start)),
        'line was visible before speech',
      )
      spoken.push(phrase)
    },
    descriptor,
  )
  try {
    if (process.env.THREADLIGHT_GHOST_ONLY === '1') {
      const page = await workbenchPage(root)
      if (process.env.THREADLIGHT_LIVE_SMOKE !== '1')
        return await require('./ghostLesson.vscode.cjs').check({
          session,
          descriptor,
          EditorCoach,
          until,
          page,
        })
      const text = '# context\n'.repeat(63) + 'print("lantern")\nprice = 3'
      const source = path.join(root, 'problem.py')
      fs.writeFileSync(source, text)
      const doc = await vscode.workspace.openTextDocument(source)
      await vscode.window.showTextDocument(doc)
      await Promise.all([
        signedLive(root, descriptor),
        (async () => {
          const deadline = Date.now() + 145000
          while (!fs.existsSync(path.join(root, 'ghost-ready')) && Date.now() < deadline)
            await wait(100)
          assert.ok(fs.existsSync(path.join(root, 'ghost-ready')), 'Agent prepared practice notes')
          assert.equal(vscode.window.activeTextEditor.document, doc)
          assert.equal(vscode.window.activeTextEditor.selection.active.line, 63)
          fs.writeFileSync(path.join(root, 'ghost-typed'), String(Date.now()))
          await page.keyboard.type('p')
        })(),
      ])
      assert.equal(doc.getText(), text)
      console.log('PASS signed-in ghost walkthrough, actual keyboard and Live playback.')
      return
    }
    if (process.env.THREADLIGHT_WALKTHROUGH_ONLY === '1') {
      await require('./walkthrough.vscode.cjs').check({
        coach,
        session,
        descriptor,
        EditorCoach,
        until,
        page: await workbenchPage(root),
      })
      if (process.env.THREADLIGHT_LIVE_SMOKE === '1') {
        const lines = [
          'prices = {"apple": 2}',
          'item = "apple"',
          'quantity = 3',
          'unit_price = prices[item]',
          'subtotal = quantity * unit_price',
          'discount = 1',
          'total = subtotal - discount',
          'print(item)',
          'print(quantity)',
          'print(total)',
        ]
        const source = await vscode.workspace.openTextDocument({
          language: 'python',
          content:
            '"""\n' +
            'Practice instructions\n'.repeat(72) +
            '"""\n# Implementation\n' +
            lines.join('\n'),
        })
        editor = await vscode.window.showTextDocument(source)
        editor.selection = new vscode.Selection(0, 0, 0, 0)
        const before = source.getText()
        const page = await workbenchPage(root)
        const waitMarker = async (name) => {
          const limit = Date.now() + 120000
          while (!fs.existsSync(path.join(root, name)) && Date.now() < limit) await wait(80)
          assert.ok(fs.existsSync(path.join(root, name)), name)
        }
        await Promise.all([
          signedLive(root, descriptor),
          (async () => {
            await waitMarker('file-walk-ready')
            const point = async (n) => {
              const box = await page
                .locator('.monaco-editor .line-numbers')
                .filter({ hasText: new RegExp('^' + n + '$') })
                .first()
                .boundingBox()
              assert.ok(box)
              return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            }
            const first = await point(77),
              last = await point(79)
            await page.mouse.move(first.x, first.y)
            await page.mouse.down()
            await page.mouse.move(last.x, last.y, { steps: 3 })
            await page.mouse.up()
            await waitMarker('section-requested')
            await page
              .locator('.codelens-decoration')
              .getByText('Start', { exact: true })
              .first()
              .click()
          })(),
        ])
        assert.equal(source.getText(), before)
        console.log('PASS signed-in automatic file walkthrough.')
      }
      return
    }
    if (process.env.THREADLIGHT_TRACE_ONLY === '1') {
      const page = await workbenchPage(root)
      await require('./trace.vscode.cjs').checkTrace({ root, coach, session, page, until })
      return
    }
    if (process.env.THREADLIGHT_PROPOSALS_ONLY === '1') {
      const page = await workbenchPage(root)
      const checks = require('./proposals.vscode.cjs')
      if (process.env.THREADLIGHT_LIVE_PROPOSAL_WALK !== '1') {
        await checks.checkProposals({ root, coach, session, page, until })
        await checks.checkProposalSpeech({ coach, session, descriptor, EditorCoach, until })
      }
      if (process.env.THREADLIGHT_TRACE_AGENT === '1')
        await require('./trace.vscode.cjs').checkTrace({ root, coach, session, page, until })
      if (
        process.env.THREADLIGHT_LIVE_SMOKE === '1' &&
        process.env.THREADLIGHT_LIVE_PROPOSAL === '1'
      ) {
        const doc = await require('./whole-file-review.vscode.cjs').checkWholeFileReview(
          root,
          coach,
          session,
        )
        const reviewEditor = await vscode.window.showTextDocument(doc),
          line = doc.lineCount - 1
        reviewEditor.selection = new vscode.Selection(line, 0, line, 0)
        const version = doc.version
        coach.close()
        await signedLive(root, descriptor)
        assert.equal(doc.version, version)
        assert.equal(fs.readFileSync(doc.fileName, 'utf8'), '# saved contents\r\n')
      }
      return
    }
    const info = await coach.run(session, { action: 'context' })
    assert.ok(info.lines.some((l) => l.line === 81 && l.text === 'total = 1'))
    const longHint = 'Follow the value from its initial assignment through the lines that read it. '
      .repeat(3)
      .slice(0, 209)
    await coach.run(session, {
      action: 'guide',
      snapshot: info.snapshot,
      steps: [
        { line: 81, hint: longHint, explanation: 'First explanation.' },
        { line: 82, hint: 'Read the total', explanation: 'Second explanation.' },
      ],
    })
    assert.deepEqual(spoken, ['First explanation.'])
    const displayed = (await lenses()).find((l) => l.command?.command === 'threadlight.coach.next')
    assert.equal(displayed.command.tooltip, longHint)
    assert.ok(
      displayed.command.title.length < 140 && displayed.command.title.endsWith('Next step ›'),
    )
    await assert.rejects(
      coach.run(session, { action: 'guide', snapshot: info.snapshot, steps: [] }),
      /current hint/,
    )
    const click = async () => {
      const lens = (await lenses()).find((l) => l.command?.command === 'threadlight.coach.next')
      assert.ok(lens)
      await vscode.commands.executeCommand(lens.command.command, ...lens.command.arguments)
    }
    await click()
    await until(() => spoken.length === 2)
    assert.deepEqual(spoken, ['First explanation.', 'Second explanation.'])
    await wait(100)
    await click()
    assert.ok(!(await lenses()).some((l) => l.command?.command === 'threadlight.coach.next'))
    await coach.run(session, {
      action: 'diff',
      snapshot: info.snapshot,
      firstLine: 81,
      lastLine: 81,
      replacement: 'total = 2',
    })
    const diff = await until(() =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .map((t) => t.input)
        .find(
          (i) =>
            i instanceof vscode.TabInputTextDiff &&
            i.modified.scheme === 'threadlight-coach-preview',
        ),
    )
    assert.equal(diff.original.scheme, 'threadlight-coach-preview')
    assert.equal(
      (await vscode.workspace.openTextDocument(diff.original)).getText(),
      document.getText(),
    )
    assert.equal(
      (await vscode.workspace.openTextDocument(diff.modified)).getText(),
      document.getText().replace('total = 1', 'total = 2'),
    )
    assert.ok(document.isDirty)
    assert.equal(fs.readFileSync(file, 'utf8'), '# starter\n')
    editor = await vscode.window.showTextDocument(document)
    await editor.edit((e) => e.insert(new vscode.Position(0, 0), '# updated\n'))
    await assert.rejects(
      coach.run(session, {
        action: 'diff',
        snapshot: info.snapshot,
        firstLine: 81,
        lastLine: 81,
        replacement: 'oops',
      }),
      /changed/,
    )
    const inlineFile = path.join(root, 'inline.py')
    fs.writeFileSync(inlineFile, '# starter\n')
    const inlineDocument = await vscode.workspace.openTextDocument(inlineFile)
    await checkInline({
      root,
      coach,
      session,
      file: inlineFile,
      document: inlineDocument,
      editor: await vscode.window.showTextDocument(inlineDocument),
    })
    const reviewDocument = await require('./whole-file-review.vscode.cjs').checkWholeFileReview(
      root,
      coach,
      session,
    )
    await require('./proposals.vscode.cjs').checkProposalSpeech({
      coach,
      session,
      descriptor,
      EditorCoach,
      until,
    })
    await require('./guide-lifecycle.vscode.cjs').checkGuideLifecycle({
      coach,
      session,
      descriptor,
      EditorCoach,
    })
    editor = await vscode.window.showTextDocument(document)
    session = null
    coach.sync()
    console.log(
      'PASS actual VS Code highlight before narration, persistent clickable hints, read-only diff, dirty buffer and disk preserved, stale version rejected.',
    )
    if (process.env.THREADLIGHT_LIVE_SMOKE === '1') {
      const beforeLive = document.getText()
      editor.selection =
        process.env.THREADLIGHT_LIVE_INLINE === '1'
          ? new vscode.Selection(81, 0, 81, document.lineAt(81).text.length)
          : new vscode.Selection(81, 0, 81, 0)
      if (
        process.env.THREADLIGHT_LIVE_REVIEW === '1' ||
        process.env.THREADLIGHT_LIVE_PROPOSAL === '1'
      ) {
        const reviewEditor = await vscode.window.showTextDocument(reviewDocument)
        const line =
          process.env.THREADLIGHT_LIVE_PROPOSAL === '1' ? reviewDocument.lineCount - 1 : 0
        reviewEditor.selection = new vscode.Selection(line, 0, line, 0)
      }
      const reviewVersion = reviewDocument.version
      const peer = signedLive(root, descriptor)
      if (process.env.THREADLIGHT_LIVE_GUIDE === '1') {
        await Promise.all([
          peer,
          require('./guide-lifecycle.vscode.cjs').exerciseLiveClicks({
            root,
            editor,
            document,
            lenses,
          }),
        ])
      } else await peer
      assert.equal(
        document.getText(),
        beforeLive + (process.env.THREADLIGHT_LIVE_GUIDE === '1' ? '# learner edit' : ''),
      )
      assert.equal(reviewDocument.version, reviewVersion)
      assert.equal(fs.readFileSync(reviewDocument.fileName, 'utf8'), '# saved contents\r\n')
      assert.ok(document.isDirty)
      assert.equal(fs.readFileSync(file, 'utf8'), '# starter\n')
      console.log(
        'PASS signed-in foreground GPT Live coaching request, editor acknowledgement and native spoken transcript.',
      )
    }
  } finally {
    coach.close()
    await vscode.commands.executeCommand('threadlight.coach.stop')
  }
}
module.exports = { run }
async function checkInline({ root, coach, session, document, editor, file }) {
  const page = await workbenchPage(root)
  const fixture = 'before 🐍x = 1\nprint(x) # after'
  const replacements = ['value = 1\nprint(value)', 'n = 2\nprint(n)']
  const select = async () => {
    editor.selection = new vscode.Selection(1, 8, 0, 9)
    // Let the workbench acknowledge the synthetic selection before requesting context.
    await wait(100)
    assert.equal(editor.selection.isReversed, true)
  }
  const context = () => coach.run(session, { action: 'context' })
  const propose = async (info) =>
    coach.run(session, { action: 'inline', snapshot: info.snapshot, replacements })
  const action = (key, name) =>
    page ? page.keyboard.press(key) : vscode.commands.executeCommand('threadlight.coach.' + name)
  for (const eol of [vscode.EndOfLine.LF, vscode.EndOfLine.CRLF]) {
    await editor.edit((edit) => edit.setEndOfLine(eol))
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        fixture,
      ),
    )
    await select()
    const original = document.getText()
    const selected = document.getText(editor.selection)
    const version = document.version
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length
    const info = await context()
    assert.equal(info.selectedText, selected)
    await propose(info)
    if (page) {
      await page
        .getByText('Proposed replacement', { exact: true })
        .first()
        .waitFor({ timeout: 5000 })
      await until(() =>
        page
          .locator('.review-widget')
          .innerText()
          .then((s) => s.includes('print(value)')),
      )
      if (eol === vscode.EndOfLine.LF)
        await page.screenshot({ path: path.join(root, 'inline-preview.png') })
    }
    await action('ArrowLeft', 'previous')
    if (page)
      await until(() =>
        page
          .locator('.review-widget')
          .innerText()
          .then((s) => s.includes('print(n)')),
      )
    await action('ArrowRight', 'following')
    await action('Escape', 'dismiss')
    if (page) await page.locator('.review-widget').waitFor({ state: 'hidden', timeout: 5000 })
    assert.equal(document.version, version)
    assert.equal(document.getText(), original)
    await propose(await context())
    if (page) await page.locator('.review-widget').waitFor({ state: 'visible', timeout: 5000 })
    await action('ArrowRight', 'following')
    if (page)
      await until(() =>
        page
          .locator('.review-widget')
          .innerText()
          .then((s) => s.includes('print(n)')),
      )
    await action('Tab', 'accept')
    await until(() => document.version !== version)
    const expected = original.replace(
      selected,
      replacements[1].replace(/\n/g, eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'),
    )
    assert.equal(document.getText(), expected)
    assert.equal(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, tabs)
    const acceptedVersion = document.version
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    if (page) await page.keyboard.press('Control+z')
    else await vscode.commands.executeCommand('undo')
    await until(() => document.version !== acceptedVersion)
    assert.equal(document.getText(), original)
    assert.equal(fs.readFileSync(file, 'utf8'), '# starter\n')
    assert.ok(document.isDirty)
  }
  await select()
  const stale = await context()
  await propose(stale)
  editor.selection = new vscode.Selection(0, 0, 0, 0)
  await wait(100)
  await select()
  await assert.rejects(propose(stale), /fresh context/)
  const unchanged = document.getText()
  await vscode.commands.executeCommand('threadlight.coach.accept')
  assert.notEqual(document.getText(), unchanged)
  await vscode.commands.executeCommand('undo')
  assert.equal(document.getText(), unchanged)
  await select()
  await propose(await context())
  await editor.edit((edit) => edit.insert(document.lineAt(1).range.end, '!'))
  const dirty = document.getText()
  await vscode.commands.executeCommand('threadlight.coach.accept')
  assert.equal(document.getText(), dirty)
  await select()
  await propose(await context())
  const other = await vscode.workspace.openTextDocument({ content: 'different' })
  await vscode.window.showTextDocument(other)
  await vscode.commands.executeCommand('threadlight.coach.accept')
  assert.equal(other.getText(), 'different')
  editor = await vscode.window.showTextDocument(document)
  await vscode.commands.executeCommand('threadlight.coach.accept')
  assert.notEqual(document.getText(), dirty)
  await vscode.commands.executeCommand('undo')
  assert.equal(document.getText(), dirty)
  editor.selections = [new vscode.Selection(0, 0, 0, 2), new vscode.Selection(1, 0, 1, 2)]
  const multiple = await context()
  assert.equal(multiple.selectedText, undefined)
  await assert.rejects(propose(multiple), /one nonempty range/)
  await select()
  const single = await context()
  await coach.run(session, { action: 'inline', snapshot: single.snapshot, replacements: [''] })
  if (page) {
    await page.locator('.review-widget').getByText('Delete the selection').waitFor()
    await page.keyboard.press('ArrowRight')
    await until(() => editor.selection.isEmpty)
  } else await vscode.commands.executeCommand('threadlight.coach.dismiss')
  assert.equal(document.getText(), dirty)
  await select()
  await propose(await context())
  coach.close()
  await wait(150)
  await vscode.commands.executeCommand('threadlight.coach.accept')
  assert.equal(document.getText(), dirty)
  if (page) {
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    editor.selection = new vscode.Selection(0, 0, 0, 0)
    await wait(100)
    await page.keyboard.press('ArrowRight')
    await until(() => editor.selection.active.character === 1)
    await page.keyboard.press('Tab')
    await until(() => document.getText() !== dirty)
    await vscode.commands.executeCommand('undo')
    assert.equal(document.getText(), dirty)
  }
  console.log(
    'PASS exact partial multiline inline previews on LF/CRLF dirty buffers, alternate acceptance, one undo, unchanged disk, stale selection/version/editor and disconnect cleanup' +
      (page
        ? ', visible review widget and keyboard controls including normal editing after dismissal.'
        : '.'),
  )
  await require('./proposals.vscode.cjs').checkProposals({ root, coach, session, page, until })
  await require('./trace.vscode.cjs').checkTrace({ root, coach, session, page, until })
}

async function workbenchPage(root) {
  let page
  if (process.env.THREADLIGHT_COACH_KEYBOARD === '1') {
    const { chromium } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
    const port = fs
      .readFileSync(path.join(root, 'profile', 'DevToolsActivePort'), 'utf8')
      .split('\n')[0]
    const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
    page = browser
      .contexts()[0]
      .pages()
      .find((tab) => tab.url().includes('workbench'))
    assert.ok(page)
  }
  return page
}

function signedLive(root, descriptor) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.THREADLIGHT_TEST_NODE, ['test/agentLive.live.mjs'], {
      cwd: path.resolve(__dirname, '../..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, THREADLIGHT_LIVE_COACH: descriptor },
    })
    const log = (chunk) => fs.appendFileSync(path.join(root, 'signed-live.log'), chunk)
    child.stdout.on('data', log)
    child.stderr.on('data', log)
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Signed-in Live check failed: ' + code)),
    )
  })
}
