/* global document */
import { chromium, previewUrl, outputPath } from './runtime.mjs'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1260, height: 1050 },
    deviceScaleFactor: 2,
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${previewUrl}/needs-input.html`)
  await page.waitForFunction(() => document.querySelector('#desktop').dataset.impact)
  for (const provider of ['claude', 'codex']) {
    await page.locator('#provider').selectOption(provider)
    for (const pose of ['pool', 'release', 'impact']) {
      await page.locator('#' + pose).click()
      const channels = await page.locator('#liquid').evaluate((canvas) => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let red = 0,
          blue = 0,
          alpha = 0
        for (let i = 0; i < pixels.length; i += 4) {
          red += pixels[i] * pixels[i + 3]
          blue += pixels[i + 2] * pixels[i + 3]
          alpha += pixels[i + 3]
        }
        return { red, blue, alpha }
      })
      assert(channels.alpha > 0)
      assert(
        provider === 'codex'
          ? channels.blue > channels.red * 1.2
          : channels.red > channels.blue * 1.2,
        `${provider} ${pose} should use its provider palette`,
      )
      if (pose !== 'pool')
        await page.screenshot({ path: outputPath(`${provider}-${pose}.png`), fullPage: true })
    }
  }
  const time = await page.locator('#time').textContent()
  const angle = await page.locator('#desktop').getAttribute('data-angle')
  await page.locator('#provider').selectOption('claude')
  assert.equal(
    await page.locator('#time').textContent(),
    time,
    'Colour switch should preserve paused position',
  )
  assert.equal(await page.locator('#desktop').getAttribute('data-angle'), angle)
  await page.locator('#provider').selectOption('codex')
  await page.locator('#scenario').selectOption('recent')
  assert((await page.locator('#desktop-status').textContent()).includes('Codex Recent'))
  await page.locator('#size').selectOption('22')
  await page.locator('#release').click()
  await page.locator('#reduced').check()
  assert(await page.locator('#wheel').isVisible())
  assert.equal(await page.locator('#desktop').getAttribute('data-provider'), 'codex')
  await page.locator('#scenario').selectOption('open')
  assert(await page.locator('#wheel').isHidden())
  assert(await page.locator('#liquid').isHidden())
  assert.deepEqual(errors, [])
  console.log(
    'PASS: both palettes cover pool/release/splash, preserve timing, label the provider, work at 22 px and with reduced motion; no browser errors',
  )
} finally {
  await browser.close()
}
