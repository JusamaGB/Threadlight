/* global window */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export async function setupCommunication(page, CommunicationService, memory) {
  const native = []
  const destinations = ['claude', 'codex'].map((provider) => ({
    id: `${provider === 'codex' ? 'codex:' : ''}${randomUUID()}`,
    provider,
    title: `Communication ${provider}`,
    hostId: 'local',
    workspace: '/test-project',
    model: 'test-model',
    state: 'idle',
    generation: 'ui-fixture',
    send: false,
    queue: false,
    reason: 'Native wakeup is not admitted in this UI fixture.',
    observedAt: Date.now(),
  }))
  const human = { id: 'human', kind: 'human' }
  const service = new CommunicationService(memory.communications, {
    destinations: async (target) => destinations.filter((d) => !target || d.id === target),
    authorize: (actor, id) => memory.authorizeCommunication(actor, id),
    input: (actor, id, revision) => memory.communicationInput(actor, id, revision),
    project: (id) => memory.space(id),
    folder: (spaceId, folderId) => memory.communicationFolder(spaceId, folderId),
    deliver: async () => {
      throw new Error('UI fixture must not wake providers')
    },
    nativeRequests: () => native,
    respondNative: (id) => {
      const i = native.findIndex((r) => r.id === id)
      assert.notEqual(i, -1)
      native.splice(i, 1)
      return { ok: true }
    },
  })
  memory.communicationService = service
  memory.communications.onChange = () => {
    void page.evaluate(() => window.proof?.emit('onCommunication')).catch(() => {})
  }
  await page.exposeFunction('mockCommunication', async (request) => {
    try {
      const value =
        request.action === 'snapshot'
          ? service.snapshot(human)
          : request.action === 'configure'
            ? (() => {
                const w = service.configure(request.arguments, request.expectedRevision, human)
                memory.execute({
                  action: 'update_space',
                  operationId: randomUUID(),
                  id: w.spaceId,
                  mode: w.mode,
                  paused: w.paused,
                  maxDispatches: w.maxDispatches,
                  durationMinutes: 240,
                })
                return w
              })()
            : request.action === 'authorize_assignment'
              ? service.authorizeAssignment(request.arguments, human)
              : request.action === 'focus_request'
                ? service.focusRequest(request.arguments, human)
                : await service.execute(request.action, request.arguments, human)
      return { ok: true, value }
    } catch (error) {
      return { ok: false, reason: error.message }
    }
  })
  return { service, destinations, native, human, close: () => service.close() }
}
export async function checkCommunication(page, proof, memory, capture) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page
    .getByLabel('Shared Spaces workspace', { exact: true })
    .selectOption({ label: 'shared' })
  await page.getByRole('button', { name: 'Create Shared Spaces', exact: true }).click()
  const handoffs = page.getByRole('region', { name: 'Handoffs', exact: true })
  await handoffs.getByRole('button', { name: /shared Workspace collaboration/ }).click()
  const view = page.getByRole('region', { name: 'Thread communication' })
  await view.getByText('Workflow configuration', { exact: true }).click()
  await view.getByRole('button', { name: 'Find all chats for roles' }).click()
  for (let i = 0; i < 2; i++) {
    await view.getByRole('button', { name: 'Add role', exact: true }).click()
    const row = view.locator('fieldset').nth(i)
    await row.getByLabel('Role', { exact: true }).fill(i ? 'Review' : 'Build')
    await row.getByLabel('Chat', { exact: true }).selectOption(proof.destinations[i].id)
    await row.getByLabel('Allow project DMs', { exact: true }).check()
    await row.getByLabel('Allow requests for work', { exact: true }).check()
  }
  await view.getByLabel('Pause new dispatches', { exact: true }).uncheck()
  await view.getByRole('button', { name: 'Save workflow', exact: true }).click()
  const workflow = memory.communications.list('workflow')[0]
  assert.ok(workflow)
  await view.getByLabel('DM recipient', { exact: true }).selectOption(proof.destinations[1].id)
  await view
    .getByLabel('Message', { exact: true })
    .fill('UI message with two lines.\nKeep this exact body.')
  await view.getByRole('button', { name: 'Send to chat', exact: true }).click()
  await view
    .getByLabel('Saved direct messages')
    .getByText('UI message with two lines.', { exact: false })
    .waitFor()
  const message = memory.communications.list('message')[0]
  assert.match(message.body, /\nKeep/)
  await proof.service.tick()
  assert.equal(memory.communications.get('message', message.id).deliveries[0].phase, 'inbox')
  const question = await proof.service.execute(
    'ask_question',
    {
      operationId: randomUUID(),
      spaceId: workflow.spaceId,
      body: 'Which evidence should this task use?',
      audience: 'human',
      choices: ['Blue', 'Green'],
    },
    proof.human,
  )
  await view.getByLabel('Question answer', { exact: true }).selectOption('Blue')
  await view.getByRole('button', { name: 'Answer', exact: true }).click()
  assert.equal(memory.communications.get('question', question.id).answer, 'Blue')
  const id = randomUUID()
  proof.native.push({
    id,
    generation: id,
    target: proof.destinations[0].id,
    kind: 'next-step',
    title: 'Confirm native continuation',
    startedAt: Date.now(),
    expiresAt: Date.now() + 60000,
  })
  await page.evaluate(() => window.proof.emit('onCommunication'))
  await view.getByLabel('Native answer', { exact: true }).fill('Continue with the reviewed plan')
  await view.getByRole('button', { name: 'Send answer', exact: true }).click()
  assert.equal(proof.native.length, 0)
  await capture('communication-workflow-and-history')
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page
    .getByLabel('Shared Spaces workspace', { exact: true })
    .selectOption({ label: 'shared' })
  await page
    .getByRole('region', { name: 'Handoffs', exact: true })
    .getByRole('button', { name: /shared Workspace collaboration/ })
    .click()
  await page
    .getByLabel('Saved direct messages')
    .getByText('UI message with two lines.', { exact: false })
    .waitFor()
  console.log(
    'PASS: actual UI workflow setup, discovery, multiline DM, durable reload, project answer and native response routing.',
  )
}
