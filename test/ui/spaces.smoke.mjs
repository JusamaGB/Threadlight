import { openHeaderPage } from './header-navigation.mjs'
import { openSpace } from './space-navigation.mjs'
/* global window */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'

export async function setupSpaces(
  page,
  { SpacesStore, SpacesService },
  memory,
  directory,
  chats,
  settings,
) {
  const store = new SpacesStore(join(directory, 'ideas.sqlite'))
  const secondRoot = join(directory, 'second-workspace')
  mkdirSync(secondRoot)
  const service = new SpacesService(
    store,
    () => memory,
    () => Object.values(chats),
    {
      workspace: join(directory, 'agent'),
      index: join(directory, 'agent.json'),
      claudeProjects: directory,
      settings,
      snapshot: () => ({
        sessions: [],
        workspaces: [],
        allWorkspaces: [],
        currentWorkspace: null,
        currentThreadId: null,
      }),
      cli: async () => null,
      onChange: () => {},
      onRateLimit: () => {},
    },
    (data) => {
      void page.evaluate((data) => window.proof?.emit('onSpaces', data), data).catch(() => {})
    },
    () => [...Object.values(chats).map((s) => s.cwd), secondRoot],
  )
  const histories = new Map()
  const calls = []
  let holdNext = false
  // Only the provider boundary is synthetic. Persistence, preparation and UI use real code.
  service.agent.send = async (text) => {
    calls.push(text)
    const previous = service.agent.current
    const id =
      previous.ended || !previous.conversationId ? 'codex:' + randomUUID() : previous.conversationId
    const items = [
      ...(histories.get(id) ?? []),
      { kind: 'you', text },
      ...(!holdNext
        ? [
            {
              kind: 'agent',
              text: 'Start with one shared activity summary. Show blockers and link to the original chat.',
            },
          ]
        : []),
    ]
    histories.set(id, items)
    service.agent.publish({
      ...previous,
      conversationId: id,
      sessionId: id.slice(6),
      provider: 'codex',
      model: 'Synthetic brainstorm',
      ended: false,
      status: holdNext ? 'working' : 'ready',
      items,
    })
    holdNext = false
    return { ok: true }
  }
  service.agent.read = async (id) => ({ items: histories.get(id) ?? [], cursor: null })
  service.agent.resume = async (id) => {
    service.agent.publish({
      ...service.agent.current,
      conversationId: id,
      ended: false,
      status: 'ready',
      items: histories.get(id) ?? [],
    })
    return { ok: true }
  }
  await page.exposeFunction('mockSpaces', (input) => service.request(input))
  return {
    store,
    service,
    secondRoot,
    calls,
    hold: () => {
      holdNext = true
    },
    finish: () => {
      const current = service.agent.current
      const items = [
        ...current.items,
        { kind: 'agent', text: 'Late reply for the original workspace only.' },
      ]
      histories.set(current.conversationId, items)
      service.agent.publish({ ...current, status: 'ready', items })
    },
    close: () => store.close(),
  }
}

export async function checkSpacesSetup(page, proof, capture) {
  const before = proof.store.workspaces().length
  await openHeaderPage(page, 'Shared Spaces')
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await view.getByRole('heading', { name: 'Your shared spaces' }).waitFor()
  assert.equal(await view.getByLabel('Shared Spaces workspace').count(), 0)
  await capture('shared-spaces-library')
  await view.getByRole('button', { name: 'Create a space', exact: true }).click()
  await view.getByLabel('Space name').fill('A new space')
  await view.getByLabel('Shared Spaces workspace').waitFor()
  assert.equal(proof.store.workspaces().length, before)
  await capture('shared-spaces-create')
  await view.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  console.log(
    'PASS: spaces-first landing, explicit creation, workspace selection only in creation, and cancellation without folders.',
  )
}

