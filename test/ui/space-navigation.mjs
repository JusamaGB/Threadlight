/* global window */
export async function openSpace(page, name = 'shared') {
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  const library = view.getByRole('button', { name: 'Create a space', exact: true })
  for (let depth = 0; depth < 16 && !(await library.isVisible()); depth++)
    await page.getByRole('button', { name: 'Back in Shared Spaces', exact: true }).click()
  await library.waitFor()
  await view
    .getByRole('button')
    .filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) })
    .click()
}

export async function setupLegacySpace(page) {
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    const result = await window.threadlight.spacesRequest({
      action: 'setup',
      root: snapshot.currentWorkspace.replace(/^(claude|codex):/, ''),
    })
    if (!result.ok) throw new Error(result.reason)
  })
  await openSpace(page)
  await page.getByRole('tab', { name: 'Handoffs', exact: true }).click()
}
