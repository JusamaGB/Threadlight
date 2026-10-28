/* global window */
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { openHeaderPage } from './header-navigation.mjs'

export async function checkProjectParticipants(page, memory, spaces, chats, capture) {
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await openHeaderPage(page, 'Shared Spaces')
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await view.getByRole('button', { name: 'Create a space', exact: true }).click()
  await view.getByLabel('Space name', { exact: true }).fill('Threadlight project')
  await view.getByRole('button', { name: 'Create space', exact: true }).click()
  await view.getByRole('tab', { name: 'Chats', exact: true }).click()
  const team = view.getByRole('region', { name: 'Project participants', exact: true })
  await team.getByText('No participants yet. Connect a chat to begin.', { exact: true }).waitFor()
  const spaceId = spaces.store.locations()[0].spaceId
  const pairs = []
  for (const provider of ['claude', 'codex']) {
    const request = {
      action: 'request',
      id: randomUUID(),
      secret: randomBytes(32).toString('hex'),
      provider,
      label: `Synthetic ${provider}`,
    }
    memory.connections.request(request)
    memory.connections.approve(request.id, {
      action: 'create_grant',
      spaceId,
      assignee: chats[provider].id,
      title: `Synthetic ${provider}`,
      readOnly: false,
    })
    const actor = memory.connections.authenticate(request.id, request.secret)
    memory.store.execute(
      {
        action: 'report_capabilities',
        operationId: randomUUID(),
        capabilities: [
          {
            kind: 'tool',
            name: provider === 'codex' ? 'Browser automation' : 'Image design',
            description:
              provider === 'codex' ? 'Inspect browser screenshots' : 'Design illustrations',
          },
          { kind: 'skill', name: 'Review', description: 'Review implementation results' },
          { kind: 'plugin', name: 'Threadlight', description: 'Shared project records' },
          {
            kind: 'role',
            name: provider === 'codex' ? 'Browser reviewer' : 'Designer',
            description: 'Project participant',
          },
        ],
      },
      actor,
    )
    pairs.push(request)
  }
  await team.getByRole('heading', { name: 'Synthetic Codex', exact: true }).waitFor()
  const codex = team
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Synthetic Codex', exact: true }) })
  await codex.getByText('Chat reported · 4 capabilities', { exact: true }).click()
  await codex.getByText('Browser automation', { exact: true }).waitFor()
  await capture('project-participants')
  await codex.getByText('Record verification', { exact: true }).first().click()
  await codex
    .getByLabel('Verification evidence for Browser automation', { exact: true })
    .fill('Inspected browser interaction and screenshot output in this project.')
  await codex.getByRole('button', { name: 'Save verification', exact: true }).click()
  await codex.getByText('tool · Human verified', { exact: true }).waitFor()
  await capture('project-capability-verified')
  await codex
    .getByRole('button', { name: 'Record capabilities for Synthetic Codex', exact: true })
    .click()
  await codex
    .getByLabel('role capabilities', { exact: true })
    .fill('Browser testing — Inspect browser screenshots')
  await page.evaluate(() => {
    const original = window.threadlight.memoryRequest
    let lose = true
    window.threadlight.memoryRequest = async (input) => {
      const result = await original(input)
      if (input.action === 'report_capabilities' && lose) {
        lose = false
        throw new Error('Synthetic lost report response')
      }
      return result
    }
  })
  await codex.getByRole('button', { name: 'Save capability report', exact: true }).click()
  await team.getByText('Synthetic lost report response', { exact: true }).waitFor()
  await codex.getByRole('button', { name: 'Save capability report', exact: true }).click()
  await team.getByText('Capability report saved.', { exact: true }).waitFor()
  assert.equal(
    memory.store.snapshot().capabilityReports.filter((r) => r.source === 'manual').length,
    1,
  )
  await codex.getByText('Manually recorded · 1 capabilities', { exact: true }).click()
  await codex.getByText('role · Unverified', { exact: true }).first().waitFor()
  await capture('project-capability-manual')

  await view.getByRole('tab', { name: 'Ideas', exact: true }).click()
  await view.getByLabel('New idea', { exact: true }).fill('Inspect browser screenshots')
  await view.getByRole('button', { name: 'Save idea', exact: true }).click()
  await view.getByRole('button', { name: /Inspect browser screenshots/ }).click()
  await view.getByRole('button', { name: 'Move to Brainstorm', exact: true }).click()
  await view
    .getByLabel('Message to Agent', { exact: true })
    .fill('Which chat should inspect the browser?')
  await view.getByRole('button', { name: 'Discuss with Agent', exact: true }).click()
  await view.getByRole('button', { name: 'Use latest reply as draft plan', exact: true }).waitFor()
  assert.match(spaces.calls.at(-1), /Browser automation/)
  assert.match(spaces.calls.at(-1), /human review/)
  assert.equal(memory.store.tasks().length, 0)
  await view
    .getByLabel('Mini plan', { exact: true })
    .fill('Inspect the browser screenshots and record findings.')
  await view.getByRole('button', { name: 'Add assignment', exact: true }).click()
  const assignment = view.getByRole('group', { name: 'Assignment 1', exact: true })
  await assignment.getByLabel('Task', { exact: true }).fill('Inspect browser screenshots')
  await assignment
    .getByLabel('Brief and acceptance criteria', { exact: true })
    .fill('Inspect the browser screenshots and save findings.')
  await assignment.getByText('Suggested chats', { exact: true }).click()
  await assignment.getByRole('button', { name: 'Use Synthetic Codex', exact: true }).waitFor()
  assert.equal(
    await assignment.getByRole('button', { name: 'Use Synthetic Claude', exact: true }).count(),
    0,
  )
  await capture('project-assignment-suggestion')
  await assignment.getByRole('button', { name: 'Use Synthetic Codex', exact: true }).click()
  assert.equal(
    await assignment.getByLabel('Destination chat', { exact: true }).inputValue(),
    chats.codex.id,
  )
  assert.match(
    await assignment.getByLabel('Assignment rationale', { exact: true }).inputValue(),
    /Browser automation/,
  )
  await view.getByRole('button', { name: 'Save plan and choices', exact: true }).click()
  const output = memory.store
    .snapshot()
    .folders.find((f) => f.spaceId === spaceId && f.title === 'Results')
  await view.getByLabel('Shared destination').selectOption(output.id)
  await view.getByRole('button', { name: 'Prepare assignments for review', exact: true }).click()
  await view
    .getByRole('button', { name: 'Inspect browser screenshots · draft', exact: true })
    .waitFor()
  const task = memory.store.tasks()[0]
  assert.equal(task.state, 'draft')
  assert.match(task.body, /Assignment rationale/)
  assert.equal(memory.store.snapshot().spaces.find((s) => s.id === spaceId).paused, true)
  await capture('project-reviewed-handoff')
  await view.getByRole('tab', { name: 'Chats', exact: true }).click()
  memory.connections.reject(pairs[1].id)
  await team.getByText(/Codex · Reconnect from chat/).waitFor()
  await capture('project-reconnect')
  const overflow = await team.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  assert.equal(overflow, false, 'participants fit the thin panel')
  console.log(
    'PASS: project participants, reports, verification, lost-response retry, scoped Brainstorm context, suggestions, reviewed draft handoffs and revocation; no native navigation.',
  )
}
