/* global document, innerWidth */
import { chromium, previewUrl, outputPath } from './runtime.mjs'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1100 },
    deviceScaleFactor: 2,
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${previewUrl}/header-wire.html`)
  await page.waitForFunction(() => document.body.dataset.eventTime)
  const control = page.locator('#refined-loop')
  const box = await control.boundingBox()
  assert.equal(box.width, 16)
  assert.equal(box.height, 24)
  await page.locator('#inspect-pulse').click()
  assert.equal(await page.locator('#enlarged-loop .conductor').getAttribute('stroke'), '#aacfd6')
  assert.equal(
    await page.locator('#cut-enlarged-loop .conductor').getAttribute('stroke'),
    '#737b86',
  )
  assert.equal(await page.locator('#cut-enlarged-loop .live-halo').getAttribute('opacity'), '0')
  assert(
    await page
      .locator('#enlarged-loop')
      .evaluate(
        (el) =>
          new Set(
            [...el.querySelectorAll('.travelling-core path')].map((p) => p.getAttribute('opacity')),
          ).size > 10,
      ),
  )
  assert(
    await page
      .locator('#enlarged-loop')
      .evaluate((el) =>
        [...el.querySelectorAll('filter')].every(
          (f) => f.getAttribute('filterUnits') === 'userSpaceOnUse',
        ),
      ),
  )
  await page.screenshot({ path: outputPath('wire-connected.png'), fullPage: true })
  const phase = await control.getAttribute('data-phase')
  await control.click()
  assert.equal(await control.getAttribute('data-phase'), phase, 'Cut must preserve pulse clock')
  assert.equal(await control.getAttribute('aria-pressed'), 'false')
  assert(await page.locator('#refined-panel .rails').isHidden())
  assert.equal(
    Number(await control.getAttribute('data-spark')),
    0,
    'No unsolicited spark at the click time',
  )
  await page.locator('#inspect-spark').click()
  assert(Number(await control.getAttribute('data-spark')) > 0.2)
  assert(Number(await page.locator('#cut-enlarged-loop').getAttribute('data-spark')) > 0.2)
  assert.equal(await page.locator('#enlarged-loop').getAttribute('aria-pressed'), 'true')
  await page.screenshot({ path: outputPath('wire-spark.png'), fullPage: true })
  const firstSeed = await page.locator('body').getAttribute('data-event-seed')
  const firstArc = await page.locator('#cut-enlarged-loop .arc-core').getAttribute('d')
  await page.waitForTimeout(100)
  assert.equal(
    await page.locator('#cut-enlarged-loop .arc-core').getAttribute('d'),
    firstArc,
    'Paused randomness must stay stable',
  )
  await page.locator('#variation').click()
  assert.notEqual(await page.locator('body').getAttribute('data-event-seed'), firstSeed)
  assert.notEqual(
    await page.locator('#cut-enlarged-loop .arc-core').getAttribute('d'),
    firstArc,
    'Each discharge gets a fresh arc',
  )
  const nextSeed = await page.locator('body').getAttribute('data-event-seed')
  await page.locator('#pause').click()
  await page.waitForFunction((seed) => document.body.dataset.eventSeed !== seed, nextSeed, {
    timeout: 6500,
  })
  await page.locator('#inspect-spark').click()
  assert.equal(
    await page.locator('#cut-enlarged-loop').getAttribute('data-phase'),
    await control.getAttribute('data-phase'),
    'Cut and connected demos share the generative event',
  )
  const cutPhase = await control.getAttribute('data-phase')
  await control.focus()
  await page.keyboard.press('Enter')
  assert.equal(await control.getAttribute('aria-pressed'), 'true')
  assert.equal(
    await control.getAttribute('data-phase'),
    cutPhase,
    'Reconnect must preserve pulse clock',
  )
  assert(await page.locator('#refined-panel .rails').isVisible())
  await page.locator('#inspect-spark').click()
  await page.locator('#reduced').check()
  const staticFrame = await page.locator('.detail-grid').screenshot()
  await page.waitForTimeout(250)
  assert((await page.locator('.detail-grid').screenshot()).equals(staticFrame))
  assert(await page.locator('#pause').isDisabled())
  assert(await page.locator('#variation').isDisabled())
  await page.setViewportSize({ width: 390, height: 1100 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: outputPath('wire-narrow.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'PASS: generative event progression, varied arc geometry, stable paused randomness, synchronized arrivals, retained click target, keyboard action, reduced motion and narrow layout; no browser errors',
  )
} finally {
  await browser.close()
}
