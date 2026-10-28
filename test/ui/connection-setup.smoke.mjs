import { openHeaderPage } from './header-navigation.mjs'
/* global window */
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'

export async function checkConnectionSetup(page, memory, communication, capture, target) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await openHeaderPage(page, 'Shared Spaces')
  await page.getByRole('button', { name: 'Create a space', exact: true }).click()
  await page.getByLabel('Space name', { exact: true }).fill('Connection test')
  await capture('connection-project')
  await page.getByRole('button', { name: 'Create space', exact: true }).click()
  await page.getByRole('button', { name: /^Connect a chat/ }).click()
  const guide = page.getByRole('region', { name: 'Connect a chat', exact: true })
  await guide.getByRole('button', { name: 'Continue', exact: true }).click()
  await guide.getByText(/No requests waiting/).waitFor()
  const pair = {
    action: 'request',
    id: randomUUID(),
    secret: randomBytes(32).toString('hex'),
    provider: 'codex',
    label: 'Synthetic setup chat',
  }
  const pending = memory.connections.request(pair)
  await guide.getByLabel('Waiting request').selectOption(pair.id)
  await guide.getByText(pending.code, { exact: true }).waitFor()
  await guide.getByLabel('Link to chat').selectOption(target)
  assert.equal(await guide.getByRole('button', { name: 'Review access' }).isDisabled(), true)
  assert.equal(memory.store.snapshot().grants.length, 0)
  await guide.getByLabel('This code matches the one in my chat').check()
  await capture('connection-match')
  await guide.getByRole('button', { name: 'Review access' }).click()
  assert.equal(await guide.getByLabel('Allow publishing shared notes').isChecked(), false)
  assert.equal(
    await guide.getByLabel('Enable decision cards and project messages').isChecked(),
    false,
  )
  await guide.getByLabel('Enable decision cards and project messages').check()
  await guide.getByLabel('Chat model').fill('test-model')
  await capture('connection-review')
  // Simulate a saved grant whose response is lost, then a failed workflow save.
  await page.evaluate(() => {
    const memory = window.threadlight.memoryRequest
    const communication = window.threadlight.communicationRequest
    let lose = true,
      fail = true
    window.threadlight.memoryRequest = async (input) => {
      const result = await memory(input)
      if (input.action === 'create_grant' && lose) {
        lose = false
        throw new Error('Synthetic lost approval response')
      }
      return result
    }
    window.threadlight.communicationRequest = async (input) => {
      if (input.action === 'configure' && fail) {
        fail = false
        throw new Error('Synthetic workflow unavailable')
      }
      return communication(input)
    }
  })
  await guide.getByRole('button', { name: 'Approve connection' }).click()
  await guide.getByText('Synthetic lost approval response', { exact: true }).waitFor()
  assert.equal(memory.store.snapshot().grants.length, 1)
  await guide.getByRole('button', { name: 'Retry connection' }).click()
  await guide.getByText('Synthetic workflow unavailable', { exact: true }).waitFor()
  await guide.getByRole('button', { name: 'Finish enabling cards' }).click()
  await guide.getByRole('heading', { name: /Ready for/ }).waitFor()
  assert.equal(memory.store.snapshot().grants.length, 1)
  const grant = memory.store.snapshot().grants[0]
  assert.equal(grant.assignee, target)
  assert.equal(grant.readOnly, false)
  assert.equal(grant.delegate, false)
  const workflow = communication.service.snapshot({ id: 'human', kind: 'human' }).workflows[0]
  assert.equal(workflow.paused, true)
  assert.equal(workflow.participants[0].target, target)
  assert.equal(workflow.participants[0].communicate, true)
  assert.equal(workflow.participants[0].requestWork, false)
  await capture('connection-ready')
  await guide.getByRole('button', { name: 'Copy test request' }).click()
  await guide.getByRole('button', { name: 'Test request copied' }).waitFor()
  // Verify the real service admits a tool question through this approved grant.
  const actor = memory.connections.authenticate(pair.id, pair.secret)
  const q = await communication.service.execute(
    'ask_question',
    {
      operationId: randomUUID(),
      spaceId: grant.spaceId,
      audience: 'human',
      answerDelivery: 'tool',
      allowOther: true,
      body: 'Does the connection work?',
      choices: ['Yes'],
    },
    memory.store.communicationActor(actor),
  )
  assert.equal(q.state, 'pending')
  assert.equal(q.senderTarget, target)
  await guide.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByText('Connected chats · 1', { exact: true }).click()
  await page.getByText(/Connected · Can publish/).waitFor()
  await capture('connection-chats')
}
