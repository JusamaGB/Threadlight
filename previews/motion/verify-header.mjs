/* global window, document, innerWidth */
import assert from 'node:assert/strict'
import { chromium, previewUrl, outputPath } from './runtime.mjs'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 740, height: 680 },
    deviceScaleFactor: 2,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${previewUrl}/connected-header.html`)
  await page.locator('.motion[data-renderer]').waitFor()
  for (const progress of [0, 0.2, 0.45, 0.7, 1]) {
    await page.evaluate((value) => window.headerMotionPreview.seek(value, 2), progress)
    assert.equal(await page.locator('.motion canvas').count(), 1)
    await page.locator('.panel').screenshot({ path: outputPath(`header-morph-${progress}.png`) })
  }
  const first = await page.locator('canvas').screenshot()
  await page.evaluate(() => window.headerMotionPreview.seek(1, 6))
  assert.notDeepEqual(
    await page.locator('canvas').screenshot(),
    first,
    'colours evolve between frames',
  )
  await page.getByLabel('Reduced motion').check()
  const reduced = await page.locator('canvas').screenshot()
  await page.evaluate(() => window.headerMotionPreview.seek(1, 9))
  assert.deepEqual(
    await page.locator('canvas').screenshot(),
    reduced,
    'reduced motion remains still',
  )
  await page.getByLabel('Reduced motion').uncheck()
  await page.getByRole('button', { name: 'Working wheel', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Thinking' }).waitFor()
  await page.getByRole('button', { name: 'Speaking waveform', exact: true }).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: outputPath('connected-header-preview.png'), fullPage: true })
  await page.setViewportSize({ width: 360, height: 700 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log(
    'PASS: connected header preview, five morph poses, evolving colours, reduced motion, controls and narrow layout.',
  )
} finally {
  await browser.close()
}
