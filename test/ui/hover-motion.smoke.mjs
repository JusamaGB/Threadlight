/* global window, document, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict'

export async function checkHoverMotion(page, capture) {
  const initial = await page.evaluate(async () => {
    window.proof.motionWorkspacePanel = window.threadlight.setWorkspacePanel
    return {
      settings: await window.threadlight.getSettings(),
      snapshot: await window.threadlight.getSnapshot(),
    }
  })
  const footer = page.locator('[data-hover-footer]')
  const tip = page.getByRole('tooltip')
  const sample = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const samples = [],
            start = performance.now()
          const frame = () => {
            const card = document.querySelector('[data-card]'),
              footer = document.querySelector('[data-hover-footer]')
            const bars = [...document.querySelectorAll('[class*="_usage_"]')]
            const live = document.querySelector('[data-hover-message] [role="tooltip"]')
            samples.push({
              height: card.getBoundingClientRect().height,
              footer: footer.getBoundingClientRect().height,
              top: bars[0].getBoundingClientRect().y,
              bottom: bars.at(-1).getBoundingClientRect().y,
              opacity: live ? Number(getComputedStyle(live).opacity) : null,
              ghost: footer.lastElementChild.children.length,
              tips: document.querySelectorAll('[role="tooltip"]').length,
            })
            if (performance.now() - start < 260) requestAnimationFrame(frame)
            else resolve(samples)
          }
          requestAnimationFrame(frame)
        }),
    )
  const varying = (samples, key) => new Set(samples.map((s) => Math.round(s[key] * 10))).size >= 3
  const choose = async (name) => {
    if (
      (await page.locator('[data-thread-view]').getAttribute('data-thread-view')) ===
      name.toLowerCase()
    )
      return
    await page.locator('[data-thread-view]').click({ button: 'right' })
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 280, height: 900 })
    await page.evaluate(() =>
      window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        hoverHelp: 'info',
        listMode: 'recent',
      }),
    )
    await choose('Recent')
    await page.locator('header').hover()
    const baseline = await page.locator('[data-card]').boundingBox()
    await page.getByLabel(/^Claude · 5-hour limit/).hover()
    const opening = await sample()
    assert.ok(varying(opening, 'height'), 'compact native card grows through intermediate heights')
    assert.ok(varying(opening, 'bottom'), 'lower bar flows downward')
    assert.ok(opening.at(-1).height > baseline.height)
    await page.getByLabel(/^Codex · Weekly limit/).hover()
    const replacement = await sample()
    assert.ok(
      replacement.some((s) => s.opacity < 0.9 && s.ghost),
      'old text fades out while the new text waits to fade in',
    )
    assert.ok(
      replacement.every((s) => s.tips === 1),
      'only the current hint is interactive',
    )
    assert.equal(replacement.at(-1).ghost, 0)
    assert.equal(replacement.at(-1).opacity, 1)
    assert.match(await tip.innerText(), /^Codex/)
    await capture('hover-motion-codex-settled')
    await page.locator('header').hover()
    const closing = await sample()
    assert.ok(varying(closing, 'height'), 'closing contracts through intermediate heights')
    assert.equal(closing.at(-1).height, baseline.height)
    assert.equal(closing.at(-1).footer, 0)
    assert.equal(closing.at(-1).ghost, 0)
    for (const provider of ['Claude', 'Codex', 'Claude', 'Codex'])
      await page.getByLabel(new RegExp(`^${provider} ·`)).hover()
    await sample()
    assert.equal(await tip.count(), 1)
    assert.match(await tip.innerText(), /^Codex/, 'rapid changes settle on the latest owner')
    await page.evaluate(() => window.threadlight.updateSettings({ hoverHelp: 'off' }))
    assert.equal(
      (await footer.boundingBox()).height,
      0,
      'Off clears the animated footer immediately',
    )
    assert.equal(await tip.count(), 0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => window.threadlight.updateSettings({ hoverHelp: 'info' }))
    await page.locator('header').hover()
    await page.getByLabel(/^Claude · 5-hour limit/).hover()
    await tip.waitFor()
    assert.equal(
      await footer.evaluate((e) => e.getAnimations({ subtree: true }).length),
      0,
      'reduced motion skips height and text animations',
    )
    await page.locator('header').hover()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(async () => {
      window.threadlight.setWorkspacePanel = async () => ({
        maxHeight: 300,
        opensDown: true,
        fresh: false,
      })
      await window.threadlight.updateSettings({ listMode: 'workspace', workspacePanelHeight: 300 })
      window.proof.emit('onSnapshot', await window.mockWorkspaceRows(40))
    })
    await choose('Workspace')
    await page.waitForFunction(
      () => document.querySelector('[data-card]').getBoundingClientRect().height === 300,
    )
    const bottom = await page.locator('[class*="_usage_"]').last().boundingBox()
    await page.getByLabel(/^Claude · 5-hour limit/).hover()
    const capped = await sample()
    assert.ok(varying(capped, 'top'), 'upper bar flows upward at the Workspace cap')
    assert.ok(
      capped.every((s) => s.height === 300 && s.bottom === bottom.y),
      'full panel and lower bar remain fixed throughout',
    )
    await capture('hover-motion-workspace-settled')
    console.log(
      'PASS: intermediate card/bar heights, fade-out-before-in, one interactive owner, rapid replacement, animated close, immediate Off, reduced motion and fixed Workspace bounds.',
    )
  } finally {
    await page.evaluate(async ({ settings, snapshot }) => {
      window.threadlight.setWorkspacePanel = window.proof.motionWorkspacePanel
      await window.mockWorkspaceRows(null)
      await window.threadlight.updateSettings(settings)
      window.proof.emit('onSnapshot', snapshot)
      window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: true })
    }, initial)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 460, height: 900 })
  }
}
