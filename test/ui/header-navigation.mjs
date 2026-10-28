/* global window */
/** Exercise the public header entry point, including from nested pages. */
export async function openHeaderPage(page, name) {
  await page.locator('header[aria-label="Panel header"]').click({ button: 'right' })
  await page
    .getByRole('menu', { name: 'Header menu', exact: true })
    .getByRole('menuitem', {
      name:
        name === 'Agent' ? /^Agent(?: · working)?$/ : name === 'Shared Spaces' ? 'Spaces' : name,
      exact: true,
    })
    .click()
}

/** Select list views through the header cycle; All remains a saved list setting. */
export async function selectThreadView(page, mode) {
  if (mode === 'all') {
    await selectThreadView(page, 'recent')
    await page.evaluate(() => window.threadlight.updateSettings({ listMode: 'all' }))
  } else {
    const view = page.locator('header [data-thread-view]')
    for (let step = 0; step < 3; step++) {
      if ((await view.getAttribute('data-thread-view')) === mode) break
      await view.click()
    }
  }
  await page.locator(`header [data-thread-view="${mode}"]`).waitFor()
}
