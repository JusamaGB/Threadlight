import { openHeaderPage, selectThreadView } from './header-navigation.mjs'
import { setupLegacySpace } from './space-navigation.mjs'
/* global window, document, MouseEvent */
import assert from 'node:assert/strict'

export async function checkInputNavigation(page, capture) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  const mouse = (direction) =>
    page.evaluate((direction) => {
      document.body.dispatchEvent(
        new MouseEvent('mouseup', {
          button: direction === 'back' ? 3 : 4,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, direction)
  const settings = () => page.getByRole('button', { name: 'Settings', exact: true }).click()
  const threads = () => page.locator('[data-thread-view]').waitFor()
  await settings()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).waitFor()
  await mouse('back')
  await threads()
  await mouse('forward')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await threads()
  await mouse('forward')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).waitFor()
  // Native app commands and DOM events for one physical click must travel only once.
  await page.evaluate(() => {
    window.proof.emit('onPanelNavigate', 'back')
    document.body.dispatchEvent(
      new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }),
    )
  })
  await threads()
  await openHeaderPage(page, 'Agent')
  await mouse('forward')
  await page.getByRole('button', { name: 'Reply to Agent' }).click()
  const draft = page.getByPlaceholder('Ask your agent…')
  await draft.waitFor()
  await draft.fill('Keep this unsent draft while I peek')
  const before = await page.evaluate(() => JSON.stringify(window.proof.calls))
  await page.evaluate(() => window.proof.emit('onPanelPeek', true))
  const peek = page.getByRole('region', { name: 'Temporary Active threads' })
  await peek.waitFor()
  await peek.getByText('Synthetic Codex', { exact: true }).waitFor()
  assert.equal(await draft.inputValue(), 'Keep this unsent draft while I peek')
  assert.equal(await draft.isVisible(), false)
  await capture('keyboard-active-peek')
  await page.evaluate(() => window.proof.emit('onPanelPeek', false))
  await draft.waitFor()
  assert.equal(await draft.inputValue(), 'Keep this unsent draft while I peek')
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.proof.calls)),
    before,
    'peek sends no commands',
  )
  const gear = page.getByRole('button', { name: 'Agent settings', exact: true })
  await gear.click()
  await page.getByRole('button', { name: 'Back to Agent' }).click()
  assert.equal(await draft.inputValue(), 'Keep this unsent draft while I peek')
  await gear.click()
  await page.getByRole('button', { name: /Earlier/ }).click()
  await page.getByRole('button', { name: /Synthetic earlier agent/ }).click()
  await page.getByText('A saved reply', { exact: true }).waitFor()
  await mouse('back')
  await draft.waitFor()
  await mouse('forward')
  await page.getByText('A saved reply', { exact: true }).waitFor()
  await mouse('back')
  await draft.waitFor()
  await mouse('back')
  await threads()
  await mouse('forward')
  await draft.waitFor()
  await mouse('forward')
  await page.getByText('A saved reply', { exact: true }).waitFor()
  await mouse('back')
  await draft.waitFor()
  await mouse('back')
  await threads()

  await openHeaderPage(page, 'Shared Spaces')
  await setupLegacySpace(page)
  const handoffs = page.getByRole('region', { name: 'Handoffs', exact: true })
  await handoffs.getByRole('button', { name: /shared Workspace collaboration/ }).click()
  await handoffs.getByText('Folders & controls', { exact: true }).click()
  await handoffs.getByRole('button', { name: 'New folder', exact: true }).click()
  await handoffs.getByLabel('Title', { exact: true }).waitFor()
  await mouse('back')
  await handoffs.getByRole('button', { name: 'New folder', exact: true }).waitFor()
  await mouse('forward')
  await handoffs.getByLabel('Title', { exact: true }).waitFor()
  await capture('mouse-navigation-nested-form')
  const wire = page.locator('[data-wire-toggle]')
  await page.getByRole('button', { name: 'Return to Active', exact: true }).click()
  await threads()
  await handoffs.waitFor({ state: 'hidden' })
  for (const mode of ['active', 'recent', 'workspace']) {
    await selectThreadView(page, mode)
    const label = mode[0].toUpperCase() + mode.slice(1)
    for (const workspaceWires of [false, true]) {
      await page.evaluate(
        (workspaceWires) =>
          window.threadlight.updateSettings({ workspaceWires, panelLayout: 'dual' }),
        workspaceWires,
      )
      const saved = await page.evaluate(() => window.threadlight.getSettings())
      for (const destination of ['Settings', 'Agent', 'Workspace picker']) {
        if (destination === 'Settings') await settings()
        else if (destination === 'Agent') await openHeaderPage(page, 'Agent')
        else await page.getByRole('button', { name: /^Choose workspace:/ }).click()
        const home = page.getByRole('button', { name: `Return to ${label}`, exact: true })
        await home.waitFor()
        assert.equal(await home.getAttribute('aria-pressed'), null, 'home is a navigation action')
        assert.equal(await home.getAttribute('data-connected'), String(workspaceWires))
        await home.press('Enter')
        await page.locator(`[data-thread-view="${mode}"]`).waitFor()
        assert.deepEqual(
          await page.evaluate(() => window.threadlight.getSettings()),
          saved,
          `${destination}: returning home preserves wires, layout and folder scope`,
        )
        assert.equal(
          await page.locator('[data-card]').locator('..').locator('..').getAttribute('data-dual'),
          mode === 'active' ? null : 'true',
          'return restores the saved dual layout where supported',
        )
      }
      await wire.click()
      await page.waitForFunction(
        async (before) => (await window.threadlight.getSettings()).workspaceWires !== before,
        workspaceWires,
      )
      assert.equal(await wire.getAttribute('aria-pressed'), String(!workspaceWires))
    }
  }
  await openHeaderPage(page, 'Agent')
  assert.equal(await draft.inputValue(), 'Keep this unsent draft while I peek')
  await page.getByRole('button', { name: 'Return to Workspace', exact: true }).click()
  await capture('wire-home-workspace-dual')
  console.log(
    'PASS: mouse/native back-forward, nested Shared Spaces, Active peek, wire home from subpages, retained Agent draft, saved main views and dual layout, and wire toggling only on main views.',
  )
}
