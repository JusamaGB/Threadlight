/* global window */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openHeaderPage } from './header-navigation.mjs'
import { setupLegacySpace } from './space-navigation.mjs'

export async function checkHandoffsCanvas(page, memory, spaces, capture) {
  await openHeaderPage(page, 'Shared Spaces')
  await setupLegacySpace(page)
  await page
    .getByRole('region', { name: 'Handoffs', exact: true })
    .getByRole('button', { name: /shared Workspace collaboration/ })
    .click()
  await page.getByText('No work yet', { exact: true }).waitFor()
  const snapshot = memory.store.snapshot(),
    spaceId = snapshot.spaces[0].id
  const folder = memory.execute({
    action: 'ensure_folder',
    spaceId,
    title: 'Results',
    description: 'Isolated outputs',
    reason: 'Canvas proof',
  }).folder
  const item = memory.execute({
    action: 'create_item',
    folderId: folder.id,
    title: 'Pinned evidence',
    body: 'Exact saved output content',
    purpose: 'result',
  })
  const ids = Array.from({ length: 18 }, () => randomUUID()),
    roleId = randomUUID()
  const comm = {
    assignments: ids.map((id, i) => ({
      id,
      spaceId,
      title:
        i === 0
          ? 'Improve onboarding with a very long title showing full content in details'
          : `Work ${i}`,
      brief: `Full brief ${i}`,
      acceptance: 'Review exact output',
      roleId: i % 2 ? 'claude-role' : roleId,
      workflowRevision: 1,
      folderId: folder.id,
      dependsOn: i === 2 ? [ids[0]] : [],
      resources: [],
      inputs: [{ itemId: item.id, revision: 1 }],
      outputs: i === 0 ? [{ itemId: item.id, revision: 1 }] : [],
      state: ['submitted', 'blocked', 'active', 'accepted', 'planned'][i % 5],
      reason: 'Saved status',
      objective: {
        id: i < 8 ? 'onboarding' : 'chats',
        title: i < 8 ? 'Improve onboarding' : 'Improve Chats',
      },
      messageId: i === 4 ? 'uncertain' : undefined,
    })),
    workflows: [
      {
        spaceId,
        participants: [
          { id: roleId, target: 'codex:11111111-1111-4111-8111-111111111111' },
          { id: 'claude-role', target: 'synthetic-claude' },
        ],
      },
    ],
    questions: [
      {
        id: 'question',
        spaceId,
        taskId: ids[2],
        state: 'pending',
        audience: 'human',
        body: 'Review approach?',
        choices: ['Yes'],
        generation: 'g',
      },
    ],
    messages: [
      {
        id: 'uncertain',
        spaceId,
        deliveries: [{ phase: 'unknown', target: 'codex:proof-chat' }],
        body: 'Delivery evidence',
        at: 1,
      },
    ],
    events: [],
    cursor: 0,
    snapshotRequired: false,
  }
  comm.assignments.push({
    ...comm.assignments[0],
    id: randomUUID(),
    spaceId: randomUUID(),
    title: 'Other project work',
  })
  await page.evaluate(
    ({ comm, spaceId }) => {
      window.proof.canvasMutations = []
      window.proof.canvasData = comm
      const previous = window.threadlight.communicationRequest
      window.threadlight.communicationRequest = async (input) => {
        if (input.action === 'get_workflow' && input.arguments.spaceId === spaceId)
          return { ok: true, value: window.proof.canvasData }
        window.proof.canvasMutations.push(input)
        return previous(input)
      }
      window.threadlight.setCanvasExpanded = async (on) => (on ? { width: 700, height: 700 } : null)
      window.proof.emit('onCommunication', comm)
    },
    { comm, spaceId },
  )
  const canvas = page.getByLabel('Work canvas', { exact: true })
  await canvas.waitFor()
  await canvas.locator('[data-work-id]').first().waitFor()
  assert.equal(await canvas.locator('[data-work-id]').count(), 18)
  const transform = () =>
    canvas
      .locator('div')
      .first()
      .evaluate((el) => el.style.transform)
  const initial = await transform()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + 30, box.y + 190)
  await page.mouse.wheel(0, 60)
  await page.waitForTimeout(50)
  assert.notEqual(await transform(), initial)
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click()
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  assert.notEqual(await transform(), initial)
  await page.keyboard.press('Home')
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click()
  const dragBox = await canvas.boundingBox()
  const priorDrag = await transform()
  await page.mouse.move(dragBox.x + dragBox.width - 3, dragBox.y + 180)
  await page.mouse.down()
  await page.mouse.move(dragBox.x + dragBox.width - 23, dragBox.y + 155)
  await page.mouse.up()
  assert.notEqual(await transform(), priorDrag)
  assert.equal(await page.getByText('Full brief 0', { exact: true }).isVisible(), false)
  await page.mouse.move(dragBox.x + 100, dragBox.y + 100)
  await page.keyboard.down('Shift')
  const beforeShift = await transform()
  await page.mouse.wheel(0, 45)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(50)
  assert.notEqual(await transform(), beforeShift)
  await page.keyboard.down('Control')
  const beforeZoom = await transform()
  await page.mouse.wheel(0, -160)
  await page.keyboard.up('Control')
  await page.waitForTimeout(50)
  assert.notEqual(await transform(), beforeZoom)

  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click()
  await capture('handoffs-compact')
  await page.getByRole('button', { name: 'Expand canvas', exact: true }).click()
  await page.setViewportSize({ width: 740, height: 760 })
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await capture('handoffs-square')
  assert.equal(Math.round((await page.locator('[data-card]').boundingBox()).width), 684)
  await page.getByLabel('Find work', { exact: true }).fill('Work 12')
  await page.getByLabel('Find work', { exact: true }).press('Enter')
  await canvas.locator(`[data-work-id="${ids[12]}"]`).press('Enter')
  await page.getByText('Full brief 12', { exact: true }).waitFor()
  await page.getByRole('button', { name: '← Canvas', exact: true }).click()
  await page.getByLabel('Find work', { exact: true }).fill('Improve onboarding with')
  await page.getByLabel('Find work', { exact: true }).press('Enter')
  await canvas.locator(`[data-work-id="${ids[0]}"]`).press('Enter')
  await page.getByText('Review exact output', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Pinned evidence · v1', exact: true }).first().click()
  await page.getByText('Exact saved output content', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  await canvas.waitFor()
  const restored = await transform()
  await page.getByRole('button', { name: 'Restore compact view', exact: true }).click()
  assert.equal(await transform(), restored)
  assert.equal(Math.round((await page.locator('[data-card]').boundingBox()).width), 238)
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  const group = canvas.getByRole('button', { name: /Improve onboarding · 8/ })
  await group.click()
  assert.equal(await canvas.locator('[data-work-id]').count(), 10)
  await group.click()
  assert.equal(await canvas.locator('[data-work-id]').count(), 18)
  await page.getByRole('button', { name: 'Needs attention', exact: true }).click()
  assert.ok(await canvas.locator('[data-selected]').count())
  const before = await transform()
  await page.evaluate(() => {
    window.proof.canvasData.assignments[1].state = 'accepted'
    window.proof.emit('onCommunication', window.proof.canvasData)
  })
  await page.waitForTimeout(50)
  assert.equal(await transform(), before)
  assert.equal((await page.evaluate(() => window.proof.canvasMutations)).length, 0)
  const discussionId = randomUUID()
  const created = await spaces.service.request({
    action: 'create_discussion',
    id: discussionId,
    spaceId,
    title: 'Prepared objective',
    noteIds: [],
  })
  assert.equal(created.ok, true)
  const task = memory.execute({
    action: 'create_task',
    folderId: folder.id,
    title: 'Prepared legacy task',
    body: 'Full task brief',
    assignee: 'synthetic-claude',
    inputs: [{ itemId: item.id, revision: 1 }],
  })
  spaces.store.prepared(discussionId, { folderId: folder.id, taskIds: [task.id] })
  await page.evaluate(
    (snapshot) => window.proof.emit('onSpaces', snapshot),
    spaces.service.snapshot(),
  )
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await canvas.locator(`[data-work-id="${task.id}"]`).press('Enter')
  await page.getByText('Full task brief', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  assert.equal(await canvas.locator('[data-selected]').getAttribute('data-work-id'), task.id)
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await page.getByRole('button', { name: 'Open Prepared objective source', exact: true }).click()
  await page.getByText('Discussion details', { exact: true }).click()
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Prepared objective')
  assert.equal(spaces.calls.length, 0)
  await page.getByRole('tab', { name: 'Handoffs', exact: true }).click()
  const beforeAppend = await transform()
  await page.evaluate(() => {
    const data = window.proof.canvasData
    data.assignments.push(
      ...Array.from({ length: 100 }, (_, i) => ({
        ...data.assignments[0],
        id: `large-${i}`,
        title: `Additional work ${i}`,
        state: 'planned',
      })),
    )
    window.proof.emit('onCommunication', data)
  })
  await page.waitForFunction(
    () => window.document.querySelectorAll('[data-work-id]').length === 119,
  )
  assert.equal(await transform(), beforeAppend)
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  const zoom = Number(
    (await page.getByRole('button', { name: 'Reset zoom', exact: true }).textContent()).replace(
      '%',
      '',
    ),
  )
  assert.ok(zoom < 25 && zoom >= 2)
  await page.getByRole('tab', { name: 'Workflow', exact: true }).click()
  await page.getByRole('button', { name: 'Expand canvas', exact: true }).click()
  assert.equal(Math.round((await page.locator('[data-card]').boundingBox()).width), 684)
  await page.getByRole('button', { name: 'Restore compact view', exact: true }).click()
  assert.equal(Math.round((await page.locator('[data-card]').boundingBox()).width), 238)
}
