/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { openHeaderPage } from './header-navigation.mjs'

export async function checkHeaderMenu(page, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      listMode: 'recent',
    })
    window.threadlight.newThread = async (input) => {
      window.proof.calls.push(['newThread', input])
      return new Promise((resolve) => {
        window.proof.finishCreation = resolve
      })
    }
    window.threadlight.threadTimeline = async ({ threadId }) => ({
      ok: true,
      timeline: {
        revision: 1,
        threadId,
        connection: 'live',
        items: [],
        hasMore: false,
        loadingOlder: false,
      },
    })
  })
  const header = page.locator('header')
  assert.equal(await header.getByRole('button', { name: 'Shared Spaces', exact: true }).count(), 0)
  assert.equal(await header.getByRole('button', { name: /Agent: ask/ }).count(), 0)
  await openHeaderPage(page, 'Shared Spaces')
  await page.getByRole('region', { name: 'Shared Spaces', exact: true }).waitFor()
  await openHeaderPage(page, 'Agent')
  await page.getByPlaceholder('Ask your agent…').waitFor()
  await header.focus()
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: 'Header menu', exact: true })
  await menu.waitFor()
  for (const name of ['Active', 'Recent', 'All']) {
    assert.equal(await menu.getByRole('menuitem', { name, exact: true }).count(), 0)
  }
  await capture('header-navigation-menu')
  await page.keyboard.press('Enter')
  const pill = menu.getByRole('group', { name: 'New thread provider' })
  await pill.waitFor()
  const codex = pill.getByRole('menuitem', { name: 'Codex', exact: true })
  assert.equal(await pill.getByRole('menuitem', { name: 'Claude', exact: true }).isDisabled(), true)
  await codex.hover()
  assert.equal(
    await codex.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(127, 178, 255)',
  )
  await capture('header-provider-picker')
  await codex.click()
  await page.waitForFunction(() => typeof window.proof.finishCreation === 'function')
  await header.click({ button: 'right' })
  assert.equal(await menu.getByRole('menuitem', { name: 'Opening chat…' }).isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.proof.finishCreation({ ok: false, reason: 'Codex is not ready. Retry the same chat.' })
    delete window.proof.finishCreation
  })
  await page.getByText('Codex is not ready. Retry the same chat.', { exact: true }).waitFor()
  // A renderer reload must retain the same creation operation.
  const pending = await page.evaluate(() =>
    localStorage.getItem('threadlight.new-thread.pending.v1'),
  )
  assert.ok(pending)
  await header.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'New', exact: true }).click()
  await codex.click()
  await page.waitForFunction(() => typeof window.proof.finishCreation === 'function')
  const calls = await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'newThread'))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0][1], calls[1][1])
  await page.evaluate(async () => {
    await window.proof.patch({
      title: 'New Codex chat',
      state: 'idle',
      stage: 'Ready',
      attention: null,
      lastPrompt: '',
      lastReply: null,
      lastAction: null,
      plan: [],
      planText: null,
      live: true,
    })
    window.proof.finishCreation({
      ok: true,
      sessionId: 'codex:11111111-1111-4111-8111-111111111111',
    })
  })
  const composer = page.getByRole('group', { name: 'Codex message composer' }).getByRole('textbox')
  await composer.waitFor()
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA')
  assert.equal(await composer.inputValue(), '')
  assert.equal(await page.getByPlaceholder('Ask your agent…').count(), 0)
  assert.equal(
    await page.evaluate(() => localStorage.getItem('threadlight.new-thread.pending.v1')),
    null,
  )
  assert.equal(await page.locator('[data-card][data-pinned]').count(), 1)
  await capture('header-new-codex-smart-thread')
  console.log(
    'PASS: header-only navigation, keyboard provider pill, blue hover, disabled Claude, in-flight guard, stable retry, and empty focused Codex smart thread.',
  )
}