export async function checkSpaces(page, proof, memory, capture) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  if (!(await page.getByRole('region', { name: 'Shared Spaces', exact: true }).isVisible()))
    await openHeaderPage(page, 'Shared Spaces')
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await openSpace(page)
  assert.equal(await page.getByRole('button', { name: 'Back in Shared Spaces' }).count(), 1)
  assert.equal(await page.getByText('Memory spaces', { exact: true }).count(), 0)
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByLabel('New note', { exact: true }).fill('A shared activity recap')
  await view.getByRole('button', { name: 'Save note', exact: true }).click()
  await view.getByRole('button', { name: /A shared activity recap/ }).waitFor()
  assert.equal(proof.calls.length, 0)
  await capture('shared-spaces-ideas')
  await page.reload()
  await openHeaderPage(page, 'Shared Spaces')
  await openSpace(page)
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('button', { name: /A shared activity recap/ }).click()
  await view.getByRole('button', { name: 'Discuss in Brainstorm', exact: true }).click()
  await view.getByRole('heading', { name: 'A shared activity recap' }).waitFor()
  assert.equal(proof.calls.length, 0)
  await view
    .getByLabel('Message to Agent', { exact: true })
    .fill('What is the smallest useful version?')
  await view.getByRole('button', { name: 'Discuss with Agent', exact: true }).click()
  await view
    .getByText(
      'Start with one shared activity summary. Show blockers and link to the original chat.',
      { exact: true },
    )
    .waitFor()
  assert.equal(proof.calls.length, 1)
  await view.getByRole('button', { name: 'Use latest reply as draft plan' }).click()
  await view.getByRole('button', { name: 'Add assignment' }).click()
  let assignment = view.getByRole('group', { name: 'Assignment 1', exact: true })
  await assignment.getByLabel('Destination chat').selectOption('synthetic-claude')
  await view.getByRole('button', { name: 'Add assignment' }).click()
  assignment = view.getByRole('group', { name: 'Assignment 2', exact: true })
  await assignment.getByLabel('Task', { exact: true }).fill('Review implementation')
  await assignment.getByLabel('Provider', { exact: true }).selectOption('codex')
  await assignment
    .getByLabel('Destination chat')
    .selectOption('codex:11111111-1111-4111-8111-111111111111')
  await assignment
    .getByLabel('Brief and acceptance criteria')
    .fill('Review the completed change after the build handoff. Record issues and validation.')
  await view.getByRole('button', { name: 'Save plan and choices', exact: true }).click()
  await view
    .getByRole('button', { name: 'Save plan and choices', exact: true })
    .waitFor({ state: 'visible' })
  const folder = memory.snapshot().folders.find((f) => f.title === 'Research')
  await view.getByLabel('Shared destination').selectOption(folder.id)
  await capture('shared-spaces-assignments')
  await view.getByRole('button', { name: 'Prepare assignments for review' }).click()
  await view.getByRole('button', { name: 'Review implementation · draft' }).waitFor()
  assert.equal(proof.store.discussions()[0].prepared.taskIds.length, 2)
  assert.equal(
    memory
      .tasks()
      .filter((t) => proof.store.discussions()[0].prepared.taskIds.includes(t.id))
      .every((t) => t.state === 'draft'),
    true,
  )
  await view.getByRole('button', { name: 'Review implementation · draft' }).click()
  await view
    .getByText(
      'Review the completed change after the build handoff. Record issues and validation.',
      { exact: true },
    )
    .waitFor()
  assert.equal(
    await view.getByRole('tab', { name: 'Handoffs' }).getAttribute('aria-selected'),
    'true',
  )
  await capture('shared-spaces-handoff')
  assert.equal(proof.calls.length, 1)
  const original = proof.store.discussions()[0]
  const workspace = proof.store.workspace(original.workspaceId)
  assert.equal((await proof.service.request({ action: 'setup', root: proof.secondRoot })).ok, true)
  await view.getByRole('tab', { name: 'Brainstorm', exact: true }).click()
  await view.getByRole('button', { name: /A shared activity recap/ }).click()
  proof.hold()
  await view.getByLabel('Message to Agent').fill('Wait while I inspect another workspace.')
  await view.getByRole('button', { name: 'Discuss with Agent', exact: true }).click()
  await view.getByRole('button', { name: 'Stop brainstorm', exact: true }).waitFor()
  await view.getByLabel('Message to Agent').fill('Unsent draft for the first workspace')
  await openSpace(page, 'second-workspace')
  assert.equal(await view.getByRole('heading', { name: 'A shared activity recap' }).count(), 0)
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByLabel('New note').fill('Only in the second workspace')
  await view.getByRole('button', { name: 'Save note', exact: true }).click()
  await view.getByRole('button', { name: /Only in the second workspace/ }).waitFor()
  proof.finish()
  assert.equal(
    await view.getByText('Late reply for the original workspace only.', { exact: true }).count(),
    0,
  )
  await capture('shared-spaces-isolated-workspace')
  await openSpace(page)
  assert.equal(await view.getByRole('button', { name: /Only in the second workspace/ }).count(), 0)
  await view.getByRole('tab', { name: 'Brainstorm', exact: true }).click()
  await view.getByRole('button', { name: /A shared activity recap/ }).click()
  await view.getByText('Late reply for the original workspace only.', { exact: true }).waitFor()
  assert.equal(
    await view.getByLabel('Message to Agent').inputValue(),
    'Unsent draft for the first workspace',
  )
  assert.equal(proof.store.get(original.id).workspaceId, workspace.id)
  const legacy = proof.store.edit({
    action: 'create',
    id: randomUUID(),
    title: 'Older unassigned idea',
    text: 'Keep the existing identity.',
  })
  await proof.service.request({ action: 'list' })
  await view.getByText('Advanced', { exact: true }).click()
  await view.getByRole('button', { name: 'Assign existing material', exact: true }).click()
  await view.getByLabel('Migration workspace').selectOption(workspace.id)
  await view.getByLabel('Idea: Older unassigned idea').check()
  await view.getByRole('button', { name: 'Preview migration', exact: true }).click()
  await view.getByText('1 document snapshot', { exact: true }).waitFor()
  await capture('shared-spaces-migration-preview')
  await view.getByRole('button', { name: 'Confirm migration', exact: true }).click()
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('button', { name: /Older unassigned idea/ }).waitFor()
  assert.equal(proof.store.get(legacy.id).workspaceId, workspace.id)
  assert.equal(existsSync(proof.store.documents().find((d) => d.id === legacy.id).path), true)
  assert.equal(proof.calls.length, 2)
  // The space library remains independent of the parent thread-view workspace.
  await view.getByRole('button', { name: 'Spaces', exact: true }).click()
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.locator('header [data-thread-view]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Workspace', exact: true }).click()
  await openHeaderPage(page, 'Shared Spaces')
  assert.equal(await view.getByLabel('Shared Spaces workspace', { exact: true }).count(), 0)
  await page.evaluate(async (root) => {
    const snapshot = await window.threadlight.getSnapshot()
    window.proof.emit('onSnapshot', {
      ...snapshot,
      currentWorkspace: root,
      allWorkspaces: [...snapshot.allWorkspaces, { id: root, name: 'second-workspace' }],
    })
  }, proof.secondRoot)
  await openSpace(page, 'second-workspace')
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('button', { name: /Only in the second workspace/ }).waitFor()
  assert.equal(await view.getByRole('button', { name: /Older unassigned idea/ }).count(), 0)
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      listMode: 'recent',
      focusWorkspace: null,
      combinedFocusWorkspace: null,
    }),
  )
  await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['claude'] }))
  console.log(
    'PASS: fixed workspace setup, capture/reload, migration preview/confirmation, isolated workspaces, late replies, explicit space navigation, and unsent pinned assignments.',
  )
}
