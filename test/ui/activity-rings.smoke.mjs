/* global window, getComputedStyle */
import assert from 'node:assert/strict'

export async function checkActivityRings(page, capture) {
  const initial = await page.evaluate(async () => ({
    settings: await window.threadlight.getSettings(),
    snapshot: await window.threadlight.getSnapshot(),
  }))
  try {
    await windowSetup()
    const patch = (state, thinking, contextUsed = 0.65, attention = null) =>
      page.evaluate(
        ({ state, thinking, contextUsed, attention }) => {
          const snapshot = window.proof.ringSnapshot
          window.proof.emit('onSnapshot', {
            ...snapshot,
            sessions: snapshot.sessions.map((session) => ({
              ...session,
              state,
              thinking,
              contextUsed,
              attention,
              lastAction: thinking ? null : 'Synthetic tool activity',
            })),
          })
        },
        { state, thinking, contextUsed, attention },
      )
    const ring = (provider) =>
      page
        .locator(`[data-session-id][data-provider="${provider}"] [class*="_contextRing_"]`)
        .first()
    const geometry = (provider) =>
      ring(provider)
        .locator('circle[data-level]')
        .evaluate((arc) => ({
          level: arc.dataset.level,
          length: arc.getAttribute('stroke-dasharray'),
          offset: arc.getAttribute('stroke-dashoffset'),
          colour: getComputedStyle(arc).stroke,
        }))
    await patch('idle', false)
    await ring('claude').waitFor()
    const baseline = await geometry('claude')
    for (const thinking of [true, false]) {
      await patch('working', thinking)
      for (const provider of ['claude', 'codex']) {
        assert.equal(await ring(provider).getAttribute('data-active'), 'true')
        assert.notEqual(
          await ring(provider).evaluate((el) => getComputedStyle(el).animationName),
          'none',
        )
        assert.deepEqual(
          await geometry(provider),
          baseline,
          'activity does not change context progress or colour',
        )
      }
      assert.equal(
        await page.locator('[class*="_stateDot_"][data-state="working"]').count(),
        0,
        'no red working dot remains',
      )
    }
    await capture('activity-rings-tool-progress')
    await patch('waiting', false, 0.65, {
      kind: 'approval',
      action: 'Synthetic approval',
      tool: null,
      answerableUntil: null,
    })
    for (const provider of ['claude', 'codex']) {
      assert.equal(await ring(provider).getAttribute('data-active'), null)
      assert.equal(
        await ring(provider).evaluate((el) => getComputedStyle(el).animationName),
        'none',
      )
    }
    assert.equal(
      await page.locator('[class*="_stateDot_"][data-attention]').count(),
      2,
      'amber attention markers remain',
    )
    await patch('idle', true)
    for (const provider of ['claude', 'codex']) {
      assert.equal(await ring(provider).getAttribute('data-active'), null)
      assert.equal(
        await ring(provider).evaluate((el) => getComputedStyle(el).animationName),
        'none',
      )
      assert.deepEqual(await geometry(provider), baseline)
    }
    await patch('working', false, null)
    assert.equal(
      await ring('claude').locator('circle[data-level]').count(),
      0,
      'unknown context never invents a percentage',
    )
    assert.equal(await ring('claude').locator('[data-unknown]').count(), 1)
    assert.equal(await ring('claude').getAttribute('data-active'), 'true')
    await patch('idle', false, null)
    assert.equal(await page.locator('[class*="_contextRing_"]').count(), 0)
    await patch('working', false)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await ring('claude').evaluate((el) => getComputedStyle(el).animationName), 'none')
    assert.deepEqual(await geometry('claude'), baseline)
    console.log(
      'PASS: Claude/Codex context rings animate during all working phases, stop on idle/waiting, preserve measured fill/colour and reduced motion, and replace the red dot.',
    )
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(async ({ settings, snapshot }) => {
      await window.threadlight.updateSettings(settings)
      window.proof.emit('onSnapshot', snapshot)
    }, initial)
  }

  async function windowSetup() {
    await page.evaluate(async () => {
      await window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        listMode: 'recent',
      })
      window.proof.ringSnapshot = await window.threadlight.getSnapshot()
    })
    await page.locator('header [data-thread-view]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Recent', exact: true }).click()
  }
}
