import assert from 'node:assert/strict'
import { openHeaderPage } from './header-navigation.mjs'
import { setupLegacySpace } from './space-navigation.mjs'

export async function checkSourceReview(page, spaces, memory) {
  await openHeaderPage(page, 'Shared Spaces')
  await setupLegacySpace(page)
  const space = memory.store.snapshot().spaces[0]
  const folder = memory.execute({
    action: 'ensure_folder',
    spaceId: space.id,
    title: 'Review samples',
    description: 'Synthetic source',
    reason: 'File review',
  }).folder
  memory.store.importAttachment(
    folder.id,
    'booking.py',
    'text/plain',
    Buffer.from('def book(date):\r\n    return bool(date)\r\n'),
  )
  const handoffs = page.getByRole('region', { name: 'Handoffs', exact: true })
  await handoffs.getByRole('button', { name: /shared Workspace collaboration/ }).click()
  await handoffs.getByText('Folders & controls', { exact: true }).click()
  await handoffs.getByRole('button', { name: /Review samples/ }).click()
  await handoffs.getByRole('button', { name: /booking\.py/ }).click()
  await handoffs.getByRole('button', { name: 'Explain this file' }).click()
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  await view
    .getByText('Start with one shared activity summary.', { exact: false })
    .first()
    .waitFor()
    .catch(async (error) => {
      throw new Error(
        `${error.message}\nDiscussion ${JSON.stringify(spaces.store.discussions().map((d) => ({ title: d.title, pinned: !!d.sourcePin })))}. Agent calls ${spaces.calls.length}. View: ${await view.innerText()}`,
      )
    })
  const discussion = spaces.store.discussions().find((d) => d.sourcePin)
  assert.equal(discussion.sourcePin.filename, 'booking.py')
  const scope = spaces.service.context.open(discussion.id)
  try {
    const result = await spaces.service.context.call(scope, 'threadlight_read_code_page', {})
    assert.deepEqual(result.lines, ['def book(date):', '    return bool(date)'])
  } finally {
    spaces.service.context.close(scope)
  }
  const agent = spaces.service.agent
  agent.publish({
    ...agent.current,
    items: [...agent.current.items, { kind: 'agent', text: 'See L1-L2.' }],
  })
  await view.getByText(/Lines 1–2 of 2 returned/).waitFor()
  const link = view.getByRole('button', { name: 'L1-L2', exact: true })
  await link.focus()
  await link.press('Enter')
  await view.locator('code').filter({ hasText: '2      return bool(date)' }).waitFor()
  assert.equal(await link.getAttribute('aria-expanded'), 'true')
  await link.press('Enter')
  assert.equal(await link.getAttribute('aria-expanded'), 'false')
  console.log(
    'PASS: explain a shared attachment, return its pinned lines, open and close a keyboard citation.',
  )
}
