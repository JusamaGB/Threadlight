import { selectThreadView } from './header-navigation.mjs'
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
    // Reasoning can resume repeatedly between tools/replies within the same task.
    for (const thinking of [true, false, true, false, true]) {
      await patch('working', thinking)
      for (const provider of ['claude', 'codex']) {
        assert.equal(await ring(provider).getAttribute('data-active'), 'true')
        assert.equal(await ring(provider).getAttribute('data-thinking'), thinking ? 'true' : null)
        assert.equal(await ring(provider).locator('g[mask]').count(), thinking ? 1 : 0)
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
    const maskIds = await Promise.all(
      ['claude', 'codex'].map((provider) => ring(provider).locator('mask').getAttribute('id')),
    )
    assert.equal(new Set(maskIds).size, 2, 'each thread owns its thinking mask')
    await capture('activity-rings-mid-task-thinking')
    await patch('working', true, 0.85)
    for (const provider of ['claude', 'codex']) {
      assert.equal(
        await ring(provider).locator('circle[data-level]').getAttribute('data-level'),
        'red',
      )
      const fill = await geometry(provider)
      assert.ok(
        Math.abs(Number(fill.offset) / Number(fill.length) - 0.15) < 0.00001,
        'thinking still displays live context progress',
      )
    }
    await patch('working', false)
    await capture('activity-rings-tool-progress')
    await patch('waiting', false, 0.65, {
      kind: 'approval',
      action: 'Synthetic approval',
      tool: null,
      answerableUntil: null,
    })
    for (const provider of ['claude', 'codex']) {
      assert.equal(await ring(provider).getAttribute('data-active'), null)
      assert.equal(await ring(provider).getAttribute('data-thinking'), null)
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
        await ring(provider).locator('g[mask]').count(),
        0,
        'stale thinking on idle never changes the wheel',
      )
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
      'PASS: Claude/Codex wheels become dotted for repeated mid-task thinking, keep spinning through active work, stop on idle/waiting, and preserve live context fill/colour and reduced motion.',
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
    await selectThreadView(page, 'recent')
  }
}
