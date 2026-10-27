/* global window */
import assert from 'node:assert/strict'

export async function checkThreadReading(page, capture) {
  const result = {
    outcome: 'ok',
    queryId: 'synthetic-query',
    requestedAt: 1,
    scope: ['claude', 'codex'],
    sources: [{ source: 'synthetic_metadata', health: 'ok', checkedAt: 1 }],
    resolution: 'ambiguous',
    candidates: [
      {
        threadRef: 'opaque-choice-a',
        title: 'Synthetic <script>chat</script>',
        titleSource: 'explicit',
        provider: 'claude',
        host: 'local',
        workspace: 'C:/synthetic',
        archived: false,
        lastActiveAt: 1,
        matchReason: 'exact title',
      },
      {
        threadRef: 'opaque-choice-b',
        title: 'Synthetic alternative',
        titleSource: 'explicit',
        provider: 'codex',
        host: 'local',
        workspace: 'C:/synthetic',
        archived: false,
        lastActiveAt: 1,
        matchReason: 'exact title',
      },
    ],
    hasMore: false,
    coverage: [],
  }
  await page.evaluate(
    (result) =>
      window.proof.agent({
        provider: 'codex',
        status: 'ready',
        ended: false,
        sessionId: 'synthetic-reader',
        conversationId: 'synthetic-reader',
        requests: [],
        items: [
          {
            id: 'receipt',
            kind: 'step',
            text: 'Source',
            source: {
              callId: 'synthetic-call',
              tool: 'threadlight_find_threads',
              at: 1,
              correlation: 'local_runtime_call',
              result,
            },
          },
        ],
      }),
    result,
  )
  await page.getByText('Source · Chat search', { exact: true }).click()
  const candidate = page.getByRole('button', {
    name: 'Synthetic <script>chat</script> · claude · C:/synthetic',
    exact: true,
  })
  await candidate.waitFor()
  await capture('agent-thread-source')
  await page.evaluate(() => window.proof.agent({ status: 'working' }))
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
  assert.equal(await candidate.isDisabled(), true)
  await page.evaluate(() => window.proof.agent({ status: 'ready' }))
  await candidate.click()
  assert.ok(
    await page.evaluate(() =>
      window.proof.calls.some(
        (c) => c[0] === 'agentSend' && String(c[1]).includes('opaque-choice-a'),
      ),
    ),
  )
  const evidence = {
    outcome: 'partial',
    observationId: 'synthetic-observation',
    thread: result.candidates[0],
    requestedAt: 1,
    checkedAt: 2,
    sources: [{ source: 'synthetic_transcript', health: 'ok', checkedAt: 2, sourceUpdatedAt: 1 }],
    changedDuringRead: false,
    status: { state: 'waiting', basis: 'hook', at: 1, turnId: 'synthetic-turn' },
    currentRequest: { role: 'user', text: 'Check synthetic work.' },
    latestProgress: null,
    latestCompletedReply: null,
    plan: { role: 'activity', text: 'in_progress: Inspect the synthetic button.' },
    attention: { role: 'activity', text: 'Choose Amber or Cyan in the destination chat.' },
    backgroundTasks: [],
    coverage: ['Synthetic bounded history.'],
    items: [],
    hasMore: false,
  }
  await page.evaluate(
    (result) =>
      window.proof.agent({
        status: 'ready',
        items: [
          {
            id: 'read-receipt',
            kind: 'step',
            text: 'Source',
            sourceHistorical: true,
            source: {
              callId: 'synthetic-read',
              tool: 'threadlight_read_thread',
              at: 2,
              correlation: 'local_runtime_call',
              result,
            },
          },
        ],
      }),
    evidence,
  )
  const source = page.locator('details').filter({
    has: page.getByText('Source · Synthetic <script>chat</script> · historical', { exact: true }),
  })
  await source.locator('summary').click()
  await source
    .getByText('activity: Choose Amber or Cyan in the destination chat.', { exact: true })
    .waitFor()
  assert.ok((await source.innerText()).includes('source updated'))
  await capture('agent-thread-read-source')
  await page.evaluate(() => window.proof.agent({ status: 'ready', items: [] }))
}
