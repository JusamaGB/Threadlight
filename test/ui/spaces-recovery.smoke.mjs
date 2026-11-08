/* global window */
import assert from 'node:assert/strict'
import { openHeaderPage } from './header-navigation.mjs'

export async function checkSpacesRecovery(page, capture) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Loading settings.' }).waitFor()
  await page.evaluate(() => {
    window.proof.failSettings = false
  })
  await page.getByRole('switch', { name: 'Codex', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await openHeaderPage(page, 'Shared Spaces')
  await page.waitForFunction(() => !!window.proof.rejectSpaces)
  await page.evaluate(() => window.proof.rejectSpaces(Error('initial list failed')))
  await page.getByText('Shared Spaces could not load.', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const result = await window.mockSpaces({ action: 'list' })
    window.proof.emit('onSpaces', result.snapshot)
  })
  await page
    .getByText('Shared Spaces could not load.', { exact: true })
    .waitFor({ state: 'hidden' })
  await capture('spaces-recovered-snapshot')
  await page.reload()
  await page.evaluate(() => {
    window.proof.failSettings = false
  })
  await openHeaderPage(page, 'Shared Spaces')
  await page.waitForFunction(() => !!window.proof.rejectSpaces)
  await page.evaluate(async () => {
    const result = await window.mockSpaces({ action: 'list' })
    window.proof.emit('onSpaces', result.snapshot)
    window.proof.rejectSpaces(Error('older failed response'))
  })
  await page.getByRole('heading', { name: 'Your shared spaces' }).waitFor()
  assert.equal(await page.getByText('Shared Spaces could not load.', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Create a space', exact: true }).click()
  await page.getByLabel('Space name', { exact: true }).fill('Operation error stays visible')
  await page.evaluate(() => {
    window.threadlight.spacesRequest = async () => ({
      ok: false,
      reason: 'Synthetic operation error',
    })
  })
  await page.getByRole('button', { name: 'Create space', exact: true }).click()
  await page.getByText('Synthetic operation error', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const result = await window.mockSpaces({ action: 'list' })
    window.proof.emit('onSpaces', result.snapshot)
  })
  assert.equal(await page.getByText('Synthetic operation error', { exact: true }).count(), 1)
  console.log(
    'PASS: failed initial list recovers from snapshot; late failure cannot overwrite success; operation errors persist; Settings retries automatically.',
  )
}
