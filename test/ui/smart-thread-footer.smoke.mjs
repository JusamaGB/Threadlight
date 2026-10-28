/* global window */
import assert from 'node:assert/strict'

/** Model Electron's content-sized window, rather than a fixed-height browser viewport. */
export async function checkSmartThreadFooter(page, conversation, history, composer, capture) {
  const viewport = page.viewportSize()
  const card = page.locator('[data-card]')
  const body = conversation.locator('[class*="_body_"]')
  const footer = page.locator('[data-hover-footer]')
  const tip = page.locator('[data-hover-message] [role="tooltip"]')
  const fitWindow = async () => {
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(30)
      const height = await page.evaluate(() => Math.ceil(window.proof.resizes.at(-1)))
      assert.ok(height > 0 && height <= 800)
      if (page.viewportSize().height === height) return
      await page.setViewportSize({ width: viewport.width, height })
    }
    assert.fail('native window must settle without a viewport/content resize loop')
  }
  const metrics = async () => ({
    card: await card.boundingBox(),
    header: await page.locator('header[aria-label="Panel header"]').boundingBox(),
    thread: await conversation.boundingBox(),
    body: await body.boundingBox(),
    history: await history.boundingBox(),
    composer: (await composer.count()) ? await composer.boundingBox() : null,
    scroll: await history.evaluate((element) => element.scrollTop),
  })
  const unchanged = (before, after) => {
    for (const key of ['header', 'thread', 'body', 'history', 'composer']) {
      if (before[key] === null) {
        assert.equal(after[key], null)
        continue
      }
      for (const dimension of ['x', 'y', 'width', 'height'])
        assert.ok(
          Math.abs(after[key][dimension] - before[key][dimension]) < 1,
          `${key}.${dimension} moves while only the info footer changes`,
        )
    }
    assert.equal(after.scroll, before.scroll, 'reading position stays fixed')
    assert.equal(after.card.y, before.card.y, 'the panel top stays anchored')
  }
  try {
    await page.mouse.move(viewport.width - 1, 5)
    await page.waitForTimeout(250)
    const originalHeight = (await body.boundingBox()).height
    await fitWindow()
    assert.equal(
      (await body.boundingBox()).height,
      originalHeight,
      'fitting the native window must not change the smart thread height',
    )
    for (const reading of [false, true]) {
      if (reading) {
        await history.evaluate((element) => {
          element.scrollTop = 100
          element.dispatchEvent(new Event('scroll'))
        })
        await conversation.getByText('Reading history', { exact: true }).waitFor()
        await fitWindow()
      }
      const before = await metrics()
      const firstResize = await page.evaluate(() => window.proof.resizes.length)
      await page.getByLabel(reading ? /^Codex · Weekly limit/ : /^Claude · 5-hour limit/).hover()
      await tip.waitFor()
      await page.waitForTimeout(250)
      await fitWindow()
      const opened = await metrics()
      unchanged(before, opened)
      const footerHeight = (await footer.boundingBox()).height
      assert.ok(footerHeight > 0)
      assert.ok(
        Math.abs(opened.card.height - before.card.height - footerHeight) < 1,
        'only the footer adds height below the existing content',
      )
      const requests = await page.evaluate(
        (start) => window.proof.resizes.slice(start),
        firstResize,
      )
      assert.ok(
        requests.every((height) => height <= Math.ceil(opened.card.height) + 1),
        'footer animation does not feed extra growth back into the native window',
      )
      await capture(reading ? 'smart-thread-info-reading' : 'smart-thread-info-live')
      await page.locator('header').hover({ position: { x: 2, y: 2 } })
      await tip.waitFor({ state: 'detached' })
      await page.waitForTimeout(250)
      await fitWindow()
      const closed = await metrics()
      unchanged(before, closed)
      assert.ok(Math.abs(closed.card.height - before.card.height) < 1)
    }
    await conversation.getByRole('button', { name: '↓ Jump to live', exact: true }).click()
    await composer.waitFor()
    console.log(
      'PASS: content-sized smart thread keeps its geometry, composer and scroll position while the info footer alone expands/collapses below it',
    )
  } finally {
    await page.mouse.move(viewport.width - 1, 5)
    await page.setViewportSize(viewport)
  }
}
