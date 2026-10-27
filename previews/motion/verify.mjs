/* global document, innerWidth */
import { chromium, previewUrl, outputPath } from './runtime.mjs'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1050, height: 900 },
    deviceScaleFactor: 2,
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${previewUrl}/`)
  await page.waitForFunction(() =>
    document.querySelector('#renderer').textContent.includes('Live preview'),
  )
  await page.locator('#position').fill('0.83')
  await page.screenshot({ path: outputPath('preview.png'), fullPage: true })
  assert.equal(await page.locator('#pause').textContent(), 'Play')
  const frame = () => page.locator('#after').screenshot()
  const original = await frame()
  await page.locator('#position').fill('1.25')
  assert(!(await frame()).equals(original), 'Scrubbing should change the rendered light')
  await page.locator('#reduced').check()
  assert(await page.locator('#position').isDisabled())
  const still = await frame()
  await page.locator('#pause').click()
  await page.waitForTimeout(300)
  assert((await frame()).equals(still), 'Reduced motion should remain still')
  assert.deepEqual(errors, [])
  await page.setViewportSize({ width: 390, height: 900 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  console.log(
    'PASS: WebGL preview, sweep scrubbing, pause/play, reduced motion, narrow layout; no browser errors',
  )
} finally {
  await browser.close()
}
