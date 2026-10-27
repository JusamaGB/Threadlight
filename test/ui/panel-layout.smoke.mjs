/* global window, document */
import assert from 'node:assert/strict'

const stage = (page) => page.locator('#root > div').first()
const cardWidth = (page) =>
  page.evaluate(() =>
    Math.round(document.querySelector('[data-card]').getBoundingClientRect().width),
  )

/** Right-click a thread: Dual view widens the panel; Single view narrows it again. */
export async function checkPanelLayout(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const row = page.getByRole('button', { name: /Synthetic/ }).first()
  const threadMenu = async () => {
    await row.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await menu.waitFor()
    return menu
  }
  const showRecent = async () => {
    await page.locator('[data-thread-view]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Recent', exact: true }).click()
  }
  try {
    // With only one provider there is nothing to put side by side, so the thread menu has no
    // layout item.
    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude'], panelLayout: 'single' }),
    )
    await showRecent()
    const single = await threadMenu()
    assert.equal(await single.getByRole('menuitem', { name: /view$/ }).count(), 0)
    await page.keyboard.press('Escape')

    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
    )
    assert.equal(await cardWidth(page), 238, 'single view is the narrow column')
    assert.equal(await stage(page).getAttribute('data-wide'), null)

    const menu = await threadMenu()
    assert.equal(await menu.getByRole('menuitem', { name: 'Dual view' }).count(), 1)
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

    const back = await threadMenu()
    assert.equal(await back.getByRole('menuitem', { name: 'Dual view' }).count(), 0)
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
      'PASS: thread right-click menu item, single/dual choice saved, widen-then-grow and narrow-then-shrink order, instant restore on load, and one-provider fallback.',
    )
  } finally {
    await page.evaluate((settings) => window.threadlight.updateSettings(settings), {
      enabledProviders: initial.enabledProviders,
      panelLayout: initial.panelLayout,
    })
  }
}
