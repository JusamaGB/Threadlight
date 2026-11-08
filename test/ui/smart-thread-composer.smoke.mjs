/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict'

export async function checkSmartThreadComposer(page, conversation, history, composer) {
  const input = composer.getByRole('textbox')
  for (const lines of [1, 2, 3, 4, 8, 3, 1]) {
    const text = Array.from({ length: lines }, (_, i) => `Draft line ${i + 1}`).join('\n')
    await input.fill(text)
    const frames = await conversation.evaluate(async (element) => {
      const samples = []
      for (let frame = 0; frame < 16; frame++) {
        await new Promise(requestAnimationFrame)
        const input = element.querySelector('textarea')
        const history = element.querySelector('[aria-label="Conversation history"]')
        samples.push({
          visible: input.getBoundingClientRect().height > 0,
          focused: document.activeElement === input,
          gap: history.scrollHeight - history.scrollTop - history.clientHeight,
          height: input.getBoundingClientRect().height,
        })
      }
      return samples
    })
    assert.ok(
      frames.every((frame) => frame.visible),
      `${lines} lines: composer stays visible`,
    )
    assert.ok(
      frames.every((frame) => frame.focused),
      `${lines} lines: typing keeps focus`,
    )
    assert.ok(
      frames.every((frame) => frame.gap < 24),
      `${lines} lines: history stays live`,
    )
    assert.equal(new Set(frames.map((frame) => frame.height)).size, 1, 'input height settles')
    assert.equal(frames.at(-1).height, Math.min(lines, 4) * 18, 'input grows to four lines')
    assert.equal(await input.inputValue(), text)
  }
  const wrapped = 'A longer draft that wraps naturally in this narrow column. '.repeat(12)
  await input.fill(wrapped)
  await page.waitForTimeout(100)
  assert.ok(await input.isVisible())
  assert.ok(await input.evaluate((element) => document.activeElement === element))
  assert.equal((await input.boundingBox()).height, 72)
  assert.ok(await input.evaluate((element) => element.scrollHeight > element.clientHeight))
  await input.press('End')
  await input.press('Shift+Enter')
  await input.press('x')
  assert.equal(await input.inputValue(), `${wrapped}\nx`, 'multiline keyboard editing stays usable')
  await history.hover()
  await page.mouse.wheel(0, -160)
  await conversation.getByText('Reading history', { exact: true }).waitFor()
  assert.equal(await composer.isVisible(), false, 'intentional history scrolling still works')
  await conversation.getByRole('button', { name: '↓ Jump to live', exact: true }).click()
  await input.waitFor()
  assert.equal(await input.inputValue(), `${wrapped}\nx`, 'reading retains the multiline draft')
  await input.press('ControlOrMeta+A')
  await input.press('Backspace')
  assert.equal(await input.inputValue(), '', 'the draft can be cleared with the keyboard')
  await input.fill('A multiline draft\nthat can still be sent\nafter the composer grows.')
  const sentBefore = await page.evaluate(
    () => window.proof.calls.filter(([name]) => name === 'send').length,
  )
  await input.press('Enter')
  await page.waitForFunction(
    (before) => window.proof.calls.filter(([name]) => name === 'send').length > before,
    sentBefore,
  )
  assert.equal(await input.inputValue(), '', 'Enter sends and clears the multiline draft')
  assert.ok(
    await history.evaluate(
      (element) => element.scrollHeight - element.scrollTop - element.clientHeight < 24,
    ),
  )
  console.log(
    'PASS: multiline smart-thread drafts keep a stable visible composer, focus, live position, keyboard clearing and Enter sending.',
  )
}
