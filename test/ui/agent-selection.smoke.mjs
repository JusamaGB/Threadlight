/* global window, document */
import assert from 'node:assert/strict'

export async function checkAgentSelection(page, capture) {
  await page.evaluate(() =>
    window.proof.agent({
      provider: 'claude',
      model: 'claude-haiku-5-5 / opus',
      reasoning: null,
      status: 'ready',
      ended: false,
      conversationId: 'claude:existing',
      sessionId: 'existing',
      requests: [],
    }),
  )
  await page.getByText('Claude · claude-haiku-5-5 / opus', { exact: true }).waitFor()
  await page.getByText(/Your next conversation will use Codex · future-deep · ultra/).waitFor()
  const change = page.getByRole('button', { name: 'Use selected model', exact: true })
  await capture('agent-selection-changed')
  await page.evaluate(() => window.proof.agent({ status: 'working' }))
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Use selected model')
        ?.disabled,
  )
  await page.evaluate(() => window.proof.agent({ status: 'ready' }))
  const before = await page.evaluate(
    () => window.proof.calls.filter((c) => c[0] === 'agentSend').length,
  )
  await change.click()
  await page.getByText('Codex · future-deep · ultra', { exact: true }).waitFor()
  assert.equal(await change.count(), 0)
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentSend').length),
    before,
  )
  await checkFooterSettings(page, capture)
}

