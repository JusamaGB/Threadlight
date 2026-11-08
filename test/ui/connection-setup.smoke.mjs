import { openSpace } from './space-navigation.mjs'
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
  await page.getByRole('tab', { name: 'Chats', exact: true }).click()
  const team = page.getByRole('region', { name: 'Project participants', exact: true })
  const guide = page.getByRole('region', { name: 'Review chat request', exact: true })
  await team
    .getByText('There are no connected chats. Ask a chat to request if needed.', { exact: true })
    .waitFor()
  assert.equal(await team.getByRole('button', { name: 'Connect a chat', exact: true }).count(), 0)
  assert.equal(await team.getByRole('region', { name: 'Chat requests' }).count(), 0)
  // Move the available chat outside the space's source folder: this caused the empty picker.
  await page.evaluate(async (target) => {
    const snapshot = await window.threadlight.getSnapshot()
    snapshot.sessions = snapshot.sessions.map((s) =>
      s.id === target ? { ...s, cwd: 'C:/different-project' } : s,
    )
    snapshot.lookupSessions = snapshot.lookupSessions?.map((s) =>
      s.id === target ? { ...s, cwd: 'C:/different-project' } : s,
    )
    window.proof.emit('onSnapshot', snapshot)
  }, target)
  const pair = {
    action: 'request',
    id: randomUUID(),
    secret: randomBytes(32).toString('hex'),
    provider: 'codex',
    label: 'Synthetic setup chat',
    spaceId: memory.store.projectIdentities().find((p) => p.name === 'Connection test').id,
  }
  // Two real project destinations: each renderer list must show only its own requests.
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  await page.getByRole('button', { name: 'Create a space', exact: true }).click()
  await page.getByLabel('Space name', { exact: true }).fill('Other connection project')
  await page.getByRole('button', { name: 'Create space', exact: true }).click()
  await page.getByRole('tab', { name: 'Chats', exact: true }).click()
  const other = {
    ...pair,
    id: randomUUID(),
    label: 'Other project request',
    spaceId: memory.store.projectIdentities().find((p) => p.name === 'Other connection project').id,
  }
  memory.connections.request(other)
  const pending = memory.connections.request(pair)
  await team.getByRole('heading', { name: 'Requests (1)', exact: true }).waitFor()
  assert.equal(
    await team.getByRole('button', { name: 'Codex · Synthetic setup chat', exact: true }).count(),
    0,
  )
  await team.getByRole('button', { name: 'Codex · Other project request', exact: true }).click()
  await guide.getByText('Requested project: Other connection project', { exact: true }).waitFor()
  await openSpace(page, 'Connection test')
  await page.getByRole('tab', { name: 'Chats', exact: true }).click()
  assert.equal(
    await team.getByRole('button', { name: 'Codex · Other project request', exact: true }).count(),
    0,
  )

  await team.getByRole('heading', { name: 'Requests (1)', exact: true }).waitFor()
  await team.getByRole('button', { name: 'Codex · Synthetic setup chat', exact: true }).click()
  await guide.getByText('Requested project: Connection test', { exact: true }).waitFor()
  assert.equal(await guide.getByLabel('Shared space', { exact: true }).count(), 0)
  assert.equal(await guide.getByLabel('Waiting request').count(), 0)
  assert.equal(await guide.getByRole('button', { name: 'Review access', exact: true }).count(), 0)
  await guide.getByText(pending.code, { exact: true }).waitFor()
  await guide.getByLabel('Find chat', { exact: true }).fill('no-such-chat')
  await guide.getByText(/No matching chats available/).waitFor()
  await guide.getByLabel('Find chat', { exact: true }).fill('different-project')
  await guide.getByLabel('Link to chat').selectOption(target)
  // A new request can identify the same cross-folder chat and needs no second picker.
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  const identified = {
    ...pair,
    id: randomUUID(),
    label: 'Identified setup chat',
    chatId: target.replace(/^codex:/, ''),
  }
  memory.connections.request(identified)
  await team.getByRole('heading', { name: 'Requests (2)', exact: true }).waitFor()
  await team.getByRole('button', { name: 'Codex · Identified setup chat', exact: true }).click()
  await guide.getByRole('heading', { name: 'Synthetic Codex', exact: true }).waitFor()
  assert.equal(await guide.getByText(/Requesting chat:/).count(), 0)
  assert.equal(await guide.getByText(/will have access to/).count(), 0)
  assert.equal(await guide.getByRole('button', { name: 'Back to chats', exact: true }).count(), 0)
  assert.equal(await guide.getByRole('checkbox').count(), 1)
  await guide
    .getByText('This chat can read all notes and files in this space and publish shared notes.', {
      exact: true,
    })
    .waitFor()
  await capture('connection-identified')
  assert.equal(await guide.getByLabel('Link to chat').count(), 0)
  assert.equal(await guide.getByLabel('Confirm').isChecked(), false)
  // Exercise the legacy fallback all the way through approval/retry.
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  await team.getByRole('button', { name: 'Codex · Synthetic setup chat', exact: true }).click()
  await guide.getByLabel('Link to chat').selectOption(target)
  assert.equal(await guide.getByRole('button', { name: 'Approve connection' }).isDisabled(), true)
  assert.equal(memory.store.snapshot().grants.length, 0)
  await guide.getByLabel('Confirm').check()
  await capture('connection-match')
  assert.equal(await guide.getByLabel('Allow publishing shared notes').count(), 0)
  assert.equal(await guide.getByLabel('Enable decision cards and project messages').count(), 0)
  const previousWorkflows = communication.service.snapshot({ id: 'human', kind: 'human' }).workflows
  // A lost approval response must recover the same grant without configuring communication.
  await page.evaluate(() => {
    const memory = window.threadlight.memoryRequest
    const communication = window.threadlight.communicationRequest
    let lose = true
    window.threadlight.memoryRequest = async (input) => {
      const result = await memory(input)
      if (input.action === 'create_grant' && lose) {
        lose = false
        throw new Error('Synthetic lost approval response')
      }
      return result
    }
    window.threadlight.communicationRequest = async (input) => {
      if (input.action === 'configure')
        throw new Error('Connection review must not configure workflows')
      return communication(input)
    }
  })
  await guide.getByRole('button', { name: 'Approve connection' }).click()
  await guide.getByText('Synthetic lost approval response', { exact: true }).waitFor()
  assert.equal(memory.store.snapshot().grants.length, 1)
  await guide.getByRole('button', { name: 'Retry connection' }).click()
  await guide.waitFor({ state: 'hidden' })
  assert.equal(memory.store.snapshot().grants.length, 1)
  const grant = memory.store.snapshot().grants[0]
  assert.equal(grant.assignee, target)
  assert.equal(grant.readOnly, false)
  assert.equal(grant.createFolders, false)
  assert.equal(grant.delegate, false)
  assert.deepEqual(
    communication.service.snapshot({ id: 'human', kind: 'human' }).workflows,
    previousWorkflows,
  )
  const actor = memory.connections.authenticate(pair.id, pair.secret)
  const folder = memory.store.snapshot().folders.find((f) => f.spaceId === grant.spaceId)
  const item = memory.store.execute(
    {
      action: 'create_item',
      operationId: randomUUID(),
      folderId: folder.id,
      title: 'Connected chat note',
      body: 'Published through standard access.',
    },
    actor,
  )
  assert.equal(item.title, 'Connected chat note')
  await team.getByText(/Connected · Project publishing enabled/).waitFor()
  await team.getByRole('heading', { name: 'Requests (1)', exact: true }).waitFor()
  assert.equal(
    await team.getByRole('button', { name: 'Codex · Synthetic setup chat', exact: true }).count(),
    0,
  )
  await capture('connection-chats')
  // Unknown IDs cannot silently select another available chat.
  const unavailable = {
    ...pair,
    id: randomUUID(),
    label: 'Unavailable setup chat',
    chatId: randomUUID(),
  }
  memory.connections.request(unavailable)
  await team.getByRole('button', { name: 'Codex · Unavailable setup chat', exact: true }).click()
  await guide.getByText(/The requesting chat is not currently available/).waitFor()
  await guide.getByLabel('Confirm').check()
  assert.equal(await guide.getByRole('button', { name: 'Approve connection' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  await team.getByRole('button', { name: 'Codex · Identified setup chat', exact: true }).click()
  await guide.getByLabel('Confirm').check()
  await guide.getByRole('button', { name: 'Approve connection' }).click()
  await guide.waitFor({ state: 'hidden' })
  const identifiedGrant = memory.store
    .snapshot()
    .grants.find((g) => g.pluginConnectionId === identified.id)
  assert.equal(identifiedGrant.assignee, target)
  assert.equal(identifiedGrant.spaceId, grant.spaceId)
  assert.equal(identifiedGrant.readOnly, false)
  // Requests expire from the list even without another backend event.
  await page.evaluate(async (id) => {
    const response = await window.threadlight.memoryRequest({ action: 'snapshot' })
    response.snapshot.connections = response.snapshot.connections.map((c) =>
      c.id === id ? { ...c, expiresAt: Date.now() + 1000 } : c,
    )
    window.proof.emit('onMemory', response.snapshot)
  }, unavailable.id)
  await team.getByRole('heading', { name: 'Requests (1)', exact: true }).waitFor()
  await page.clock.runFor(1100)
  await team.getByRole('region', { name: 'Chat requests' }).waitFor({ state: 'hidden' })
  await team.getByText(/Connected · Project publishing enabled/).waitFor()
  await capture('connection-chats-no-requests')
  // Revoked access should not leave a supposedly connected chat in the list.
  memory.connections.reject(unavailable.id)
  for (const approved of [grant, identifiedGrant])
    memory.execute({ action: 'revoke_grant', id: approved.id })
  await team
    .getByText('There are no connected chats. Ask a chat to request if needed.', { exact: true })
    .waitFor()
}
