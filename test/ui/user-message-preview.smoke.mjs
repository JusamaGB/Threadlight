/* global window */
import assert from 'node:assert/strict'

export async function checkUserMessagePreview(page, conversation, composer, capture) {
  const message = conversation.locator('article[data-role="user"]').last()
  const disclosure = message.locator('[data-user-message]')
  const summary = disclosure.locator('summary')
  const text = summary.locator('span')
  const initial = await text.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      space: style.whiteSpace,
      fade: style.maskImage,
      overflowing: element.scrollWidth > element.clientWidth,
    }
  })
  assert.equal(initial.space, 'nowrap')
  assert.ok(Math.abs(initial.height - initial.lineHeight) < 1, 'sent messages start on one line')
  assert.match(initial.fade, /linear-gradient/)
  assert.equal(initial.overflowing, true, 'long text is clipped inside its preview')
  assert.equal(await disclosure.getAttribute('open'), null)
  await summary.click()
  assert.equal(await disclosure.getAttribute('open'), '')
  const expanded = await text.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    space: window.getComputedStyle(element).whiteSpace,
    fade: window.getComputedStyle(element).maskImage,
  }))
  assert.equal(expanded.space, 'pre-wrap')
  assert.equal(expanded.fade, 'none')
  assert.ok(expanded.height >= initial.height * 2 - 1, 'expanded messages wrap onto multiple lines')
  await conversation.getByText('Reading history', { exact: true }).waitFor()
  assert.equal(await composer.isVisible(), false)
  await capture('user-message-expanded')
  await page.evaluate(() => window.proof.timelineUpdate({}))
  assert.equal(
    await disclosure.getAttribute('open'),
    '',
    'live refreshes retain the expanded message',
  )
  await summary.focus()
  await summary.press('Enter')
  await page.waitForFunction(() => {
    const last = [...window.document.querySelectorAll('[data-user-message]')].at(-1)
    return last && !last.hasAttribute('open')
  })
  assert.equal(
    await text.evaluate((element) => window.getComputedStyle(element).whiteSpace),
    'nowrap',
  )
  await capture('user-message-collapsed')
  await summary.press('Space')
  assert.equal(await disclosure.getAttribute('open'), '')
  await summary.click()
  assert.equal(await disclosure.getAttribute('open'), null)
  await conversation
    .getByRole('region', { name: 'Conversation history', exact: true })
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new window.Event('scroll'))
    })
  await composer.waitFor()
  console.log(
    'PASS: sent messages start as faded single lines, expand/collapse with click or keyboard, and remain readable across live refreshes',
  )
}
