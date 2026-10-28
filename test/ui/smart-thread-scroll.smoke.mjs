/* global window */
import assert from 'node:assert/strict'

export async function checkSmartThreadScroll(page, conversation, history, composer) {
  const list = page.locator('[class*="_list_"]').first()
  const saved = await list.evaluate((element) => ({
    style: element.getAttribute('style'),
    top: element.scrollTop,
  }))
  await list.evaluate((element) => {
    element.style.setProperty('height', '230px', 'important')
    element.style.setProperty('max-height', '230px', 'important')
    element.scrollTop = 0
  })
  const setHistory = async (position) => {
    await history.evaluate((element, position) => {
      element.scrollTop = position === 'bottom' ? element.scrollHeight : position
      element.dispatchEvent(new Event('scroll'))
    }, position)
    await page.waitForTimeout(60)
  }
  const wheel = async (target, delta) => {
    const inner = await target.boundingBox(),
      outer = await list.boundingBox()
    const top = Math.max(inner.y, outer.y),
      bottom = Math.min(inner.y + inner.height, outer.y + outer.height)
    assert.ok(bottom - top > 4, 'wheel target is visible inside the workspace list')
    await page.mouse.move(inner.x + inner.width / 2, (top + bottom) / 2)
    await page.mouse.wheel(0, delta)
    await page.waitForTimeout(80)
  }
  const top = () => list.evaluate((element) => element.scrollTop)
  try {
    assert.ok(
      await list.evaluate((element) => element.scrollHeight > element.clientHeight + 50),
      'the outer list must be able to scroll',
    )
    await setHistory('bottom')
    await list.evaluate((element) => (element.scrollTop = 0))
    await wheel(history, 160)
    assert.equal(await top(), 0, 'mouse-wheel steps at the bottom stay in the smart thread')
    await wheel(history, 8)
    assert.equal(await top(), 0, 'small touchpad steps at the bottom stay in the smart thread')
    await setHistory(0)
    await list.evaluate((element) => (element.scrollTop = 40))
    const beforeUp = await top()
    await wheel(history, -160)
    assert.equal(
      await top(),
      beforeUp,
      'scrolling above the first message never moves the workspace',
    )
    await setHistory(40)
    await list.evaluate((element) => (element.scrollTop = 0))
    const beforeInner = await history.evaluate((element) => element.scrollTop)
    await wheel(history, 160)
    assert.ok(
      (await history.evaluate((element) => element.scrollTop)) > beforeInner,
      'history still scrolls normally',
    )
    assert.equal(await top(), 0)
    await setHistory('bottom')
    await list.evaluate(
      (element) => (element.scrollTop = element.scrollHeight - element.clientHeight - 15),
    )
    const beforeComposer = await top()
    await wheel(composer, 160)
    assert.equal(await top(), beforeComposer, 'the composer is also inside the scroll boundary')
    await list.evaluate((element) => (element.scrollTop = 0))
    const header = list.getByRole('button', { name: /Synthetic Codex/ }).first()
    await wheel(header, 160)
    assert.ok((await top()) > 0, 'wheel input outside the smart thread still scrolls the list')
    await page.evaluate(() => {
      window.proof.scrollBoundaryTimeline = {
        items: window.proof.timeline.items,
        hasMore: window.proof.timeline.hasMore,
      }
      const message = window.proof.timeline.items.find((item) => item.role === 'assistant')
      window.proof.timelineUpdate({
        items: [{ ...message, text: 'Short conversation.' }],
        hasMore: false,
      })
    })
    await setHistory('bottom')
    await list.evaluate((element) => (element.scrollTop = 0))
    assert.ok(await history.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
    await wheel(history, 160)
    assert.equal(await top(), 0, 'a conversation too short to scroll still owns its wheel input')
    console.log(
      'PASS: smart-thread wheel boundaries at both ends, touchpad steps, short history, composer containment and normal outside scrolling.',
    )
  } finally {
    await page.evaluate(() => {
      if (window.proof.scrollBoundaryTimeline) {
        window.proof.timelineUpdate(window.proof.scrollBoundaryTimeline)
        delete window.proof.scrollBoundaryTimeline
      }
    })
    await setHistory('bottom')
    await list.evaluate((element, saved) => {
      if (saved.style === null) element.removeAttribute('style')
      else element.setAttribute('style', saved.style)
      element.scrollTop = saved.top
    }, saved)
  }
}
