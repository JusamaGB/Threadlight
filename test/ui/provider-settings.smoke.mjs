/* global window */
import assert from 'node:assert/strict'

export async function checkProviderSettings(page, capture) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const work = page.getByRole('group', { name: 'Providers shown', exact: true })
  const chats = page.getByRole('group', { name: 'Chat providers shown', exact: true })
  const kimi = page.getByRole('region', { name: 'Kimi setup', exact: true })
  const all = work.getByRole('button', { name: 'All providers shown', exact: true })
  const chatAll = chats.getByRole('button', { name: 'All chat providers shown', exact: true })
  const selection = (name) => work.getByRole('switch', { name, exact: true })
  await work.waitFor()
  assert.equal(await kimi.isVisible(), false)
  assert.equal(await work.getByRole('switch').count(), 3)
  assert.equal(await chats.getByRole('switch').count(), 2)
  assert.equal(await selection('Kimi').count(), 0)
  // Old development preferences must not expose unfinished setup in a public build.
  await page.evaluate(async () => {
    const current = await window.threadlight.getSettings()
    await window.threadlight.updateSettings({
      shownProviders: ['claude', 'codex', 'kimi'],
      kimiSetup: {
        ...current.kimiSetup,
        connection: { ...current.kimiSetup.connection, model: 'saved-model' },
      },
    })
  })
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await work.waitFor()
  assert.equal(await kimi.count(), 0)
  assert.equal(await selection('Kimi').count(), 0)
  await capture('provider-settings-compact')
  await all.click()
  await page.waitForFunction(
    async () =>
      (await window.threadlight.getSettings()).shownProviders.join() === 'claude,codex,perplexity',
  )
  assert.equal(await all.getAttribute('aria-pressed'), 'true')
  assert.equal(await work.locator('[role=switch][aria-checked=true]').count(), 3)
  await selection('OpenAI').click()
  await page.waitForFunction(
    async () => !(await window.threadlight.getSettings()).enabledProviders.includes('codex'),
  )
  assert.equal(
    await chatAll.getAttribute('aria-pressed'),
    'true',
    'work and ordinary chat choices are independent',
  )
  await chatAll.click()
  await page.waitForFunction(
    async () => (await window.threadlight.getSettings()).chatSources.length === 0,
  )
  assert.equal(await page.locator('[data-account-chat-settings]').count(), 0)
  await chats.getByRole('switch', { name: 'ChatGPT', exact: true }).click()
  await page.waitForFunction(
    async () => (await window.threadlight.getSettings()).chatSources.join() === 'chatgpt',
  )
  await capture('provider-settings-subset')
  // Legacy header/application changes keep the new selector and preview choices in sync.
  await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['codex'] }))
  await page.waitForFunction(async () =>
    (await window.threadlight.getSettings()).shownProviders.includes('codex'),
  )
  assert.equal(await selection('OpenAI').getAttribute('aria-checked'), 'true')
  assert.equal(await selection('Claude').getAttribute('aria-checked'), 'false')
  await all.click()
  await page.waitForFunction(
    async () => (await window.threadlight.getSettings()).shownProviders.length === 3,
  )
  await all.click()
  await kimi.waitFor({ state: 'hidden' })
  assert.equal(await work.locator('[role=switch][aria-checked=true]').count(), 0)
  assert.equal(await page.locator('[data-perplexity-settings]').isVisible(), false)
  assert.equal(
    await chats.getByRole('switch', { name: 'ChatGPT', exact: true }).getAttribute('aria-checked'),
    'true',
  )
  await capture('provider-settings-none')
  await page.evaluate(() => {
    window.proof.restoreProviderSave = window.threadlight.updateSettings
    window.threadlight.updateSettings = async () => ({
      ok: false,
      reason: 'Synthetic provider save refusal',
    })
  })
  await selection('Perplexity').click()
  await page.getByRole('alert').filter({ hasText: 'Synthetic provider save refusal' }).waitFor()
  assert.equal(await kimi.isVisible(), false)
  assert.equal(await selection('Perplexity').getAttribute('aria-checked'), 'false')
  await page.evaluate(() => {
    window.threadlight.updateSettings = window.proof.restoreProviderSave
  })
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await work.waitFor()
  assert.equal(await kimi.isVisible(), false)
  assert.equal(await selection('Kimi').count(), 0)
  assert.equal(
    await page.evaluate(
      async () => (await window.threadlight.getSettings()).kimiSetup.connection.model,
    ),
    'saved-model',
    'hidden development configuration is preserved',
  )
  const bounds = await work.evaluate((el) => ({ width: el.clientWidth, content: el.scrollWidth }))
  assert.ok(
    bounds.width < 250 && bounds.content <= bounds.width + 1,
    'public provider choices fit the compact settings panel',
  )
  await capture('provider-settings-restored')
  console.log(
    'PASS: public-provider All/subset/none, independent chat choices, legacy sync, Kimi hidden with saved config preservation, failed save, reload and compact layout.',
  )
}
