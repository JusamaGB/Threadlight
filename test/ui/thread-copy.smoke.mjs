/* global window, document, getComputedStyle, WheelEvent */
import assert from 'node:assert/strict'
import { selectThreadView } from './header-navigation.mjs'

async function checkCodePan(page, card, history) {
  const file = card.locator('pre')
  const keyword = file.locator('.hljs-keyword').first()
  await keyword.scrollIntoViewIfNeeded()
  const word = await keyword.boundingBox()
  const y = word.y + word.height / 2
  await page.mouse.move(word.x + 1, y)
  await page.mouse.down()
  await page.mouse.move(word.x + word.width, y)
  await page.mouse.up()
  assert.equal(await page.evaluate(() => window.getSelection().toString()), 'def')
  await page.evaluate(() => window.getSelection().removeAllRanges())

  const cursor = () => file.locator('code').evaluate((el) => getComputedStyle(el).cursor)
  assert.equal(await cursor(), 'text')
  await page.evaluate(() => window.proof.emit('onPanelControlHeld', true))
  assert.equal(await cursor(), 'grab')
  await page.evaluate(() => window.proof.emit('onPanelControlHeld', false))
  assert.equal(await cursor(), 'text')
  await page.keyboard.down('Control')
  assert.equal(await cursor(), 'grab')
  assert.equal(
    await card
      .getByRole('button', { name: 'Copy code' })
      .evaluate((el) => getComputedStyle(el).cursor),
    'pointer',
  )

  const box = await file.boundingBox(),
    reader = await history.boundingBox()
  const startX = Math.min(box.x + box.width - 10, reader.x + reader.width - 10)
  const startY = Math.min(box.y + box.height - 10, reader.y + reader.height - 10)
  const offset = () => file.evaluate((el) => [el.scrollLeft, el.scrollTop])
  const historyTop = await history.evaluate((el) => el.scrollTop)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  assert.equal(await cursor(), 'grabbing')
  await page.mouse.move(startX - 45, startY - 32)
  assert.deepEqual(await offset(), [45, 32])
  assert.equal(await history.evaluate((el) => el.scrollTop), historyTop)
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '')
  await page.keyboard.up('Control')
  assert.equal(await cursor(), 'text')
  await page.mouse.move(startX - 65, startY - 50)
  assert.deepEqual(await offset(), [45, 32])
  await page.mouse.up()

  await page.keyboard.down('Control')
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX - 60, startY - 40)
  await page.mouse.up()
  assert.equal(await cursor(), 'grab')
  await page.keyboard.up('Control')
  assert.deepEqual(await offset(), [105, 72])
  const limits = await file.evaluate((el) => [
    el.scrollWidth - el.clientWidth,
    el.scrollHeight - el.clientHeight,
  ])
  await page.keyboard.down('Control')
  const swipes = Math.ceil(Math.max(limits[0] / 65, limits[1] / 40))
  for (let i = 0; i < swipes; i++) {
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 65, startY - 40)
    await page.mouse.up()
  }
  assert.deepEqual(await offset(), limits, 'right and bottom edges are reachable')
  await page.mouse.move(startX - 65, startY - 40)
  await page.mouse.down()
  await page.mouse.move(startX, startY)
  await page.mouse.up()
  assert.deepEqual(
    await offset(),
    [limits[0] - 65, limits[1] - 40],
    'dragging back reveals earlier code',
  )
  await page.keyboard.up('Control')
}

