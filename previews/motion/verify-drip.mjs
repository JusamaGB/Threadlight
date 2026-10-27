/* global document, innerWidth */
import { chromium, previewUrl, outputPath } from './runtime.mjs'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const js = ts.transpileModule(readFileSync(new URL('./drip-physics.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const physics = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const {
  SWEEP,
  HOLD,
  HOLD_START,
  RELEASE,
  CYCLE,
  GRAVITY,
  RELEASE_SPEED,
  wheelAngle,
  flightDuration,
  airborne,
  dropletSeeds,
  splashParticle,
} = physics
const near = (a, b, tolerance = 1e-7) => assert(Math.abs(a - b) < tolerance, `${a} != ${b}`)
near(HOLD, 0.25)
for (let t = HOLD_START; t < HOLD_START + HOLD; t += 0.001)
  near(wheelAngle(t), wheelAngle(HOLD_START))
near(wheelAngle(CYCLE) - wheelAngle(0), Math.PI * 2)
for (const join of [HOLD_START - 0.22, HOLD_START, HOLD_START + HOLD, HOLD_START + HOLD + 0.2])
  near(wheelAngle(join - 1e-7), wheelAngle(join + 1e-7), 1e-5)
assert(RELEASE > HOLD_START && RELEASE < HOLD_START + HOLD)
near(RELEASE / 1.35 - 0.12, 1)
near(RELEASE, SWEEP)
for (const diameter of [22, 44]) {
  for (let time = 0.1; time <= 1.08; time += 0.01) {
    const pool = physics.pooledDrop(time, diameter)
    assert(
      pool.y + pool.radius * pool.stretch < diameter * 0.365,
      'Initial pool must stay inside the logo',
    )
  }
  const final = physics.pooledDrop(RELEASE, diameter)
  near(final.drain, 1)
  near(final.radius, diameter * 0.195)
  assert(
    final.y - final.radius * final.stretch > diameter * 0.365,
    'Body should emerge fully before separation',
  )
}
for (const distance of [20, 160, 350, 900]) {
  const duration = flightDuration(distance)
  near(airborne(duration, 0).y, distance)
  const v = RELEASE_SPEED + GRAVITY * duration
  for (const seed of dropletSeeds(5, v))
    for (let age = 0; age < 1.2; age += 0.002) {
      const p = splashParticle(age, seed, 500)
      if (p) assert(p.y <= 500 + 1e-8 && p.alpha >= 0 && p.alpha <= 1)
    }
  const energy = dropletSeeds(5, v).reduce(
    (sum, s) => sum + (s.radius / 5) ** 3 * (s.vx ** 2 + s.vy ** 2),
    0,
  )
  assert(energy < v * v, 'Splash cannot gain energy')
}
console.log(
  'PASS physics: exact 250 ms stop, continuous rotation, release within hold, ballistic contact, bounded splash energy, no floor penetration',
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1260, height: 1000 },
    deviceScaleFactor: 2,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${previewUrl}/needs-input.html`)
  await page.waitForFunction(() => document.querySelector('#desktop').dataset.impact)
  async function shot(time, name) {
    await page.locator('#timeline').fill(String(Number(time.toFixed(3))))
    await page.screenshot({ path: outputPath(`${name}.png`), fullPage: true })
  }
  await shot(0.95, 'drip-fill')
  await page.locator('#pool').click()
  assert.equal(await page.locator('#desktop').getAttribute('data-phase'), 'gather')
  await shot(1.25, 'drip-emerging')
  await shot(RELEASE - 0.02, 'drip-neck')
  const angle = await page.locator('#desktop').getAttribute('data-angle')
  await page.locator('#timeline').fill(String(Number((RELEASE + 0.06).toFixed(3))))
  assert.equal(await page.locator('#desktop').getAttribute('data-angle'), angle)
  await shot(RELEASE + 0.35, 'drip-fall')
  await page.locator('#impact').click()
  await page.screenshot({ path: outputPath('drip-splash.png'), fullPage: true })
  assert.equal(await page.locator('#desktop').getAttribute('data-phase'), 'splash')
  await page.locator('#scenario').selectOption('recent')
  assert.equal(await page.locator('#desktop').getAttribute('data-dripping'), 'true')
  await page.locator('#scenario').selectOption('clear')
  assert.equal(await page.locator('#desktop').getAttribute('data-dripping'), 'false')
  assert(await page.locator('#impact').isDisabled())
  assert(
    await page.locator('#liquid').evaluate(
      (c) =>
        !c
          .getContext('2d')
          .getImageData(0, 0, c.width, c.height)
          .data.some((v, i) => i % 4 === 3 && v > 0),
    ),
  )
  await page.locator('#scenario').selectOption('open')
  assert(await page.locator('#wheel').isHidden())
  assert(await page.locator('#liquid').isHidden())
  await page.locator('#scenario').selectOption('active')
  await page.locator('#size').selectOption('22')
  await page.locator('#impact').click()
  await page.screenshot({ path: outputPath('drip-actual.png'), fullPage: true })
  await page.locator('#reduced').check()
  const still = await page.locator('#desktop').screenshot()
  await page.waitForTimeout(250)
  assert((await page.locator('#desktop').screenshot()).equals(still))
  assert(await page.locator('#timeline').isDisabled())
  await page.setViewportSize({ width: 390, height: 950 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.locator('#reduced').uncheck()
  await page.locator('#impact').click()
  await page.screenshot({ path: outputPath('drip-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'PASS browser: stop, release, impact, minimised Active/Recent trigger, cleared status cancels liquid, opening app hides overlay, actual size, reduced motion, narrow layout; no browser errors',
  )
} finally {
  await browser.close()
}
