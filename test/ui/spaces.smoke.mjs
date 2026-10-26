/* global window */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function setupSpaces(
  page,
  { SpacesStore, SpacesService },
  memory,
  directory,
  chats,
  settings,
) {
  const store = new SpacesStore(join(directory, 'ideas.sqlite'))
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
  )
  const histories = new Map()
  const calls = []
  // Only the provider boundary is synthetic. Persistence, preparation and UI use real code.
  service.agent.send = async (text) => {
    calls.push(text)
    const previous = service.agent.current
    const id =
      previous.ended || !previous.conversationId ? 'codex:' + randomUUID() : previous.conversationId
    const items = [
      ...(histories.get(id) ?? []),
      { kind: 'you', text },
      {
        kind: 'agent',
        text: 'Start with one shared activity summary. Show blockers and link to the original chat.',
      },
    ]
    histories.set(id, items)
    service.agent.publish({
      ...previous,
      conversationId: id,
      sessionId: id.slice(6),
      provider: 'codex',
      model: 'Synthetic brainstorm',
      ended: false,
      status: 'ready',
      items,
    })
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
  return { store, calls, close: () => store.close() }
}

export async function checkSpaces(page, proof, memory, capture) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  assert.equal(await page.getByRole('button', { name: 'Back in Shared Spaces' }).count(), 1)
  assert.equal(await page.getByText('Memory spaces', { exact: true }).count(), 0)
  await view.getByRole('tab', { name: 'Ideas', exact: true }).click()
  await view.getByLabel('New idea', { exact: true }).fill('A shared activity recap')
  await view.getByRole('button', { name: 'Save idea', exact: true }).click()
  await view.getByRole('button', { name: /A shared activity recap/ }).waitFor()
  assert.equal(proof.calls.length, 0)
  await capture('shared-spaces-ideas')
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await view.getByRole('tab', { name: 'Ideas', exact: true }).click()
  await view.getByRole('button', { name: 'Move to Brainstorm', exact: true }).click()
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
  assert.equal(proof.store.all()[0].prepared.taskIds.length, 2)
  assert.equal(
    memory
      .tasks()
      .filter((t) => proof.store.all()[0].prepared.taskIds.includes(t.id))
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
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['claude'] }))
  console.log(
    'PASS: Shared Spaces capture/reload, per-idea brainstorm, reviewed Claude/Codex split, unsent pinned assignments and single-header navigation.',
  )
}
