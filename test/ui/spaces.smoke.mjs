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
  const snapshot = await page.evaluate(() => window.threadlight.getSnapshot())
  const currentRoot = snapshot.currentWorkspace.replace(/^(claude|codex):/, '')
  const currentDrive = currentRoot.match(/^[a-z]:/i)?.[0].toUpperCase() ?? '/'
  const otherRoot = '\\\\?\\D:\\synthetic\\another-project'
  const networkRoot = '\\\\?\\UNC\\synthetic-server\\projects\\network-project'
  const before = proof.store.workspaces().length
  await page.evaluate(
    ({ snapshot, otherRoot, networkRoot }) => {
      window.proof.emit('onSnapshot', {
        ...snapshot,
        allWorkspaces: [
          ...snapshot.allWorkspaces,
          { id: otherRoot, name: 'another-project' },
          { id: networkRoot, name: 'network-project' },
        ],
      })
    },
    { snapshot, otherRoot, networkRoot },
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  const drive = view.getByLabel('Shared Spaces drive', { exact: true })
  const workspace = view.getByLabel('Shared Spaces workspace', { exact: true })
  await view
    .getByRole('heading', { name: 'Keep shared work with its project', exact: true })
    .waitFor()
  await view.getByText(/Choose the project whose ideas, plans, handoffs and results/).waitFor()
  assert.equal(await drive.inputValue(), currentDrive)
  const hasWorkspace = (root) =>
    workspace
      .locator('option')
      .evaluateAll((options, root) => options.some((option) => option.value === root), root)
  assert.equal(await hasWorkspace(otherRoot), false)
  const contentFits = async () => {
    const bounds = await view.boundingBox()
    const body = await view.locator('[class*="_body_"] > [class*="_editor_"]').boundingBox()
    assert.ok(bounds.y + bounds.height >= body.y + body.height - 1, 'setup content is not clipped')
    assert.ok(
      bounds.y + bounds.height <= body.y + body.height + 1,
      'setup has no empty fixed-height area',
    )
    assert.ok(bounds.height < 400, 'setup grows only to fit its text')
  }
  await contentFits()
  await capture('shared-spaces-purpose')
  await drive.selectOption('D:')
  assert.equal(await workspace.inputValue(), '')
  assert.equal(
    await workspace
      .locator('option')
      .evaluateAll((options, root) => options.some((option) => option.value === root), currentRoot),
    false,
  )
  await workspace.selectOption(otherRoot)
  await view
    .getByText(`${otherRoot.replaceAll('\\', '/')}/shared-spaces/`, { exact: true })
    .waitFor()
  await contentFits()
  await capture('shared-spaces-drive-filter')
  await drive.selectOption('//synthetic-server/projects')
  assert.equal(
    await workspace.inputValue(),
    '',
    'changing drive clears the previous workspace choice',
  )
  await workspace.selectOption(networkRoot)
  await view
    .getByText(`${networkRoot.replaceAll('\\', '/')}/shared-spaces/`, { exact: true })
    .waitFor()
  await drive.selectOption('*')
  assert.equal(await hasWorkspace(otherRoot), true)
  assert.equal(await workspace.locator('option[value="@unassigned"]').count(), 1)
  assert.equal(
    proof.store.workspaces().length,
    before,
    'filtering and choosing never create folders',
  )
  await workspace.selectOption('')
  await page.evaluate((snapshot) => window.proof.emit('onSnapshot', snapshot), snapshot)
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  console.log(
    'PASS: content-sized workspace setup, purpose copy, current drive, cross-drive/network filters, destination path and no implicit setup.',
  )
}