export async function checkFooterSettings(page, capture) {
  const footer = page.getByRole('group', { name: 'Agent settings', exact: true })
  const control = (field) => footer.getByRole('button', { name: new RegExp(`^Agent ${field}:`) })
  const settings = () => page.evaluate(() => window.threadlight.getSettings())
  const choose = async (field, option) => {
    await control(field).click()
    await page.getByRole('menuitem', { name: option, exact: true }).click()
  }
  const idle = () =>
    page.evaluate(() =>
      window.proof.agent({
        status: 'idle',
        ended: true,
        conversationId: null,
        sessionId: null,
        items: [],
        requests: [],
        error: null,
      }),
    )
  const saved = await settings()
  await page.evaluate(() => window.threadlight.updateSettings({ agentWorker: 'opus' }))
  await page.evaluate(() => {
    window.proof.footerOriginal = {
      updateSettings: window.threadlight.updateSettings,
      agentModels: window.threadlight.agentModels,
      closePanel: window.threadlight.closePanel,
    }
    window.proof.footerCloseCalls = 0
    window.threadlight.closePanel = () => {
      window.proof.footerCloseCalls++
    }
  })
  try {
    await choose('provider', 'Claude')
    await footer.getByRole('button', { name: 'Agent provider: Claude', exact: true }).waitFor()
    assert.equal((await settings()).agentProvider, 'claude')
    assert.equal(await footer.getByRole('button', { name: /^Agent effort:/ }).count(), 0)
    await choose('model', 'Sonnet')
    await footer.getByRole('button', { name: 'Agent model: Haiku / sonnet', exact: true }).waitFor()
    assert.equal((await settings()).agentWorker, 'sonnet')
    await choose('provider', 'Codex')
    await footer.getByRole('button', { name: 'Agent provider: Codex', exact: true }).waitFor()
    await choose('model', 'Future Fast')
    await footer.getByRole('button', { name: 'Agent effort: low', exact: true }).waitFor()
    assert.equal((await settings()).agentCodexModel, 'future-fast')
    assert.equal(
      (await settings()).agentCodexReasoning,
      'low',
      'new model uses its own default effort',
    )
    await choose('effort', 'medium')
    await footer.getByRole('button', { name: 'Agent effort: medium', exact: true }).waitFor()
    assert.equal((await settings()).agentCodexReasoning, 'medium')
    await control('model').focus()
    await page.keyboard.press('Space')
    await page.getByRole('menu', { name: 'Agent model' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('menu').waitFor({ state: 'detached' })
    assert.equal(
      await control('model').evaluate((element) => element === document.activeElement),
      true,
    )
    assert.equal(
      await page.evaluate(() => window.proof.footerCloseCalls),
      0,
      'Escape closes only the footer menu',
    )
    await control('model').click()
    await page.getByRole('menuitem', { name: 'Future Deep', exact: true }).waitFor()
    await capture('agent-footer-model-menu')
    await page.getByRole('menuitem', { name: 'Future Deep', exact: true }).click()
    await footer.getByRole('button', { name: 'Agent effort: high', exact: true }).waitFor()
    assert.equal((await settings()).agentCodexReasoning, 'high')
    await page.evaluate(() =>
      window.proof.agent({
        provider: 'codex',
        model: 'future-deep',
        reasoning: 'high',
        status: 'ready',
        ended: false,
        conversationId: 'codex:footer-existing',
        sessionId: 'footer-existing',
      }),
    )
    const sends = await page.evaluate(
      () => window.proof.calls.filter((call) => call[0] === 'agentSend').length,
    )
    await choose('effort', 'ultra')
    await page.getByText(/Your next conversation will use Codex · future-deep · ultra/).waitFor()
    assert.equal(
      await control('effort').innerText(),
      'high',
      'running conversation retains its recorded effort',
    )
    assert.equal(
      await page.evaluate(
        () => window.proof.calls.filter((call) => call[0] === 'agentSend').length,
      ),
      sends,
    )
    await page.getByRole('button', { name: 'Use selected model', exact: true }).click()
    await footer.getByRole('button', { name: 'Agent effort: ultra', exact: true }).waitFor()
    for (const opensDown of [true, false]) {
      await page.evaluate(
        (opensDown) =>
          window.proof.emit('onPanelOpened', { maxHeight: 500, opensDown, fresh: false }),
        opensDown,
      )
      await control('provider').click()
      await page.waitForFunction(() => {
        const bounds = document.querySelector('[role="menu"]').getBoundingClientRect()
        return bounds.top >= 0 && bounds.bottom <= window.proof.resizes.at(-1)
      })
      await page.keyboard.press('Escape')
    }
    await control('provider').click()
    await page.locator('[class*="_menuLayer_"]').click({ position: { x: 3, y: 3 } })
    await page.getByRole('menu').waitFor({ state: 'detached' })
    await page.evaluate(() => {
      window.threadlight.updateSettings = async () => ({
        ok: false,
        reason: 'Synthetic footer save rejected',
      })
    })
    await choose('provider', 'Claude')
    await page.getByRole('alert').filter({ hasText: 'Synthetic footer save rejected' }).waitFor()
    assert.equal((await settings()).agentProvider, 'codex')
    await page.evaluate(() => {
      window.threadlight.updateSettings = window.proof.footerOriginal.updateSettings
    })
    await choose('provider', 'Claude')
    await footer.getByRole('button', { name: 'Agent provider: Claude', exact: true }).waitFor()
    await page.evaluate(() => {
      window.threadlight.agentModels = async () => {
        throw new Error('Synthetic discovery failure')
      }
    })
    await choose('provider', 'Codex')
    await footer.getByRole('button', { name: 'Agent provider: Codex', exact: true }).waitFor()
    await control('model').click()
    await page
      .getByRole('menuitem', { name: 'Could not discover Codex models.', exact: true })
      .waitFor()
    await page.evaluate(() => {
      window.threadlight.agentModels = window.proof.footerOriginal.agentModels
    })
    await page.getByRole('menuitem', { name: 'Retry', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Future Fast', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await capture('agent-footer-settings')
    console.log(
      'PASS: footer provider/model/effort, full model catalog, effort reset, current conversation retention, keyboard, both opening directions, failed save and discovery retry.',
    )
  } finally {
    await page.evaluate((saved) => {
      Object.assign(window.threadlight, window.proof.footerOriginal)
      return window.threadlight.updateSettings({
        agentProvider: saved.agentProvider,
        agentWorker: saved.agentWorker,
        agentCodexModel: saved.agentCodexModel,
        agentCodexReasoning: saved.agentCodexReasoning,
      })
    }, saved)
    await idle()
    await page.evaluate(() =>
      window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: false }),
    )
  }
}

export async function checkAgentSettings(page, capture) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      agentProvider: 'codex',
      agentCodexModel: 'future-fast',
      agentCodexReasoning: 'low',
      agentWorker: 'opus',
    }),
  )
  const group = page.getByRole('group', { name: 'Agent settings', exact: true })
  const control = (field) => group.getByRole('button', { name: new RegExp(`^Agent ${field}:`) })
  const choose = async (field, value) => {
    await control(field).hover()
    await page.getByRole('menuitem', { name: value, exact: true }).click()
  }
  await control('model').getByText('Future Fast', { exact: true }).waitFor()
  // A menu never offers the option already chosen: Codex and Future Fast are on the buttons.
  await control('provider').hover()
  await page.getByRole('menuitem', { name: 'Claude', exact: true }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Codex', exact: true }).count(), 0)
  await control('model').hover()
  await page.getByRole('menuitem', { name: 'Future Deep', exact: true }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Future Fast', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  assert.equal(await page.getByRole('checkbox', { name: 'Show additional models' }).count(), 0)
  assert.equal(await group.locator('select').count(), 0)
  assert.equal(
    await page
      .getByText('Wait quietly in the background until Claude or Codex opens, then show the dot.')
      .count(),
    0,
  )
  const lifetime = page.getByLabel('Agent conversation lifetime', { exact: true })
  await lifetime.focus()
  await control('model').hover()
  await page.getByRole('menuitem', { name: 'Future Deep', exact: true }).waitFor()
  assert.equal(
    await lifetime.evaluate((el) => el === document.activeElement),
    true,
    'hover leaves keyboard focus in place',
  )
  assert.equal(await page.getByRole('menuitem', { name: 'Show additional models' }).count(), 0)
  await page.getByRole('menuitem', { name: 'Future Deep', exact: true }).click()
  await control('effort').getByText('High', { exact: true }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.threadlight.getSettings())).agentCodexReasoning,
    'high',
  )
  await choose('effort', 'ultra')
  await control('effort').getByText('Ultra', { exact: true }).waitFor()
  await control('provider').hover()
  await page.getByRole('menu', { name: 'Agent provider', exact: true }).waitFor()
  await page.locator('header').hover()
  await page.getByRole('menu').waitFor({ state: 'detached' })
  assert.equal((await page.evaluate(() => window.threadlight.getSettings())).agentProvider, 'codex')
  await choose('provider', 'Claude')
  await control('model').getByText('Opus', { exact: true }).waitFor()
  assert.equal(await control('effort').count(), 0)
  await choose('model', 'Sonnet')
  await control('model').getByText('Sonnet', { exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.threadlight.getSettings())).agentWorker, 'sonnet')
  await choose('provider', 'Codex')
  // The Agent block is rebuilt when the saved provider arrives; wait for that before focusing.
  await page.waitForFunction(
    async () => (await window.threadlight.getSettings()).agentProvider === 'codex',
  )
  await control('provider').focus()
  await page.keyboard.press('Space')
  await page.getByRole('menu', { name: 'Agent provider' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'detached' })
  assert.equal(await control('provider').evaluate((el) => el === document.activeElement), true)
  const bounds = await group
    .locator('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()))
  assert.equal(
    new Set(bounds.map((box) => box.top)).size,
    1,
    'provider, model and effort fit on one line',
  )
  await capture('agent-settings-text-controls')
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await control('model').getByText('Future Deep', { exact: true }).waitFor()
  await control('effort').getByText('Ultra', { exact: true }).waitFor()
  console.log(
    'PASS: compact Settings identity, all models, hover menus without focus theft, menu crossing/dismissal, effort reset, both providers, keyboard and persisted choices; sign-in hint removed.',
  )
}
