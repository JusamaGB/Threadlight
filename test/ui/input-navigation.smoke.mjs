import { openHeaderPage } from './header-navigation.mjs'
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
  await handoffs.getByRole('button', { name: 'New folder', exact: true }).click()
  await handoffs.getByLabel('Title', { exact: true }).waitFor()
  await mouse('back')
  await handoffs.getByRole('button', { name: 'New folder', exact: true }).waitFor()
  await mouse('forward')
  await handoffs.getByLabel('Title', { exact: true }).waitFor()
  await capture('mouse-navigation-nested-form')
  console.log(
    'PASS: mouse/native back-forward, on-screen Back retaining Forward, new-route truncation, Agent reading across remount, nested Shared Spaces forms, and temporary Active preserving the unsent Agent draft without commands.',
  )
}
