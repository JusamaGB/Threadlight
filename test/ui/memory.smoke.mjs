/* global window */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'

export async function setupMemory(page, MemoryStore, MemoryConnections) {
  const directory = mkdtempSync(join(tmpdir(), 'threadlight-ui-memory-')),
    store = new MemoryStore(join(directory, 'memory.sqlite'))
  const connections = new MemoryConnections(store)
  const snapshot = () => {
    const pending = connections.list()
    return { ...store.snapshot(), endpoint: 'http://127.0.0.1:47618/mcp', connections: pending }
  }
  store.onChange = () => {
    void page.evaluate((data) => window.proof?.emit('onMemory', data), snapshot()).catch(() => {})
  }
  connections.onChange = store.onChange
  const execute = (input) => store.execute({ ...input, operationId: randomUUID() })
  await page.exposeFunction('mockMemory', (input) => {
    try {
      const value =
        input.action === 'create_grant' && input.connectionId
          ? connections.approve(input.connectionId, input)
          : input.action === 'reject_connection'
            ? connections.reject(input.id)
            : store.execute(input)
      return { ok: true, value, snapshot: snapshot() }
    } catch (error) {
      return { ok: false, code: error.code ?? 'error', reason: error.message }
    }
  })
  return {
    directory,
    store,
    connections,
    execute,
    close: () => {
      connections.close()
      store.close()
      if (resolve(directory).startsWith(resolve(tmpdir()) + sep + 'threadlight-ui-memory-'))
        rmSync(directory, { recursive: true, force: true })
    },
  }
}

export async function checkMemory(page, proof, capture) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page
    .getByLabel('Shared Spaces workspace', { exact: true })
    .selectOption({ label: 'shared' })
  assert.equal(await page.getByRole('tab', { name: 'Ideas', exact: true }).count(), 0)
  await capture('shared-spaces-setup')
  await page.getByRole('button', { name: 'Create Shared Spaces', exact: true }).click()
  const view = page.getByRole('region', { name: 'Handoffs', exact: true })
  await view.getByRole('button', { name: /shared Workspace collaboration/ }).click()
  await view.getByRole('button', { name: 'New folder', exact: true }).click()
  await view.getByLabel('Title', { exact: true }).fill('Research')
  await view.getByLabel('Description', { exact: true }).fill('Verified sources and open questions')
  await view.getByRole('button', { name: 'Save', exact: true }).click()
  const space = proof.store.snapshot().spaces[0]
  for (const title of [
    'Decisions',
    'UI references',
    'Implementation',
    'Test evidence',
    'Open questions',
  ])
    proof.execute({
      action: 'ensure_folder',
      spaceId: space.id,
      title,
      description: 'Synthetic sector',
      reason: 'UI verification',
    })
  await view.getByRole('button', { name: /More folders/ }).click()
  await view.getByRole('button', { name: /Open questions 0 items/ }).waitFor()
  assert.equal(Math.round((await page.locator('[data-card]').boundingBox()).width), 300)
  await capture('memory-map')
  const pairing = {
    action: 'request',
    id: randomUUID(),
    secret: randomBytes(32).toString('hex'),
    provider: 'codex',
    label: 'Synthetic plugin review',
  }
  const pending = proof.connections.request(pairing)
  await view.getByRole('button', { name: 'Agent access', exact: true }).click()
  await view.getByText(pending.code, { exact: true }).waitFor()
  await view.getByRole('button', { name: 'Review connection', exact: true }).click()
  const research = proof.store.snapshot().folders.find((f) => f.title === 'Research')
  await view.getByLabel('Access scope', { exact: true }).selectOption(research.id)
  assert.equal(await view.getByLabel('Allow publishing drafts').isChecked(), false)
  await capture('memory-plugin-approval')
  await view.getByRole('button', { name: 'Save', exact: true }).click()
  await view.getByText(/Approved · awaiting tool use/).waitFor()
  const actor = proof.connections.authenticate(pairing.id, pairing.secret)
  assert.equal(proof.store.briefing(actor).enrollment.folderId, research.id)
  await view.getByText(/Read only.*Connected/).waitFor()
  await view.getByRole('button', { name: 'Revoke', exact: true }).click()
  await view.getByRole('button', { name: 'Confirm', exact: true }).click()
  assert.throws(() => proof.connections.authenticate(pairing.id, pairing.secret))
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await view.getByRole('button', { name: /Research 0 items/ }).click()
  await view.getByRole('button', { name: 'New note', exact: true }).click()
  await view.getByLabel('Title', { exact: true }).fill('Shared context contract')
  await view
    .getByLabel('Text', { exact: true })
    .fill('The map groups material by purpose.\nEach revision retains its source and author.')
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await view.getByRole('button', { name: 'New note', exact: true }).click()
  assert.equal(
    await view.getByLabel('Title', { exact: true }).inputValue(),
    'Shared context contract',
  )
  await view.getByRole('button', { name: 'Save', exact: true }).click()
  await view.getByRole('button', { name: /Shared context contract note/ }).click()
  await view.getByText('The map groups material by purpose.', { exact: false }).waitFor()
  await view.getByLabel('Discuss this item').fill('Keep this context with this item.')
  await capture('memory-item')
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await view.getByRole('button', { name: /Shared context contract note/ }).click()
  assert.equal(
    await view.getByLabel('Discuss this item').inputValue(),
    'Keep this context with this item.',
  )
  await view.getByRole('button', { name: 'Propose revision' }).click()
  await view.getByLabel('Text', { exact: true }).fill('Human revision in progress')
  const item = proof.store.snapshot().items[0]
  proof.execute({
    action: 'revise_item',
    id: item.id,
    expectedRevision: 1,
    body: 'Another contributor changed the note.',
  })
  await view.getByRole('button', { name: 'Save', exact: true }).click()
  await view.getByRole('alert').filter({ hasText: 'changed' }).waitFor()
  assert.equal(
    await view.getByLabel('Text', { exact: true }).inputValue(),
    'Human revision in progress',
  )
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await view.getByRole('button', { name: 'Request review' }).click()
  await view.getByLabel('Title', { exact: true }).fill('Review the shared-memory contract')
  await view
    .getByLabel('Objective and acceptance criteria')
    .fill('Confirm the evidence and save review findings.')
  await view.getByRole('button', { name: 'Save', exact: true }).click()
  await view.getByRole('button', { name: /Review the shared-memory contract draft/ }).click()
  await capture('memory-task')
  assert.equal(proof.store.tasks()[0].state, 'draft')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() =>
    window.proof.emit('onPanelOpened', { maxHeight: 360, opensDown: true, fresh: false }),
  )
  await page.waitForFunction(
    () => window.document.querySelector('#root > div').getBoundingClientRect().height <= 362,
  )
  assert.ok((await page.locator('#root > div').boundingBox()).height <= 362)
  await capture('memory-short-panel')
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  const folder = proof.store.snapshot().folders.find((f) => f.title === 'Research')
  proof.store.importAttachment(
    folder.id,
    'synthetic.png',
    'image/png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhCkAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  await view.getByRole('button', { name: /synthetic.png image/ }).click()
  await page.waitForFunction(
    () => window.document.querySelector('img[alt="synthetic.png"]')?.naturalWidth === 1,
  )
  assert.equal(
    (await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'send'))).length,
    0,
  )
  for (let n = 0; n < 4; n++)
    await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  console.log(
    'PASS: real memory store through compact UI; folders, map, notes, persistent drafts, stale-edit rejection, tasks, short panel and no provider sends.',
  )
}
