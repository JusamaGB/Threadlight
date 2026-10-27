/* global document, requestAnimationFrame */
import { chromium, previewUrl } from './runtime.mjs'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } })
  await page.goto(`${previewUrl}/header-wire.html`)
  await page.locator('#inspect-pulse').click()
  const result = await page.evaluate(async () => {
    const { renderElectricity } = await import('/wire-electricity.ts')
    const svgs = [...document.querySelectorAll('.new svg')]
    const event = { interval: 1, travel: 0.13, strength: 1, decay: 0.18, seed: 251 }
    const costs = []
    for (let frame = 0; frame < 100; frame++) {
      const start = performance.now()
      for (let i = 0; i < svgs.length; i++)
        renderElectricity(svgs[i], i !== 2, (frame % 10) / 60, false, event)
      costs.push(performance.now() - start)
    }
    costs.sort((a, b) => a - b)
    const intervals = []
    await new Promise((resolve) => {
      let previous = 0,
        frame = 0
      function tick(now) {
        if (previous) intervals.push(now - previous)
        previous = now
        for (let i = 0; i < svgs.length; i++)
          renderElectricity(svgs[i], i !== 2, (frame % 20) / 60, false, event)
        if (++frame < 120) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    intervals.sort((a, b) => a - b)
    return {
      medianDrawMs: costs[50],
      p95DrawMs: costs[95],
      maxDrawMs: costs[99],
      medianFrameMs: intervals[59],
      p95FrameMs: intervals[113],
      framesOver24FpsBudget: intervals.filter((n) => n > 1000 / 24).length,
    }
  })
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
