/* global window */
export async function openSpace(page, name = 'shared') {
  const view = page.getByRole('region', { name: 'Shared Spaces', exact: true })
  const all = view.getByRole('button', { name: 'Spaces', exact: true })
  if (await all.count()) await all.click()
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
}
