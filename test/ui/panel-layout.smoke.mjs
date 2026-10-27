/* global window, document */
import assert from 'node:assert/strict'

const stage = (page) => page.locator('#root > div').first()
const cardWidth = (page) =>
  page.evaluate(() =>
    Math.round(document.querySelector('[data-card]').getBoundingClientRect().width),
  )

/** Right-click the wire clip: Dual view widens the panel; Single view narrows it again. */
export async function checkPanelLayout(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const clip = page.getByRole('button', { name: /workspace wires$/ })
  try {
    // With only one provider there is nothing to put side by side, so there is no menu.
    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude'], panelLayout: 'single' }),
    )
    await clip.click({ button: 'right' })
    assert.equal(await page.getByRole('menu', { name: 'Panel layout' }).count(), 0)

    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
    )
    assert.equal(await cardWidth(page), 238, 'single view is the narrow column')
    assert.equal(await stage(page).getAttribute('data-wide'), null)

    await clip.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Panel layout' })
    await menu.waitFor()
    assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), ['Dual view'])
    await capture('panel-layout-menu')
    await menu.getByRole('menuitem', { name: 'Dual view' }).click()
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).panelLayout),
      'dual',
      'the choice is saved',
    )
    await page.waitForFunction(() => window.proof.layouts?.at(-1) === 'dual')
    assert.equal(await stage(page).getAttribute('data-wide'), 'true', 'the window widens first')
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 480,
    )
    assert.equal(await stage(page).getAttribute('data-dual'), 'true')
    await capture('panel-layout-dual')

    await clip.click({ button: 'right' })
    const back = page.getByRole('menu', { name: 'Panel layout' })
    assert.deepEqual(await back.getByRole('menuitem').allInnerTexts(), ['Single view'])
    await back.getByRole('menuitem', { name: 'Single view' }).click()
    await page.waitForFunction(() => window.proof.layouts?.at(-1) === 'single')
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 238,
    )
    assert.equal(await stage(page).getAttribute('data-wide'), null, 'the window narrows last')

    // A saved dual layout is applied at once when the panel loads, without animating.
    await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'dual' }))
    await page.reload()
    await page.waitForFunction(
      () =>
        Math.round(document.querySelector('[data-card]')?.getBoundingClientRect().width) === 480,
    )
    // Turning a provider off drops back to one column without forgetting the choice.
    await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['codex'] }))
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 238,
    )
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).panelLayout),
      'dual',
    )
    console.log(
      'PASS: wire-clip right-click menu, single/dual choice saved, widen-then-grow and narrow-then-shrink order, instant restore on load, and one-provider fallback.',
    )
  } finally {
    await page.evaluate((settings) => window.threadlight.updateSettings(settings), {
      enabledProviders: initial.enabledProviders,
      panelLayout: initial.panelLayout,
    })
  }
}
