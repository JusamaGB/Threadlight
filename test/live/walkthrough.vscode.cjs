/* global window, document, getComputedStyle */
const assert = require('node:assert/strict')
const vscode = require('vscode')

async function check({ coach, session, descriptor, EditorCoach, until, page }) {
  coach.close()
  const text = Array.from(
    { length: 92 },
    (_, i) => 'value = ' + (i + 1) + (i === 85 || i === 86 ? ' # ' + 'x'.repeat(6900) : ''),
  ).join('\n')
  const doc = await vscode.workspace.openTextDocument({ language: 'python', content: text })
  const editor = await vscode.window.showTextDocument(doc)
  const heard = [],
    pages = []
  let pointer = { arrow: true, x: 0, y: 0 }
  // CDP does not move the Windows pointer. Sample the corresponding cursor
  // from the disposable editor for the bridge's native-pointer input.
  await page.exposeFunction('walkthroughTestPointer', (value) => {
    pointer = value
  })
  await page.evaluate(() => {
    const sample = (e) => {
      const cursor = getComputedStyle(e.target).cursor
      void window.walkthroughTestPointer({
        arrow: cursor === 'default' || cursor === 'auto',
        x: e.clientX,
        y: e.clientY,
      })
    }
    document.addEventListener('pointerdown', sample, true)
    document.addEventListener('pointermove', sample, true)
  })
  let hold = true,
    mouseHeld = false,
    release,
    failure
  const bridge = new EditorCoach(
    () => session,
    async () => {},
    descriptor,
    async (_id, event) => {
      if (!event.needsNotes) return
      try {
        await prepare(await run({ action: 'walkthrough_page', token: event.token }))
      } catch (e) {
        failure = e
        throw e
      }
    },
    undefined,
    async (_id, explanation, signal) => {
      const n = Number(explanation.split(' ').at(-1))
      if (explanation.startsWith('Section')) heard.push(explanation)
      else {
        assert.ok(editor.visibleRanges.some((r) => r.start.line < n && r.end.line >= n - 1))
        heard.push(n)
      }
      if (hold)
        await new Promise((resolve) => {
          release = resolve
          signal.addEventListener('abort', resolve, { once: true })
        })
    },
    () => mouseHeld,
    () => pointer,
  )
  const run = (cmd) => bridge.run(session, cmd)
  const prepare = async (result) => {
    pages.push(result.line)
    if (result.endLine > result.line) {
      let current = result
      if (current.nextLine) {
        await assert.rejects(
          run({
            action: 'walkthrough_notes',
            token: result.token,
            explanations: ['Incomplete section'],
          }),
          /remaining pages/,
        )
      }
      while (current.nextLine)
        current = await run({
          action: 'walkthrough_page',
          token: result.token,
          fromLine: current.nextLine,
        })
      return run({
        action: 'walkthrough_notes',
        token: result.token,
        explanations: ['Section ' + result.line + ' to ' + result.endLine],
      })
    }
    return run({
      action: 'walkthrough_notes',
      token: result.token,
      explanations: result.lines.map(({ line, text }) => {
        assert.equal(text, doc.lineAt(line - 1).text)
        return 'Assign value ' + line
      }),
    })
  }
  async function start(n, auto) {
    const context = await run({ action: 'context', line: n })
    assert.equal(context.lines[0].line, n)
    const result = await run({ action: 'walkthrough', snapshot: context.snapshot, line: n, auto })
    await prepare(result)
    return result
  }
  const heardLine = (line) =>
    until(() => {
      if (failure) throw failure
      return heard.includes(line)
    }).catch(async (e) => {
      throw Error(
        'Expected ' +
          line +
          '; heard ' +
          JSON.stringify(heard) +
          '; state ' +
          JSON.stringify(await run({ action: 'guide_status' })),
        { cause: e },
      )
    })
  try {
    const first = await start(75)
    const lens = (label) =>
      page.locator('.codelens-decoration').getByText(label, { exact: true }).first()
    const gutter = (n) =>
      page
        .locator('.monaco-editor .line-numbers')
        .filter({ hasText: new RegExp('^' + n + '$') })
        .first()
    await lens('Start').waitFor()
    assert.deepEqual(heard, [])
    assert.equal(editor.selection.active.line, 0)
    const code = page
      .locator('.monaco-editor .view-line')
      .filter({ hasText: /^value\s*=\s*75$/ })
      .first()
    const box = await code.boundingBox()
    assert.ok(box)
    const x = box.x + 15,
      y = box.y + box.height / 2
    await page.mouse.click(x, y)
    await page.mouse.click(x, y, { clickCount: 2 })
    await page.mouse.click(x, y, { clickCount: 3 })
    editor.selection = new vscode.Selection(0, 0, 0, 0)
    editor.revealRange(doc.lineAt(74).range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    await new Promise((r) => setTimeout(r, 120))
    const pos = await code.boundingBox()
    mouseHeld = true
    await page.mouse.move(pos.x + 15, pos.y + pos.height / 2)
    await page.mouse.down()
    await page.mouse.move(pos.x + 42, pos.y + pos.height * 2.5, { steps: 5 })
    await page.mouse.up()
    mouseHeld = false
    await new Promise((r) => setTimeout(r, 220))
    assert.deepEqual(heard, [])
    assert.equal((await run({ action: 'guide_status' })).token, first.token)
    assert.equal((await run({ action: 'guide_status' })).status, 'shown')
    assert.equal(doc.getText(), text)
    await lens('☑ Auto').click()
    await lens('☐ Auto').waitFor()
    await gutter(75).click()
    await heardLine(75)
    release()
    await until(async () => (await run({ action: 'guide_status' })).playback === 'finished')
    await lens('Start').click()
    await until(() => heard.length === 2)
    release()
    await new Promise((r) => setTimeout(r, 180))
    assert.deepEqual(heard, [75, 75])
    await lens('Next').click()
    await heardLine(76)
    const playing = await run({ action: 'guide_status' })
    const line76 = await page
      .locator('.monaco-editor .view-line')
      .filter({ hasText: /^value\s*=\s*76$/ })
      .first()
      .boundingBox()
    assert.ok(line76)
    await page.mouse.click(line76.x + 18, line76.y + line76.height / 2)
    await page.mouse.move(line76.x + 1, line76.y + line76.height / 2)
    mouseHeld = true
    await page.mouse.down()
    await page.mouse.move(line76.x + 1, line76.y + line76.height * 1.5, { steps: 6 })
    await page.mouse.up()
    mouseHeld = false
    await new Promise((r) => setTimeout(r, 180))
    const unchanged = await run({ action: 'guide_status' })
    assert.equal(unchanged.token, playing.token)
    assert.equal(unchanged.playback, 'speaking')
    // CDP gestures do not change a physical Windows button. Hold the injected
    // button probe across the editor's real intermediate selection events.
    const point = async (n) => {
      const box = await gutter(n).boundingBox()
      assert.ok(box)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const from = await point(80),
      middle = await point(78),
      to = await point(77)
    mouseHeld = true
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(middle.x, middle.y, { steps: 4 })
    await new Promise((r) => setTimeout(r, 220))
    assert.deepEqual(heard, [75, 75, 76])
    await page.mouse.move(to.x, to.y, { steps: 4 })
    await page.mouse.up()
    mouseHeld = false
    await heardLine('Section 77 to 80')
    release()
    await until(async () => (await run({ action: 'guide_status' })).playback === 'finished')
    await lens('Next').click()
    await heardLine(81)
    await lens('☐ Auto').click()
    await lens('☑ Auto').waitFor()
    heard.length = 0
    for (const n of [76, 80, 81, 83]) {
      const range = doc.lineAt(n - 1).range
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
      await page
        .locator('.monaco-editor .line-numbers')
        .filter({ hasText: new RegExp('^' + n + '$') })
        .first()
        .click({ timeout: 4000 })
      await heardLine(n)
    }
    assert.deepEqual(heard, [76, 80, 81, 83])
    await assert.rejects(
      run({ action: 'walkthrough_notes', token: first.token, explanations: ['stale'] }),
      /changed/,
    )
    hold = false
    release()
    await until(async () => (await run({ action: 'guide_status' })).status === 'completed')
    assert.equal(heard.at(-1), 92)
    heard.length = pages.length = 0
    await start(1)
    await lens('Start').click()
    // A full pass crosses both the eight-note page and the sixty-line context window.
    await heardLine(32)
    await heardLine(60)
    await heardLine(92)
    await until(async () => (await run({ action: 'guide_status' })).status === 'completed')
    assert.deepEqual(
      heard,
      Array.from({ length: 92 }, (_, i) => i + 1),
    )
    assert.ok(pages.includes(65))
    await start(85)
    const a = await point(85),
      b = await point(88)
    mouseHeld = true
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 5 })
    await page.mouse.up()
    mouseHeld = false
    await heardLine('Section 85 to 88')
    await lens('Start').waitFor()
    assert.equal((await run({ action: 'guide_status' })).started, false)
    await vscode.commands.executeCommand('threadlight.coach.cancelGuide')
    await lens('Start').waitFor({ state: 'detached' })
    hold = true
    heard.length = 0
    const manual = await start(83, false)
    assert.equal(manual.auto, false)
    const controls = vscode.commands.executeCommand('threadlight.coach.walkthroughControls')
    await page
      .locator('.quick-input-list .monaco-list-row')
      .filter({ hasText: 'Start' })
      .first()
      .click()
    await controls
    await heardLine(83)
    await editor.edit((edit) => edit.insert(doc.lineAt(0).range.start, '#'))
    await until(async () => (await run({ action: 'guide_status' })).status === 'ended')
    assert.equal(heard.at(-1), 83)
    const header = [
      '#!/usr/bin/env python',
      '# encoding: utf-8',
      'r"""Practice assessment',
      ...Array(52).fill('Instructions'),
      '"""',
      '',
      '',
      '# Write your solution below.',
      'def solve():',
      '    pass',
    ]
    assert.equal(header.indexOf('def solve():'), 59)
    const practice = await vscode.workspace.openTextDocument({
      language: 'python',
      content: header.join('\n'),
    })
    await vscode.window.showTextDocument(practice)
    const at = async (line) => {
      const ctx = await run({ action: 'context' })
      return run({ action: 'walkthrough', snapshot: ctx.snapshot, line })
    }
    assert.equal((await at()).line, 60)
    assert.equal((await at(1)).line, 1)
    await vscode.commands.executeCommand('threadlight.coach.cancelGuide')
    console.log(
      'PASS code clicks and drags stay silent, gutter-only line and section explanations, Python default line 60 and explicit line 1, Start/Next and Auto through line 92.',
    )
  } finally {
    bridge.close()
  }
}
module.exports = { check }
