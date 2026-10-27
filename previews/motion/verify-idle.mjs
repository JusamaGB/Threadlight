/* global document, innerWidth */
import { chromium, previewUrl, outputPath } from './runtime.mjs'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1050, height: 1000 },
    deviceScaleFactor: 2,
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${previewUrl}/idle.html`)
  await page.waitForFunction(() =>
    document.querySelector('#renderer').textContent.includes('Local preview'),
  )
  await page.locator('#position').fill('3.2')
  await page.screenshot({ path: outputPath('idle-preview.png'), fullPage: true })
  const bright = await page.locator('#after').screenshot()
  const original = await page.locator('#before').screenshot()
  await page.locator('#position').fill('0')
  assert(
    !(await page.locator('#after').screenshot()).equals(bright),
    'Breath changes the proposed light',
  )
  assert(
    (await page.locator('#before').screenshot()).equals(original),
    'Original idle remains static',
  )
  const dims = await page.locator('#afterDot').boundingBox()
  assert.equal(dims.width, 22)
  assert.equal(dims.height, 22)
  await page.locator('#reduced').check()
  const still = await page.locator('#after').screenshot()
  await page.waitForTimeout(200)
  assert((await page.locator('#after').screenshot()).equals(still))
  assert(await page.locator('#pause').isDisabled())
  await page.setViewportSize({ width: 390, height: 1000 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log(
    'PASS: breathing/paused/steady states, actual 22 px, narrow layout and no browser errors',
  )
} finally {
  await browser.close()
}