export async function checkSpaces(page, proof, memory, capture) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await view
    .getByLabel('Shared Spaces workspace', { exact: true })
    .selectOption({ label: 'shared' })
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
  await view
    .getByLabel('Shared Spaces workspace', { exact: true })
    .selectOption({ label: 'shared' })
  await view.getByRole('tab', { name: 'Ideas', exact: true }).click()
  await view.getByRole('button', { name: /A shared activity recap/ }).click()
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
  const original = proof.store.all()[0]
  const workspace = proof.store.workspace(original.workspaceId)
  assert.equal((await proof.service.request({ action: 'setup', root: proof.secondRoot })).ok, true)
  await view.getByRole('tab', { name: 'Brainstorm', exact: true }).click()
  await view.getByRole('button', { name: /A shared activity recap/ }).click()
  proof.hold()
  await view.getByLabel('Message to Agent').fill('Wait while I inspect another workspace.')
  await view.getByRole('button', { name: 'Discuss with Agent', exact: true }).click()
  await view.getByRole('button', { name: 'Stop brainstorm', exact: true }).waitFor()
  await view.getByLabel('Message to Agent').fill('Unsent draft for the first workspace')
  await view.getByLabel('Shared Spaces drive', { exact: true }).selectOption('*')
  await view.getByLabel('Shared Spaces workspace', { exact: true }).selectOption(proof.secondRoot)
  assert.equal(await view.getByRole('heading', { name: 'A shared activity recap' }).count(), 0)
  await view.getByRole('tab', { name: 'Ideas', exact: true }).click()
  await view.getByLabel('New idea').fill('Only in the second workspace')
  await view.getByRole('button', { name: 'Save idea', exact: true }).click()
  await view.getByRole('button', { name: /Only in the second workspace/ }).waitFor()
  proof.finish()
  assert.equal(
    await view.getByText('Late reply for the original workspace only.', { exact: true }).count(),
    0,
  )
  await capture('shared-spaces-isolated-workspace')
  await view
    .getByLabel('Shared Spaces workspace', { exact: true })
    .selectOption({ label: 'shared' })
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
  await view.getByRole('button', { name: 'Assign existing material', exact: true }).click()
  await view.getByLabel('Migration workspace').selectOption(workspace.id)
  await view.getByLabel('Idea: Older unassigned idea').check()
  await view.getByRole('button', { name: 'Preview migration', exact: true }).click()
  await view.getByText('1 document snapshot', { exact: true }).waitFor()
  await capture('shared-spaces-migration-preview')
  await view.getByRole('button', { name: 'Confirm migration', exact: true }).click()
  await view.getByRole('tab', { name: 'Ideas', exact: true }).click()
  await view.getByRole('button', { name: /Older unassigned idea/ }).waitFor()
  assert.equal(proof.store.get(legacy.id).workspaceId, workspace.id)
  assert.equal(existsSync(proof.store.documents().find((d) => d.id === legacy.id).path), true)
  assert.equal(proof.calls.length, 2)
  // Follow the same workspace as the parent thread view, without a competing picker.
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.locator('header [data-thread-view]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  assert.equal(await view.getByLabel('Shared Spaces workspace', { exact: true }).count(), 0)
  await page.evaluate(async (root) => {
    const snapshot = await window.threadlight.getSnapshot()
    window.proof.emit('onSnapshot', {
      ...snapshot,
      currentWorkspace: root,
      allWorkspaces: [...snapshot.allWorkspaces, { id: root, name: 'second-workspace' }],
    })
  }, proof.secondRoot)
  await view.getByText('second-workspace', { exact: true }).waitFor()
  await view.getByRole('tab', { name: 'Ideas', exact: true }).click()
  await view.getByRole('button', { name: /Only in the second workspace/ }).waitFor()
  assert.equal(await view.getByRole('button', { name: /Older unassigned idea/ }).count(), 0)
  await page.getByRole('button', { name: 'Back in Shared Spaces' }).click()
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      listMode: 'recent',
      focusWorkspace: null,
      combinedFocusWorkspace: null,
    }),
  )
  await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['claude'] }))
  console.log(
    'PASS: fixed workspace setup, capture/reload, migration preview/confirmation, isolated workspaces, late replies, follow-workspace view, and unsent pinned assignments.',
  )
}
