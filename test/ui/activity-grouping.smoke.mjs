/* global window */
import assert from 'node:assert/strict'

export async function revealActivity(conversation, id) {
  const group = conversation.locator(`details[data-message-id]:has([data-activity-id="${id}"])`)
  await group.waitFor({ state: 'attached' })
  if ((await group.getAttribute('open')) === null) await group.locator(':scope > summary').click()
  return group
}

export async function checkActivityGrouping(page, conversation, capture) {
  await page.evaluate(() => {
    window.proof.beforeGrouping = window.proof.timeline.items
    const base = window.proof.timeline.items.find((item) => item.activity === 'files')
    const edit = (id, text) => ({ ...base, id, text, turnId: 'grouping', complete: true })
    const command = (id, failed = false) => ({
      ...base,
      id,
      text: 'Ran focused checks',
      activity: 'command',
      fileChanges: undefined,
      fileCount: undefined,
      detail: 'Focused checks output',
      turnId: 'grouping',
      complete: true,
      failed,
    })
    window.proof.timelineUpdate({
      items: [
        edit('group-edit-1', 'Edited 2 files'),
        edit('group-edit-2', 'Edited 1 file'),
        command('group-command', true),
        { ...command('group-heading'), activity: 'status', text: 'Checking the changes' },
        {
          ...base,
          id: 'group-comment',
          role: 'assistant',
          kind: 'message',
          activity: undefined,
          text: 'The first changes are in place. Checking the next part.',
          fileChanges: undefined,
          fileCount: undefined,
          turnId: 'grouping',
          complete: true,
        },
        edit('group-edit-after-comment', 'Edited 1 file'),
        command('group-command-after-comment'),
      ],
    })
  })
  const groups = conversation.locator('details[data-message-id]')
  const first = conversation.locator('details[data-message-id="group-edit-1"]')
  await first
    .locator(':scope > summary')
    .filter({ hasText: 'Edited files, ran a command · Failed' })
    .waitFor()
  assert.equal(await groups.count(), 2, 'only the assistant message separates consecutive activity')
  assert.equal(
    await conversation
      .getByText('The first changes are in place. Checking the next part.', { exact: true })
      .isVisible(),
    true,
  )
  assert.equal(
    await conversation.locator('section[data-message-id="group-edit-1"]').isVisible(),
    false,
  )
  await first.locator(':scope > summary').focus()
  await page.keyboard.press('Enter')
  await conversation.locator('section[data-message-id="group-edit-2"]').waitFor()
  assert.equal(await first.locator('[data-activity-id]').count(), 4)
  assert.equal(await first.getByRole('button', { name: 'View', exact: true }).count(), 2)
  await capture('smart-activity-group-expanded')
  await page.evaluate(() => {
    window.proof.groupingNode = window.document.querySelector(
      'details[data-message-id="group-edit-1"]',
    )
    const items = [...window.proof.timeline.items]
    items.splice(4, 0, {
      ...items[0],
      id: 'group-edit-3',
      text: 'Editing 2 files',
      complete: false,
    })
    window.proof.timelineUpdate({ items })
  })
  await conversation.locator('section[data-message-id="group-edit-3"]').waitFor()
  assert.equal(await first.getAttribute('open'), '', 'live edits retain the expanded stack')
  assert.equal(
    await page.evaluate(
      () =>
        window.proof.groupingNode ===
        window.document.querySelector('details[data-message-id="group-edit-1"]'),
    ),
    true,
  )
  await first.locator(':scope > summary').click()
  await capture('smart-activity-group-collapsed')
  await page.evaluate(() => {
    window.proof.timelineUpdate({ items: window.proof.beforeGrouping })
    delete window.proof.beforeGrouping
    delete window.proof.groupingNode
  })
  console.log(
    'PASS: adjacent edits, commands and headings share a stack; commentary splits it; recorded View actions and live expansion remain available.',
  )
}
