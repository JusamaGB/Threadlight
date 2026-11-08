/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { openHeaderPage } from './header-navigation.mjs'

export async function checkSpokenReply(page, url) {
  await openHeaderPage(page, 'Agent')
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click()
  const toggle = page.getByRole('switch', { name: 'Show spoken replies in waveform pill' })
  assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  await toggle.press('Space')
  await page.waitForFunction(
    async () => (await window.threadlight.getSettings()).spokenReplyCompanion,
  )
  assert.equal(await toggle.getAttribute('aria-checked'), 'true')
  await page.goto(url + '?view=dot')
  await page.setViewportSize({ width: 344, height: 330 })
  await page.evaluate(() => {
    document.body.style.backgroundColor = '#30363d'
    document.querySelector('#root').style.margin = '24px'
    window.proof.emit('onOpenMicLive', true)
    window.proof.emit('onMotion', {
      mode: 'listening',
      provider: 'codex',
      input: { level: 0, low: 0, mid: 0, high: 0 },
      output: { level: 0.32, low: 0.24, mid: 0.38, high: 0.12 },
    })
  })
  const pill = page.getByRole('group', { name: 'Microphone is open', exact: true })
  const box = page.getByRole('region', { name: 'Latest spoken Agent reply' })
  const close = page.getByRole('button', { name: 'Close spoken reply' })
  const publish = (value) =>
    page.evaluate((value) => window.threadlight.publishSpokenReply(value), value)
  const settle = (width, height) =>
    page.waitForFunction(
      ([w, h]) => {
        const sizes = window.proof.pillSizes || []
        const last = sizes.at(-1)
        return last && last[0] === w && (h === 'open' ? last[1] > 40 : last[1] === h)
      },
      [width, height],
    )
  const sizes = () => page.evaluate(() => window.proof.pillSizes)
  const resetSizes = () =>
    page.evaluate(() => {
      window.proof.pillSizes = []
    })
  await settle(92, 24)
  // Measure the ink of the real caption, including the room reserved for the close button.
  const captionWidth = async (text) => {
    await publish({ id: 'stream', captionIds: ['stream'], text, blocks: [] })
    await box.getByText(text, { exact: true }).waitFor()
    const target = await box.evaluate((el) => el.offsetWidth)
    await page.waitForFunction((w) => {
      const pill = document.querySelector('[data-unfolded]')
      return (
        pill &&
        Math.abs(pill.getBoundingClientRect().width - w) < 0.01 &&
        pill.offsetHeight ===
          24 + document.querySelector('[aria-label="Latest spoken Agent reply"]').offsetHeight
      )
    }, target)
    const ink = await box.locator('p').evaluate((el) => {
      const range = document.createRange()
      const parent = el.closest('[data-unfolded]').getBoundingClientRect()
      const lines = new Map()
      const node = el.firstChild
      for (let i = 0; i < node.length; i++) {
        if (!node.textContent[i].trim()) continue
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const r = range.getBoundingClientRect()
        const first = lines.get(r.top)?.left ?? r.left
        lines.set(r.top, { left: first, right: r.right })
      }
      const center = parent.left + parent.width / 2
      return {
        offset: Math.max(
          ...[...lines.values()].map((line) => Math.abs((line.left + line.right) / 2 - center)),
        ),
        lines: lines.size,
      }
    })
    assert.ok(Math.abs(ink.offset) <= 1, JSON.stringify(ink))
    return { target, lines: ink.lines }
  }
  assert.equal((await captionWidth('Yeah.')).target, 92)
  if (process.env.THREADLIGHT_SCREENSHOTS) {
    await page.screenshot({
      path: join(process.env.THREADLIGHT_SCREENSHOTS, 'threadlight-spoken-reply-short.png'),
      clip: { x: 0, y: 0, width: 140, height: Math.ceil((await pill.boundingBox()).height) + 48 },
    })
  }
  const two = await captionWidth('Makes sense.')
  assert.ok(two.target > 92 && two.target < 296 && two.lines < 1.2)
  const growing = await captionWidth('Makes sense. Let’s add the prices.')
  assert.ok(growing.target > two.target && growing.target < 296 && growing.lines < 1.2)
  const wrapped = await captionWidth(
    'Makes sense. Let’s add the prices for the three items, and then print the receipt total on the next line.',
  )
  assert.ok(wrapped.target === 296 && wrapped.lines >= 2)
  await publish(null)
  await settle(92, 24)
  const reply = {
    id: 'caption:one',
    captionIds: ['one'],
    text: 'Each entry is an item name. Use it to look up the price, then print both together.',
    blocks: [],
  }
  const code = 'for entry in order:\n    print(entry, inv[entry])'
  await resetSizes()
  await publish(reply)
  await settle(296, 'open')
  assert.ok(
    (await sizes()).some(([w, h]) => w > 92 && w < 296 && h === 24),
    'width opens first',
  )
  assert.ok(
    (await sizes()).every(([w, h]) => h === 24 || w === 296),
    'height opens only after width',
  )
  const updated = {
    ...reply,
    text: reply.text,
    blocks: [{ language: 'python', value: code, start: 120 }],
  }
  await publish(updated)
  await box.getByText(updated.text).waitFor()
  await box.locator('.hljs-keyword').first().waitFor()
  assert.ok(
    ['start', 'left'].includes(
      await box.locator('pre').evaluate((el) => getComputedStyle(el).textAlign),
    ),
  )
  const caption = box.locator('p')
  const captionBox = await caption.boundingBox()
  const actions = () =>
    page.evaluate(() =>
      window.proof.calls.filter((c) =>
        ['dotHover', 'dotClick', 'dotDrag', 'dotDragEnd'].includes(c[0]),
      ),
    )
  const beforeReading = await actions()
  await page.mouse.move(captionBox.x + 30, captionBox.y + 8)
  await page.mouse.down()
  await page.mouse.move(captionBox.x + 100, captionBox.y + 8, { steps: 5 })
  await page.mouse.up()
  await page.clock.fastForward(350)
  assert.ok(
    (await page.evaluate(() => window.getSelection().toString())).trim().length > 0,
    'spoken text is selectable',
  )
  assert.deepEqual(await actions(), beforeReading)
  for (const target of [caption, box.locator('summary'), box.locator('pre')]) {
    await target.click({ button: 'right' })
    await page.getByRole('menu', { name: 'Voice call actions' }).waitFor()
    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.querySelector('[data-unfolded]')?.getBoundingClientRect().width === 296,
    )
  }
  assert.deepEqual(await actions(), beforeReading, 'body menus never hover-open or drag')
  const bar = pill.getByRole('button', { name: /Open voice panel/i })
  const pos = await bar.boundingBox()
  await page.mouse.move(pos.x + 30, pos.y + 10)
  await page.mouse.down()
  await page.mouse.move(pos.x + 53, pos.y + 16)
  await page.mouse.up()
  await page.clock.fastForward(350)
  assert.deepEqual((await actions()).slice(beforeReading.length), [
    ['dotDrag', 23, 6],
    ['dotDragEnd'],
  ])
  await box.getByRole('button', { name: 'Copy code' }).click()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'copy').at(-1)[1]),
    code + '\n',
  )
  const wave = pill.getByRole('button', { name: /Open|voice panel/i }).first()
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('[data-unfolded]').offsetHeight -
          (24 + document.querySelector('[aria-label="Latest spoken Agent reply"]').offsetHeight),
      ) <= 1,
  )
  if (process.env.THREADLIGHT_SCREENSHOTS) {
    await page.mouse.move(330, 320)
    await box.getByRole('button', { name: 'Copy code' }).evaluate((el) => el.blur())
    await page.waitForFunction(() => document.querySelector('[title="Copy code"]'))
    const bounds = await pill.boundingBox()
    await page.screenshot({
      path: join(process.env.THREADLIGHT_SCREENSHOTS, 'threadlight-spoken-reply-companion.png'),
      clip: { x: 0, y: 0, width: 344, height: Math.ceil(bounds.y + bounds.height + 24) },
    })
  }
  await resetSizes()
  await close.press('Enter')
  await settle(92, 24)
  assert.ok(
    (await sizes()).every(([w, h]) => w === 296 || h === 24),
    'body folds before width shrinks',
  )
  assert.ok((await sizes()).some(([w, h]) => w > 92 && w < 296 && h === 24))
  assert.equal(
    await page.evaluate(() =>
      window.proof.calls.some((c) => ['dotClick', 'stopOpenMic'].includes(c[0])),
    ),
    false,
  )
  await publish({
    ...updated,
    id: reply.id,
    blocks: [{ language: 'python', value: 'print(entry, inv[entry])', start: 0 }],
  })
  assert.equal(await box.count(), 0, 'late backing code cannot reopen an already dismissed caption')
  await publish({ ...updated, id: 'pending-tail', captionIds: ['tail'], awaitingLink: true })
  assert.equal(await box.count(), 0, 'an unresolved tail cannot reopen the dismissed turn')
  await publish({
    ...updated,
    id: 'linked-answer',
    captionIds: ['one', 'tail'],
    text: 'A later caption',
  })
  assert.equal(await box.count(), 0, 'promoting a dismissed native caption keeps it dismissed')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await resetSizes()
  await publish({
    ...updated,
    id: 'another-answer',
    captionIds: ['new'],
    text: Array(90).fill('An extended answer.').join(' '),
  })
  await settle(296, 256)
  assert.ok(
    (await sizes()).every(([w, h]) => (w === 296 || w === 92) && (h === 256 || h === 24)),
    JSON.stringify(await sizes()),
  )
  assert.equal(await pill.evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
  await box.focus()
  await box.press('End')
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Latest spoken Agent reply"]').scrollTop > 0,
  )
  await wave.press('Shift+F10')
  await page.getByRole('menu', { name: 'Voice call actions' }).waitFor()
  assert.equal(await box.count(), 0)
  await page.keyboard.press('Escape')
  await box.waitFor()
  await publish(null)
  await settle(92, 24)
  assert.equal(await box.count(), 0)
  const frameDir = process.env.THREADLIGHT_ANIMATION_FRAMES
  if (frameDir) {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.mouse.move(330, 320)
    await page.evaluate(() =>
      Object.assign(document.querySelector('#root').style, {
        position: 'absolute',
        left: '50%',
        top: '24px',
        margin: '0',
        width: 'max-content',
        transform: 'translateX(-50%)',
      }),
    )
    for (let i = 0; i < 61; i++) {
      if (i === 4) await publish(reply)
      if (i === 19) await publish(updated)
      if (i === 45) await publish(null)
      if ([4, 13, 20, 30, 37, 44].includes(i)) {
        const amplitude = [4, 20, 37].includes(i) ? 0.32 : 0
        await page.evaluate(
          (level) =>
            window.proof.emit('onMotion', {
              mode: 'listening',
              provider: 'codex',
              input: { level: 0, low: 0, mid: 0, high: 0 },
              output: { level, low: level * 0.8, mid: level, high: level * 0.5 },
            }),
          amplitude,
        )
      }
      await page.screenshot({
        path: join(frameDir, 'frame-' + String(i).padStart(3, '0') + '.png'),
        clip: { x: 0, y: 0, width: 344, height: 256 },
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  await page.evaluate(() => window.proof.emit('onOpenMicLive', false))
  await pill.waitFor({ state: 'detached' })
}
