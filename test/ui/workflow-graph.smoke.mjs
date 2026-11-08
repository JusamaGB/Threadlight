/* global window */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openHeaderPage } from './header-navigation.mjs'
import { setupLegacySpace } from './space-navigation.mjs'

export async function checkWorkflowGraph(page, memory, proof, capture) {
  await page.evaluate(() => {
    window.threadlight.setCanvasExpanded = async (on) => (on ? { width: 700, height: 700 } : null)
  })
  await openHeaderPage(page, 'Shared Spaces')
  await setupLegacySpace(page)
  await page
    .getByRole('region', { name: 'Handoffs', exact: true })
    .getByRole('button', { name: /shared Workspace collaboration/ })
    .click()
  const spaceId = memory.store.snapshot().spaces[0].id
  proof.service.configure(
    {
      id: randomUUID(),
      spaceId,
      revision: 1,
      mode: 'manual',
      paused: false,
      participants: [
        {
          id: randomUUID(),
          target: proof.destinations[0].id,
          role: 'Build',
          model: 'test-model',
          communicate: true,
          requestWork: true,
        },
      ],
      maxConcurrent: 2,
      maxDispatches: 20,
      expiresAt: Date.now() + 3600000,
      recover: false,
      acceptBy: 'human',
    },
    0,
    proof.human,
  )
  memory.execute({
    action: 'update_space',
    id: spaceId,
    mode: 'manual',
    paused: false,
    durationMinutes: 60,
    maxDispatches: 20,
  })
  await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
  const editor = page.getByLabel('Workflow graph editor')
  await editor.getByLabel('Workflow name', { exact: true }).fill('Isolated workflow proof')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(50)
  assert.equal(proof.service.processes.definitions(spaceId)[0].name, 'Isolated workflow proof')
  assert.equal(proof.service.processes.runs().length, 0)
  await editor.getByRole('button', { name: 'Context context', exact: true }).click()
  await editor
    .getByLabel('Step title', { exact: true })
    .fill(
      'A long context title that stays compact and remains readable in the selected configuration',
    )
  await page.getByRole('tab', { name: 'Notes', exact: true }).click()
  await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
  assert.match(
    await editor.getByLabel('Step title', { exact: true }).inputValue(),
    /^A long context/,
  )
  await editor.getByLabel('Step title', { exact: true }).fill('Scoped context')
  await editor.getByText('Inputs · position', { exact: true }).click()
  await editor.getByLabel('Input bindings', { exact: true }).fill('null')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor
    .getByText('Correct the invalid field before saving or running.', { exact: true })
    .waitFor()
  assert.equal(proof.service.processes.definitions(spaceId)[0].revision, 1)
  await editor.getByLabel('Input bindings', { exact: true }).fill('{}')
  await editor.getByText('Inputs · position', { exact: true }).click()
  await editor.getByRole('button', { name: 'Disconnect finish always', exact: true }).click()
  await editor.getByLabel('Connect to', { exact: true }).selectOption('finish')
  await editor.getByRole('button', { name: 'Connect', exact: true }).click()
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(50)
  assert.deepEqual(proof.service.processes.definitions(spaceId)[0].edges, [
    { from: 'context', to: 'finish', route: 'always' },
  ])
  await editor.getByRole('button', { name: 'Fit', exact: true }).click()
  await editor.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) p.scrollTop = 0
  })
  await capture('workflow-compact')
  await page.setViewportSize({ width: 900, height: 900 })
  await page.getByRole('button', { name: 'Expand canvas', exact: true }).click()
  await editor.getByRole('button', { name: 'Fit', exact: true }).click()
  await editor.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) p.scrollTop = 0
  })
  await capture('workflow-expanded')
  const expandedWidth = (await page.locator('[data-card]').boundingBox()).width
  assert.ok(expandedWidth >= 650 && expandedWidth <= 700)
  await page.getByRole('button', { name: 'Restore compact view', exact: true }).click()
  await page.setViewportSize({ width: 460, height: 900 })
  await editor.getByLabel('Step type', { exact: true }).selectOption('wait')
  await editor.getByRole('button', { name: '+ Step', exact: true }).click()
  await editor.getByLabel('Step title', { exact: true }).fill('Wait for review')
  const wait = editor.getByRole('button', { name: 'Wait for review wait', exact: true })
  await wait.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
  assert.equal(await wait.count(), 0)
  assert.equal(proof.service.processes.runs().length, 0)
  const latest = proof.service.processes.definitions(spaceId)[0]
  await proof.service.execute(
    'save_process',
    {
      operationId: randomUUID(),
      expectedRevision: latest.revision,
      definition: { ...latest, revision: latest.revision + 1, name: 'Externally updated workflow' },
    },
    proof.human,
  )
  await page.evaluate(() => window.proof.emit('onCommunication'))
  await editor.getByRole('button', { name: `Load v${latest.revision + 1}`, exact: true }).waitFor()
  assert.equal(
    await editor.getByLabel('Workflow name', { exact: true }).inputValue(),
    'Isolated workflow proof',
  )
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor
    .getByRole('alert')
    .filter({ hasText: /changed/ })
    .waitFor()
  await editor.getByRole('button', { name: `Load v${latest.revision + 1}`, exact: true }).click()
  await editor.getByText('Run authorization', { exact: true }).click()
  await editor.getByRole('button', { name: 'Run', exact: true }).click()
  await editor
    .getByRole('alert')
    .filter({ hasText: /authorization/ })
    .waitFor()
  await editor.getByRole('button', { name: 'Authorize manual', exact: true }).click()
  await editor.getByRole('button', { name: 'Run', exact: true }).click()
  assert.equal(proof.service.processes.runs().length, 1)
  const run = proof.service.processes.runs()[0]
  // Context adapter is intentionally absent in this UI fixture; failure is retained.
  await proof.service.processes.tick()
  await page.evaluate(() => window.proof.emit('onCommunication'))
  await page.getByRole('tab', { name: 'Handoffs', exact: true }).click()
  const canvas = page.getByRole('region', { name: 'Work by objective' })
  await canvas.locator(`[data-work-id="${run.id}"]`).click()
  await page.getByLabel('Workflow run details').waitFor()
  await capture('workflow-needs-you')
  assert.equal(proof.service.processes.runs()[0].status, 'needs_you')
  assert.equal(memory.store.communications.list('message').length, 0)
  console.log(
    'PASS: workflow draft/save, selection retention, compact/expanded graph, keyboard removal, explicit authorization, retained failed run and Handoffs details; zero provider messages.',
  )
}
