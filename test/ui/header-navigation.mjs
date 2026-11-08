/* global window */
export async function selectConversationFilter(page, value) {
  const control = page.locator('header [data-thread-filter]')
  if ((await control.getAttribute('data-thread-filter')) === value) return
  await control.click()
  await page
    .getByRole('menu', { name: 'Thread filter', exact: true })
    .getByRole('menuitem', {
      name: { all: 'All', chat: 'Chat', 'code-computer': 'Code & Computer' }[value],
      exact: true,
    })
    .click()
  await page.locator(`header [data-thread-filter="${value}"]`).waitFor()
}

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
      const before = await view.getAttribute('data-thread-view')
      if (before === mode) break
      await view.click()
      // Settings updates are asynchronous; do not click the old view again.
      const next = before === 'active' ? 'recent' : before === 'recent' ? 'workspace' : 'active'
      await page.locator(`header [data-thread-view="${next}"]`).waitFor()
    }
  }
  await page.locator(`header [data-thread-view="${mode}"]`).waitFor()
}
