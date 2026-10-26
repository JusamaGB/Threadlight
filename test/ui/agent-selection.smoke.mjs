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

async function checkFooterSettings(page, capture) {
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
    await choose('model', 'Show additional models')
    await page.getByRole('menuitem', { name: 'Future Deep · additional', exact: true }).waitFor()
    await capture('agent-footer-model-menu')
    await page.getByRole('menuitem', { name: 'Future Deep · additional', exact: true }).click()
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
      'PASS: footer provider/model/effort, additional models, effort reset, current conversation retention, keyboard, both opening directions, failed save and discovery retry.',
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
