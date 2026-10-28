/* global window, document */
import assert from 'node:assert/strict'

export async function checkNativeCodexMessages(page, compose, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      listMode: 'recent',
    })
    await window.proof.patch({ live: true, state: 'working', attention: null })
    window.threadlight.sendMessage = async (...args) => {
      window.proof.calls.push(['send', ...args])
      return new Promise((resolve) => {
        window.proof.finishMessage = resolve
      })
    }
  })
  await compose('Codex')
  const composer = page.getByRole('group', { name: 'Codex message composer' })
  const box = composer.getByRole('textbox')

  await box.fill('Native desktop draft')
  assert.equal(await composer.getByText(/not connected yet/).count(), 0)
  assert.equal(await composer.getByRole('button', { name: /Copy and open/ }).count(), 0)
  await capture('native-message-ready')
  await box.press('Enter')
  await page.waitForFunction(() => typeof window.proof.finishMessage === 'function')
  assert.equal(
    await composer.getByRole('button', { name: 'Queue message', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await box.inputValue(), 'Native desktop draft')
  await box.press('Enter')
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'send').length),
    1,
  )
  await page.evaluate(() => {
    window.proof.finishMessage({ ok: false, reason: 'Codex is unavailable. Draft retained.' })
    delete window.proof.finishMessage
  })
  await composer.getByText('Codex is unavailable. Draft retained.').waitFor()
  assert.equal(await box.inputValue(), 'Native desktop draft')
  await composer.getByRole('button', { name: 'Queue message', exact: true }).click()
  await page.waitForFunction(() => typeof window.proof.finishMessage === 'function')
  await page.evaluate(() => {
    window.proof.finishMessage({ ok: true })
    delete window.proof.finishMessage
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Codex message composer"] textarea')?.value === '',
  )
  const calls = await page.evaluate(() => window.proof.calls)
  assert.equal(calls.filter((c) => c[0] === 'send').length, 2)
  assert.equal(calls.filter((c) => ['copy', 'open'].includes(c[0])).length, 0)
  await compose('Claude')
  const claude = page.getByRole('group', { name: 'Claude message composer' })
  await claude.getByRole('textbox').fill('Claude still uses its existing send API')
  await claude.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => typeof window.proof.finishMessage === 'function')
  assert.equal(
    await page.evaluate(() =>
      window.proof.calls
        .filter((c) => c[0] === 'send')
        .at(-1)[1]
        .startsWith('codex:'),
    ),
    false,
  )
  await page.evaluate(() => window.proof.finishMessage({ ok: true }))
}
