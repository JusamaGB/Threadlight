/* global window, document */
import assert from 'node:assert/strict'

export async function checkWorkspacePicker(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const applications = page.getByRole('button', { name: /^Workspace applications:/ })
  const appsMenu = page.getByRole('menu', { name: 'Workspace applications', exact: true })
  const searchLink = page.getByRole('button', { name: 'Search', exact: true })
  const search = page.getByRole('searchbox', { name: 'Search workspaces' })
  const results = page.locator('[class*="_pickerResults_"]')
  const choose = (name) => results.getByRole('button', { name, exact: true })
  const open = async (revealSearch = true) => {
    await page.getByRole('button', { name: /^Choose workspace:/ }).click()
    await applications.waitFor()
    if (revealSearch) await searchLink.click()
  }
  const chooseApplications = async (name) => {
    await applications.hover()
    await appsMenu.getByRole('menuitem', { name, exact: true }).click()
  }
  const folders = {
    claude: [
      { id: 'C:/Projects/shared', name: 'shared' },
      { id: 'Z:/General', name: 'General' },
      { id: 'Z:/General/lib', name: 'lib' },
      { id: 'Z:/', name: 'Z:' },
      { id: '//server/team/app', name: 'app' },
    ],
    codex: [
      { id: '\\\\?\\c:\\Projects\\shared', name: 'shared' },
      { id: 'C:/Projects/other', name: 'other' },
      { id: 'Z:/General', name: 'General' },
      { id: 'Z:/Archive/shared', name: 'shared' },
    ],
  }
  try {
    await page.evaluate(async (folders) => {
      await window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        listMode: 'workspace',
        combinedFocusWorkspace: null,
      })
      window.proof.emit('onSnapshot', await window.mockWorkspaceFolders(folders))
    }, folders)
    await open(false)
    assert.equal(await applications.getAttribute('aria-label'), 'Workspace applications: Both')
    assert.equal(await page.locator('[class*="_workspacePicker_"] select').count(), 0)
    assert.equal(await search.count(), 0, 'search is hidden until requested')
    assert.equal(await page.getByLabel('Workspace drive', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /^Follow .*activity/ }).count(), 0)
    assert.equal(await page.getByText(/Choose which folder’s threads/).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Parent folder', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Use All Drives', exact: true }).waitFor()
    const appBox = await applications.boundingBox()
    const searchBox = await searchLink.boundingBox()
    const allBox = await page
      .getByRole('button', { name: 'Use All Drives', exact: true })
      .boundingBox()
    assert.equal(appBox.y, searchBox.y)
    assert.equal(appBox.y, allBox.y)
    assert.ok(
      allBox.x < appBox.x && appBox.x < searchBox.x,
      'one line has Use All Drives left and Apps | Search right',
    )
    await capture('workspace-picker-links')
    await applications.hover()
    assert.deepEqual(await appsMenu.getByRole('menuitem').allTextContents(), [
      'Claude',
      'Codex',
      'Both',
    ])
    await appsMenu.hover()
    await capture('workspace-picker-apps-hover')
    await page.locator('header').hover()
    await appsMenu.waitFor({ state: 'detached' })
    await applications.press('Enter')
    await appsMenu.waitFor()
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('role')),
      'menuitem',
    )
    await page.keyboard.press('Escape')
    await appsMenu.waitFor({ state: 'detached' })
    await searchLink.hover()
    await search.waitFor()
    await search.hover()
    await page.locator('header').hover()
    await search.waitFor({ state: 'detached' })
    await searchLink.hover()
    await search.click()
    await page.locator('header').hover()
    assert.equal(await search.count(), 1, 'a focused search remains open')
    await search.fill('shared')
    await search.press('Tab')
    assert.equal(await search.count(), 1, 'an entered query remains visible after focus leaves')
    await search.press('Escape')
    await search.waitFor({ state: 'detached' })
    await searchLink.click()
    await search.waitFor()
    await page.locator('header').hover()
    assert.equal(await search.count(), 1, 'clicking Search pins it open after the pointer leaves')
    await applications.hover()
    assert.equal(
      await search.evaluate((el) => document.activeElement === el),
      true,
      'hovering Apps does not take search focus',
    )
    await page.locator('header').hover()
    await appsMenu.waitFor({ state: 'detached' })
    await search.press('Escape')
    await search.waitFor({ state: 'detached' })
    await searchLink.click()
    const zDrive = results.getByRole('button', { name: /^Z: 4 workspaces/ })
    await capture('workspace-picker-drives')
    await zDrive.click()
    await applications.waitFor()
    await page.getByRole('button', { name: 'Parent folder', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Use Z:', exact: true }).waitFor()
    assert.equal(
      await page.evaluate(
        async () => (await window.threadlight.getSettings()).combinedFocusWorkspace,
      ),
      null,
    )
    // Searching from Z: must also find C: without any drive filter.
    await search.fill('other')
    await choose('other C:/Projects/other').waitFor()
    await chooseApplications('Claude')
    await page.getByRole('status').filter({ hasText: 'No workspaces match' }).waitFor()
    assert.deepEqual(
      await page.evaluate(async () => (await window.threadlight.getSettings()).enabledProviders),
      ['claude'],
    )
    await chooseApplications('Codex')
    await choose('other C:/Projects/other').waitFor()
    await chooseApplications('Both')
    await search.fill('shared')
    assert.equal(
      await results.getByRole('button').count(),
      2,
      'same folder merges providers; same names in different paths stay separate',
    )
    assert.equal(await results.getByRole('button', { name: /C:\/Projects\/shared/i }).count(), 1)
    assert.equal(await results.getByRole('button', { name: /Z:\/Archive\/shared/ }).count(), 1)
    await capture('workspace-picker-search')
    await search.fill('')
    await results.getByRole('button', { name: 'Browse General', exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Workspace folder navigation' })
      .getByText('Z:/General', { exact: true })
      .waitFor()
    await choose('lib').waitFor()
    await page.getByRole('button', { name: 'Use General', exact: true }).waitFor()
    await capture('workspace-picker-browse')
    await page.getByRole('button', { name: 'Parent folder', exact: true }).click()
    await choose('General').click()
    assert.equal(
      await page.evaluate(
        async () => (await window.threadlight.getSettings()).combinedFocusWorkspace,
      ),
      'codex:Z:/General',
    )
    await page.getByRole('button', { name: 'Filter applications: Both', exact: true }).waitFor()
    await open()
    await results.getByRole('button', { name: /^\/\/server\/team 1 workspace/ }).click()
    await choose('app').waitFor()
    await search.fill('not-a-workspace')
    await page.getByRole('status').filter({ hasText: 'No workspaces match' }).waitFor()
    await search.fill('')
    await page.getByRole('button', { name: 'Parent folder', exact: true }).click()
    await zDrive.waitFor()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()

    // A busy drive scrolls its results, keeping the search/filter controls in reach.
    await page.evaluate(async (folders) => {
      folders.codex.push(
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `C:/Projects/project-${i}`,
          name: `project-${i}`,
        })),
      )
      window.proof.emit('onSnapshot', await window.mockWorkspaceFolders(folders))
      window.proof.emit('onPanelOpened', { maxHeight: 380, opensDown: true, fresh: false })
    }, folders)
    await open()
    await results.getByRole('button', { name: /^C: 102 workspaces/ }).click()
    await results.getByRole('button', { name: /^Projects 102 workspaces/ }).click()
    const before = await search.boundingBox()
    assert.ok(await results.evaluate((el) => el.scrollHeight > el.clientHeight))
    const scrollbar = page.getByRole('scrollbar', { name: 'Scroll workspaces', exact: true })
    await scrollbar.press('End')
    assert.ok(await results.evaluate((el) => el.scrollTop > 0))
    assert.deepEqual(
      await search.boundingBox(),
      before,
      'controls remain above the scrolling results',
    )
    assert.ok(
      await page.locator('[data-card]').evaluate((el) => el.getBoundingClientRect().height <= 380),
    )
    await capture('workspace-picker-scrolling')
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    console.log(
      'PASS: one-line picker links, hover Apps without stealing focus, transient/pinned search and Escape, global provider/search settings, drive/UNC navigation and stable scrolling controls.',
    )
  } finally {
    await page.evaluate(async (initial) => {
      window.proof.emit('onSnapshot', await window.mockWorkspaceFolders(null))
      await window.threadlight.updateSettings(initial)
      window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: true })
    }, initial)
  }
}
