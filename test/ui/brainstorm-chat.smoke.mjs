/* global document, getComputedStyle */
import assert from 'node:assert/strict'
import { openHeaderPage } from './header-navigation.mjs'
import { openSpace } from './space-navigation.mjs'

export async function checkBrainstormChat(page, proof, capture) {
  await openHeaderPage(page, 'Shared Spaces')
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await view.getByRole('button', { name: 'Create a space', exact: true }).click()
  await view.getByLabel('Space name').fill('Threadlight chat')
  await view.getByRole('button', { name: 'Create space', exact: true }).click()
  const chat = view.getByRole('region', { name: 'Brainstorm chat', exact: true })
  const message = chat.getByRole('textbox', { name: 'Message to Agent', exact: true })
  await message.waitFor()
  assert.equal(
    await chat.locator('[data-agent-conversation]').count(),
    1,
    'uses the ordinary AgentView',
  )
  assert.equal(await message.getAttribute('placeholder'), 'Ask your agent…')
  assert.equal(
    await chat
      .getByRole('button', { name: 'Start Agent voice', exact: true })
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
    '0px',
    'Spaces form styles do not override the shared Agent UI',
  )
  assert.equal(
    await chat
      .getByRole('button', { name: 'Start Agent voice', exact: true })
      .getAttribute('title'),
    'Start Agent voice (Ctrl+Alt+B)',
  )
  assert.equal(proof.store.discussions().length, 0)
  assert.equal(proof.calls.length, 0)
  await capture('brainstorm-empty-composer')
  await message.fill('Make the first idea easy to capture')
  await message.press('Enter')
  await chat
    .getByText(
      'Start with one shared activity summary. Show blockers and link to the original chat.',
      { exact: true },
    )
    .waitFor()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Message to Agent"]')?.value === '',
  )
  assert.equal(proof.store.discussions().length, 1)
  assert.equal(proof.calls.length, 1)
  const first = proof.store.discussions()[0].id
  await message.fill('Unsent follow-up for the first chat')
  await message.evaluate((el) => el.setSelectionRange(2, 8))
  await view.getByRole('tab', { name: 'Notes', exact: true }).click()
  await view.getByRole('tab', { name: 'Brainstorm', exact: true }).click()
  assert.equal(await message.inputValue(), 'Unsent follow-up for the first chat')
  assert.deepEqual(await message.evaluate((el) => [el.selectionStart, el.selectionEnd]), [2, 8])
  await chat.getByRole('button', { name: 'End', exact: true }).click()
  await message.waitFor()
  assert.equal(await message.inputValue(), '')
  await message.fill('Separate new-chat draft')
  await chat.getByRole('button', { name: 'Earlier · 1', exact: true }).click()
  await chat.getByRole('button', { name: /Codex · Make the first idea easy to capture/ }).click()
  await chat.getByRole('button', { name: 'Continue', exact: true }).click()
  assert.equal(await message.inputValue(), 'Unsent follow-up for the first chat')
  assert.equal(proof.calls.length, 1, 'reading and resuming history sends no message')
  await capture('brainstorm-resumed-composer')
  await page.reload()
  await openHeaderPage(page, 'Shared Spaces')
  await openSpace(page, 'Threadlight chat')
  await message.waitFor()
  assert.equal(await message.inputValue(), 'Unsent follow-up for the first chat')
  assert.equal(proof.store.discussions()[0].id, first)
  await chat.getByRole('button', { name: 'End', exact: true }).click()
  assert.equal(await message.inputValue(), 'Separate new-chat draft')
  await message.fill('Keep this idea if the provider is unavailable')
  const send = proof.service.agent.send
  proof.service.agent.send = async () => ({ ok: false, reason: 'Synthetic provider unavailable' })
  await message.press('Enter')
  await chat.getByRole('alert').filter({ hasText: 'Synthetic provider unavailable' }).waitFor()
  assert.equal(await message.inputValue(), 'Keep this idea if the provider is unavailable')
  assert.equal(proof.store.discussions().length, 2)
  proof.service.agent.send = send
  await capture('brainstorm-failed-send-draft')
  console.log(
    'PASS: shared AgentView, Enter sending, first-message creation, Earlier/Continue, End, separate drafts, caret restoration, reload resumption and failed-send retention.',
  )
}
