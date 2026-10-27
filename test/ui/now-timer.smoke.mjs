/* global window */
import assert from 'node:assert/strict'

export async function checkNowTimer(page, row) {
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    window.proof.emit('onSnapshot', {
      ...snapshot,
      sessions: snapshot.sessions.map((session) =>
        session.provider === 'codex'
          ? {
              ...session,
              state: 'working',
              attention: null,
              thinking: true,
              lastAction: null,
              turnStartedAt: Date.now() - 162000,
            }
          : session,
      ),
    })
  })
  await row('Codex').click()
  const heading = row('Codex').locator('..').getByRole('heading', { name: /^Now/i })
  const timer = heading.locator('[class*="_elapsed_"]')
  await timer.waitFor()
  assert.match(await timer.innerText(), /^2m \d+s$/)
  assert.equal(await heading.locator('..').locator('p').innerText(), 'Thinking')
  const before = await timer.innerText()
  await page.clock.runFor(1000)
  assert.notEqual(await timer.innerText(), before, 'timer still advances beside NOW')
  await row('Codex').click()
  await page.evaluate(async () =>
    window.proof.emit('onSnapshot', await window.threadlight.getSnapshot()),
  )
  console.log('PASS: elapsed time sits beside NOW and ticks separately from the action.')
}