export async function checkThreadCopy(page, capture) {
  const reply = 'Copy just this: 🙂 🙁\nif happy:\n    print("hello")'
  const python =
    'def main():\n    while True:\n        print("🙂")\n' +
    '        # ' +
    'a long line '.repeat(8) +
    'right edge\n' +
    Array.from({ length: 24 }, (_, i) => '        print(' + i + ')\n').join('')
  await page.evaluate(
    async ({ text, python }) => {
      await window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        panelLayout: 'single',
        listMode: 'recent',
      })
      await window.proof.patch({ state: 'idle', attention: null, plan: [], planText: null })
      window.threadlight.artifacts = async () => ({
        ok: true,
        items: [
          {
            id: 'recorded-example',
            title: 'example.py',
            kind: 'text',
            mime: 'text/plain',
            createdAt: 1,
            path: 'C:/example.py',
            source: 'reference',
          },
        ],
      })
      window.threadlight.threadTimeline = async ({ threadId }) => ({
        ok: true,
        timeline: {
          revision: 1,
          threadId,
          connection: 'history',
          items: [
            {
              id: 'named-reply',
              role: 'assistant',
              kind: 'message',
              phase: 'final',
              at: null,
              turnId: 'named',
              complete: true,
              source: 'codex_stream',
              text: '```python filename="lesson/first.py"\nprint(1)\n```',
            },
            {
              id: 'named-linked-reply',
              role: 'assistant',
              kind: 'message',
              phase: 'final',
              at: null,
              turnId: 'linked',
              complete: true,
              source: 'codex_stream',
              text: '```python filename="lesson/second.py"\nprint(2)\n```\nSee [example.py](C:/example.py).',
            },
            {
              id: 'copy-reply',
              role: 'assistant',
              kind: 'message',
              text,
              phase: 'final',
              at: null,
              turnId: 'copy-turn',
              complete: true,
              source: 'codex_stream',
            },
            {
              id: 'python-card',
              role: 'assistant',
              kind: 'message',
              phase: 'final',
              at: null,
              turnId: 'python-turn',
              complete: true,
              source: 'codex_stream',
              text:
                'Here is the example:\n\n```python\n' +
                python +
                '```\n\nSee [example.py](C:/example.py).',
            },
          ],
          hasMore: false,
          loadingOlder: false,
        },
      })
    },
    { text: reply, python },
  )
  await selectThreadView(page, 'recent')
  for (const provider of ['codex', 'claude']) {
    const row = page
      .locator(
        `[data-session-id${provider === 'codex' ? '^=' : '='}"${provider === 'codex' ? 'codex:' : 'synthetic-claude'}"]`,
      )
      .first()
    await row
      .getByRole('button', {
        name: new RegExp(`Synthetic ${provider === 'codex' ? 'Codex' : 'Claude'}`),
      })
      .first()
      .click()
    const history = row.getByRole('region', { name: 'Conversation history', exact: true })
    for (const [id, name] of [
      ['named-reply', 'first.py'],
      ['named-linked-reply', 'second.py'],
    ]) {
      const summary = history.locator('[data-message-id="' + id + '"] summary')
      assert.match(await summary.textContent(), new RegExp(name.replace('.', '\\.') + 'Python'))
    }
    const paragraph = history.locator('[data-message-id="copy-reply"] > p')
    const card = history.locator('[data-message-id="python-card"]')
    await card.getByText('Python', { exact: true }).waitFor()
    await page.evaluate(
      async (threadId) =>
        window.proof.emit('onArtifactsChanged', {
          threadId,
          items: (await window.threadlight.artifacts(threadId, 'list')).items,
        }),
      await row.getAttribute('data-session-id'),
    )
    assert.ok(await card.getByRole('link', { name: 'example.py' }).isEnabled())
    await card.locator('pre code .hljs-keyword').first().waitFor()
    assert.equal(await card.locator('code').textContent(), python)
    await checkCodePan(page, card, history)
    const wheel = await card.locator('pre').evaluate((el) => {
      el.scrollTo(0, 0)
      const send = (target, opts) => {
        const event = new WheelEvent('wheel', {
          cancelable: true,
          bubbles: true,
          shiftKey: true,
          ...opts,
        })
        target.dispatchEvent(event)
        return [event.defaultPrevented, el.scrollLeft, el.scrollTop]
      }
      return [
        send(el, { deltaY: 24 }),
        send(el, { deltaY: 18, deltaX: 10 }),
        send(el, { deltaY: 4, ctrlKey: true }),
        send(el, { deltaY: -1000 }),
        send(el, { deltaY: -1000 }),
        send(document.body, { deltaY: 7 }),
        send(el, { shiftKey: false, deltaY: 80 }),
      ]
    })
    assert.deepEqual(wheel, [
      [true, 24, 0],
      [true, 34, 0],
      [false, 34, 0],
      [true, 0, 0],
      [false, 0, 0],
      [false, 0, 0],
      [true, 0, 20],
    ])
    await card.getByRole('button', { name: 'Copy code' }).click()
    assert.equal(
      await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'copy').at(-1)[1]),
      python,
    )
    await capture('thread-python-card-' + provider)
    await paragraph.waitFor()
    const select = async (text) => {
      await history.focus()
      await paragraph.scrollIntoViewIfNeeded()
      return paragraph.evaluate((el, fragment) => {
        const node = el.firstChild
        const start = node.textContent.indexOf(fragment)
        if (start < 0) throw new Error('Missing copy fixture text')
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + fragment.length)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + 2, y: rect.top + 2 }
      }, text)
    }
    const copies = () => page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'copy'))
    for (const fragment of ['🙂', '🙁', 'if happy:\n    print("hello")']) {
      const before = (await copies()).length
      const point = await select(fragment)
      await page.mouse.click(point.x, point.y, { button: 'right' })
      const menu = page.getByRole('menu', { name: 'Text actions', exact: true })
      await menu.waitFor()
      assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Copy'])
      const bounds = await menu.boundingBox()
      const card = await page.locator('[data-card]').boundingBox()
      assert.ok(bounds.x >= card.x && bounds.x + bounds.width <= card.x + card.width)
      await capture(`thread-copy-${provider}`)
      // Menu focus or a subsequent selection change must not replace the captured text.
      await page.evaluate(() => window.getSelection().removeAllRanges())
      await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click()
      assert.equal((await copies()).length, before + 1)
      assert.equal((await copies()).at(-1)[1], fragment)
      await menu.waitFor({ state: 'detached' })
    }
    await select('🙂 🙁')
    await history.press('Shift+F10')
    const menu = page.getByRole('menu', { name: 'Text actions', exact: true })
    await menu.waitFor()
    assert.equal(
      await menu
        .getByRole('menuitem', { name: 'Copy' })
        .evaluate((el) => el === document.activeElement),
      true,
    )
    const beforeEscape = (await copies()).length
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    assert.equal((await copies()).length, beforeEscape)
    assert.equal(await history.evaluate((el) => el === document.activeElement), true)
    await select('🙂 🙁')
    await history.press('Shift+F10')
    await menu.waitFor()
    await page.keyboard.press('Enter')
    await menu.waitFor({ state: 'detached' })
    assert.equal((await copies()).at(-1)[1], '🙂 🙁')
    await page.evaluate(() => window.getSelection().removeAllRanges())
    await paragraph.click({ button: 'right' })
    assert.equal(await menu.count(), 0)
    if (provider === 'codex') {
      await card.locator('summary').first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
      const dock = page.getByRole('region', { name: 'Pinned code' })
      assert.equal(await dock.locator('code').textContent(), python)
      assert.match(await dock.locator('summary').textContent(), /Snippet/)
      const body = await dock.locator('pre').boundingBox()
      await page.keyboard.down('Control')
      await page.mouse.move(body.x + 70, body.y + 40)
      await page.mouse.down()
      await page.mouse.move(body.x + 35, body.y + 20)
      await page.mouse.up()
      await page.keyboard.up('Control')
      assert.deepEqual(
        await dock.locator('pre').evaluate((e) => [e.scrollLeft, e.scrollTop]),
        [35, 20],
      )
      await dock.locator('pre').focus()
      await page.mouse.move(body.x + 70, body.y + 40)
      await page.keyboard.down('Shift')
      await page.mouse.wheel(0, 80)
      await page.keyboard.up('Shift')
      await page.waitForFunction(
        () => document.querySelector('[data-pinned-code] pre').scrollLeft > 35,
      )
      await capture('pinned-code-reference')
    }
    await row
      .getByRole('button', {
        name: new RegExp(`Synthetic ${provider === 'codex' ? 'Codex' : 'Claude'}`),
      })
      .first()
      .click()
  }
  const dock = page.getByRole('region', { name: 'Pinned code' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(await dock.locator('code').textContent(), python)
  await page.reload()
  await dock.waitFor()
  assert.equal(await dock.locator('code').textContent(), python)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('fixture.pinnedState'))
    const file = state.files[0]
    file.history = [{ revision: 1, code: file.code }]
    file.code = '# New revision'
    file.revision = 2
    file.viewedRevision = 1
    state.generation++
    localStorage.setItem('fixture.pinnedState', JSON.stringify(state))
    window.proof.emit('onPinsChanged', state)
  })
  await dock.getByText(/Version 1.*of 2 saved/).waitFor()
  const copy = dock.getByRole('button', { name: 'Copy code' })
  await copy.press('Enter')
  await dock.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'copy').at(-1)[1]),
    python,
  )
  await page.evaluate(() => {
    window.threadlight.copyText = async () => false
  })
  await copy.press('Enter')
  await dock.getByRole('status').filter({ hasText: 'Copy failed' }).waitFor()
  await dock.locator('summary').press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
  await dock.waitFor({ state: 'detached' })
  console.log(
    'PASS: two-axis Ctrl-drag to the file edges, release, ordinary selection, full-code Copy, emoji/indented text and keyboard Copy for both Smart Thread providers.',
  )
}
