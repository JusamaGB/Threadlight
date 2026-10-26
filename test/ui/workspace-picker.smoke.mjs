/* global window */
import assert from 'node:assert/strict'

export async function checkWorkspacePicker(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const applications = page.getByLabel('Workspace applications', { exact: true })
  const search = page.getByRole('searchbox', { name: 'Search workspaces' })
  const results = page.locator('[class*="_pickerResults_"]')
  const choose = (name) => results.getByRole('button', { name, exact: true })
  const open = async () => {
    await page.getByRole('button', { name: /^Choose workspace:/ }).click()
    await applications.waitFor()
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
    await open()
    assert.equal(await applications.inputValue(), 'both')
    assert.equal(await page.getByLabel('Workspace drive', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /^Follow .*activity/ }).count(), 0)
    assert.equal(await page.getByText(/Choose which folder’s threads/).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Parent folder', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Use All Drives', exact: true }).waitFor()
    const appBox = await applications.boundingBox()
    const searchBox = await search.boundingBox()
    assert.equal(appBox.y, searchBox.y, 'applications and search share one row')
    assert.ok(appBox.width < searchBox.width / 2, 'applications leaves most of the row for search')
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
    await applications.selectOption('claude')
    await page.getByRole('status').filter({ hasText: 'No workspaces match' }).waitFor()
    assert.deepEqual(
      await page.evaluate(async () => (await window.threadlight.getSettings()).enabledProviders),
      ['claude'],
    )
    await applications.selectOption('codex')
    await choose('other C:/Projects/other').waitFor()
    await applications.selectOption('both')
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
      'PASS: compact workspace picker, all-drive start/search, provider settings, drive/UNC navigation, deduplication, nested folders, explicit selection and fixed controls over scrolling results.',
    )
  } finally {
    await page.evaluate(async (initial) => {
      window.proof.emit('onSnapshot', await window.mockWorkspaceFolders(null))
      await window.threadlight.updateSettings(initial)
      window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: true })
    }, initial)
  }
}
