import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { openHeaderPage } from './header-navigation.mjs'
import { setupLegacySpace, openSpace } from './space-navigation.mjs'

export async function checkNotesPurpose(page, spaces, memory, capture) {
  await openHeaderPage(page, 'Shared Spaces')
  await setupLegacySpace(page)
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('textbox', { name: 'New note', exact: true }).fill('Human purpose note.')
  await view.getByRole('button', { name: 'Save note', exact: true }).click()
  const spaceId = spaces.store.all()[0].sharedSpaceId
  const folder = memory.execute({
    action: 'ensure_folder',
    spaceId,
    title: 'Purpose test',
    description: 'Isolated notes',
    reason: 'Renderer proof',
  }).folder
  const ids = []
  for (const provider of ['codex', 'claude']) {
    const connectionId = randomUUID(),
      chatId = randomUUID(),
      secret = randomBytes(32).toString('hex')
    const assignee = `${provider === 'codex' ? 'codex:' : ''}${chatId}`
    memory.connections.request({
      action: 'request',
      spaceId,
      id: connectionId,
      chatId,
      provider,
      secret,
      label: 'Isolated saver',
    })
    memory.connections.approve(connectionId, {
      action: 'create_grant',
      spaceId,
      folderId: folder.id,
      assignee,
      title: 'Isolated saver',
      readOnly: false,
    })
    const actor = memory.connections.authenticate(connectionId, secret)
    const item = memory.store.execute(
      {
        action: 'create_item',
        operationId: randomUUID(),
        folderId: folder.id,
        purpose: 'note',
        title: `${provider} user idea`,
        body: 'The user asked to remember this idea.',
      },
      actor,
    )
    ids.push(item.id)
    await view
      .getByRole('button', { name: new RegExp(`${provider} user idea`) })
      .first()
      .waitFor()
    assert.ok(
      (await view.innerText()).includes(`Saved by ${provider === 'codex' ? 'Codex' : 'Claude'}`),
    )
    const document = spaces.store.documents().find((d) => d.id === item.id)
    assert.ok(document.path.replaceAll('\\', '/').includes('/notes/'))
    assert.ok(readFileSync(document.path, 'utf8').includes(assignee))
    memory.store.execute(
      {
        action: 'create_item',
        operationId: randomUUID(),
        folderId: folder.id,
        purpose: 'work_context',
        title: `${provider} continuation`,
        body: 'Resume the work here.',
      },
      actor,
    )
  }
  assert.equal(await view.getByText('codex continuation', { exact: true }).count(), 0)
  assert.equal(await view.getByText('claude continuation', { exact: true }).count(), 0)
  assert.equal(memory.store.tasks().length, 0)
  assert.equal(spaces.calls.length, 0)
  await capture('notes-purpose-attribution')
  await page.reload()
  await openHeaderPage(page, 'Shared Spaces')
  await openSpace(page)
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  for (const provider of ['codex', 'claude']) {
    const row = view.getByRole('button', { name: new RegExp(`${provider} user idea`) }).first()
    await row.waitFor()
  }
  assert.equal(spaces.store.all().length, 3)
  assert.deepEqual(
    spaces.store
      .all()
      .filter((n) => n.memoryItem)
      .map((n) => n.id)
      .sort(),
    ids.sort(),
  )
  await view
    .getByRole('button', { name: /claude user idea/ })
    .first()
    .click()
  const claude = spaces.store.all().find((n) => n.title === 'claude user idea')
  assert.ok((await view.innerText()).includes(claude.saver.chatId))
  assert.ok((await view.innerText()).includes('Saved by Claude'))
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  const codex = view.getByRole('button', { name: /codex user idea/ }).first()
  await codex.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await view.getByRole('textbox', { name: 'Note title', exact: true }).fill('Renamed plugin note')
  await view.getByRole('button', { name: 'Save title', exact: true }).click()
  const renamed = view.getByRole('button', { name: /Renamed plugin note/ }).first()
  await renamed.waitFor()
  const record = spaces.store.all().find((n) => n.title === 'Renamed plugin note')
  assert.equal(record.revision, 2)
  assert.equal(record.saver.provider, 'human')
  assert.equal(memory.store.read({}, record.id, 1).revision.saver.provider, 'codex')
  assert.equal(
    memory.store.read({}, record.id).revision.body,
    'The user asked to remember this idea.',
  )
  await renamed.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Discuss', exact: true }).click()
  await view
    .locator('[role="tab"][aria-selected="true"]')
    .filter({ hasText: 'Brainstorm' })
    .waitFor()
  assert.ok(spaces.store.discussions().some((d) => d.noteIds.includes(record.id)))
  assert.equal(spaces.store.all().length, 3)
  assert.equal(spaces.calls.length, 0)
  console.log(
    'PASS: plugin note projection, both saver labels, live update, purpose paths, no dispatch, renderer reload, revision-aware Rename and linked Discuss.',
  )
}
