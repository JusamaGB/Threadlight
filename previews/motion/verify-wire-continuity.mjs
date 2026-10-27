/* global document, MutationObserver */
import { chromium, previewUrl } from './runtime.mjs'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`${previewUrl}/header-wire.html`)
  await page.locator('#inspect-pulse').click()
  const results = await page.evaluate(async () => {
    const { electricalMarkup, renderElectricity, advanceElectricalTime } =
      await import('/wire-electricity.ts')
    const results = []
    for (const fps of [24, 30, 60])
      for (const travel of [0.13, 0.24])
        for (const seed of [51, 251, 410]) {
          const host = document.createElement('div')
          host.innerHTML = electricalMarkup(`test-${fps}-${travel}-${seed}`)
          document.body.append(host)
          const svg = host.querySelector('svg'),
            segments = [...svg.querySelectorAll('.travelling-core path')]
          const observer = new MutationObserver(() => {})
          observer.observe(svg, { childList: true, subtree: true })
          const peaks = segments.map(() => 0),
            event = { interval: 1, travel, strength: 0.65, decay: 0.18, seed }
          let time = 0,
            frame = 0
          while (time < travel * 2) {
            renderElectricity(svg, true, time, false, event)
            segments.forEach(
              (p, i) => (peaks[i] = Math.max(peaks[i], Number(p.getAttribute('opacity')))),
            )
            time = advanceElectricalTime(time, frame++ === 2 ? 0.08 : 1 / fps, event)
          }
          results.push({
            fps,
            travel,
            seed,
            minCoverage: Math.min(...peaks),
            replacedNodes: observer.takeRecords().length,
            tailEnergy: Math.max(...segments.map((p) => Number(p.getAttribute('opacity')))),
          })
          observer.disconnect()
          host.remove()
        }
    return results
  })
  for (const r of results) {
    assert(r.minCoverage > 0.025, `Unlit section: ${JSON.stringify(r)}`)
    assert.equal(r.replacedNodes, 0, 'Animation must reuse SVG elements')
    assert(r.tailEnergy < 0.01, `Tail did not clear: ${JSON.stringify(r)}`)
  }
  console.log(
    `PASS: all 18 fast/slow pulse variations illuminate the entire wire at 24, 30 and 60 FPS, including an 80ms delayed frame; persistent SVG nodes and completed tails.`,
  )
} finally {
  await browser.close()
}
