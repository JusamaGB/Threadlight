/* global document */
import { chromium, previewUrl, outputPath } from './runtime.mjs'
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const source = ts.transpileModule(
  readFileSync(new URL('./drip-physics.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText
const p = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
for (let i = 0; i < 40; i++) {
  const eased = p.smoother(1 - i * Number.EPSILON)
  assert(
    eased >= 0 && eased <= 1 && Number.isFinite((1 - eased) ** 1.6),
    'Pinch easing must never create a NaN outline',
  )
}
for (const diameter of [22, 44]) {
  const eps = 1e-6
  const end = p.pooledDrop(p.RELEASE, diameter)
  const before = p.pooledDrop(p.RELEASE - eps, diameter)
  assert(
    Math.abs((end.y - before.y) / eps - p.RELEASE_SPEED) < 0.002,
    'Release velocity must carry into gravity',
  )
  assert(Math.abs(end.stretch - p.flightStretch(0)) < 1e-9)
  assert(
    Math.abs((end.stretch - before.stretch) / eps) < 0.001,
    'Shape must not snap at separation',
  )
  for (let t = 0.96; t < p.RELEASE; t += 0.01)
    assert(
      p.pooledDrop(t + eps, diameter).y > p.pooledDrop(t, diameter).y,
      'Sag must never stop or reverse',
    )
  for (const distance of [40, 350, 650]) {
    const contact = p.contactTime(distance, diameter * 0.195)
    assert(
      Math.abs(p.airborne(contact, 0).y + diameter * 0.195 * p.flightStretch(contact) - distance) <
        1e-6,
    )
  }
}
console.log(
  'PASS: continuous release velocity, shape and exact lower-surface contact; no mid-sag stall at 22/44 px',
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1260, height: 1000 },
    deviceScaleFactor: 2,
  })
  await page.goto(`${previewUrl}/needs-input.html`)
  await page.waitForFunction(() => document.querySelector('#desktop').dataset.impact)
  const result = await page.evaluate(
    ({ release, cycle }) => {
      const input = document.querySelector('#timeline')
      input.step = 'any'
      const liquid = document.querySelector('#liquid'),
        wheel = document.querySelector('#wheel')
      const ctx = liquid.getContext('2d'),
        stage = document.querySelector('#desktop')
      const impact = Number(stage.dataset.impact),
        scale = liquid.width / stage.clientWidth
      function seek(time) {
        input.value = String(time)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const metrics = []
      for (const [label, time] of [
        ['release', release],
        ['exact pinch', Number(release.toFixed(3))],
        ['impact', impact],
        ['cycle', cycle],
      ]) {
        seek(time - 1e-6)
        const a = ctx.getImageData(0, 0, liquid.width, liquid.height).data
        seek(time === cycle ? 0 : time + 1e-6)
        const b = ctx.getImageData(0, 0, liquid.width, liquid.height).data
        let delta = 0
        // Premultiplied RGB avoids counting irrelevant colours in transparent pixels.
        for (let i = 0; i < a.length; i += 4) {
          for (let c = 0; c < 3; c++)
            delta += Math.abs(a[i + c] * a[i + 3] - b[i + c] * b[i + 3]) / 255
          delta += Math.abs(a[i + 3] - b[i + 3])
        }
        metrics.push({ label, pixelEquivalent: delta / 1020 / (scale * scale) })
      }
      const sheet = document.createElement('canvas')
      sheet.width = 1000
      sheet.height = 660
      const out = sheet.getContext('2d')
      out.fillStyle = '#111c2b'
      out.fillRect(0, 0, 1000, 660)
      const groups = [
        [0.6, 0.9, 1.1, 1.3, release - 0.02],
        [release - 0.015, release, release + 0.015, release + 0.045, release + 0.09],
        [impact - 0.025, impact, impact + 0.025, impact + 0.05, impact + 0.075],
      ]
      const wr = wheel.getBoundingClientRect(),
        sr = stage.getBoundingClientRect()
      const cx = wr.left - sr.left - stage.clientLeft + wr.width / 2,
        cy = wr.top - sr.top - stage.clientTop + wr.height / 2
      const floor =
        document.querySelector('#taskbar').getBoundingClientRect().top - sr.top - stage.clientTop
      groups.forEach((times, row) =>
        times.forEach((time, column) => {
          seek(time)
          const x = column * 200,
            y = row * 220
          const left = cx - 45,
            top = row === 2 ? floor - 68 : cy - 30
          out.save()
          out.beginPath()
          out.rect(x, y + 30, 200, 180)
          out.clip()
          if (row === 2)
            out.drawImage(
              liquid,
              left * scale,
              top * scale,
              90 * scale,
              90 * scale,
              x,
              y + 30,
              180,
              180,
            )
          if (row !== 2)
            out.drawImage(
              wheel,
              x + (45 - wr.width / 2) * 2,
              y + 30 + (cy - top - wr.height / 2) * 2,
              wr.width * 2,
              wr.height * 2,
            )
          // Draw the liquid on top of the wheel, matching the actual overlay stack.
          if (row !== 2)
            out.drawImage(
              liquid,
              left * scale,
              top * scale,
              90 * scale,
              90 * scale,
              x,
              y + 30,
              180,
              180,
            )
          if (row === 2) {
            out.strokeStyle = '#60768b'
            out.beginPath()
            out.moveTo(x, y + 30 + 68 * 2)
            out.lineTo(x + 180, y + 30 + 68 * 2)
            out.stroke()
          }
          out.restore()
          out.fillStyle = '#dcc69e'
          out.font = '12px system-ui'
          out.fillText(
            `${['Fill / sag', 'Release', 'Impact'][row]}  ${time.toFixed(3)}s`,
            x + 10,
            y + 19,
          )
        }),
      )
      return { metrics, sheet: sheet.toDataURL() }
    },
    { release: p.RELEASE, cycle: p.CYCLE },
  )
  writeFileSync(
    outputPath('smoothness-filmstrip.png'),
    Buffer.from(result.sheet.split(',')[1], 'base64'),
  )
  console.log(JSON.stringify(result.metrics))
  for (const metric of result.metrics)
    assert(
      metric.pixelEquivalent < 3,
      `${metric.label} has a visible boundary jump: ${metric.pixelEquivalent} pixel equivalents`,
    )
  console.log('PASS: sub-frame render continuity at release, contact and loop seam')
} finally {
  await browser.close()
}
