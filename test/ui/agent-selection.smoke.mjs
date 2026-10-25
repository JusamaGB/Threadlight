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
}
