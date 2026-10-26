/* global window, document */
import assert from 'node:assert/strict'

export async function checkRecentLimit(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const view = page.locator('header [data-thread-view]')
  const control = page.locator('header').getByRole('group', { name: 'Sessions listed' })
  const value = control.locator(':scope > span')
  try {
    await page.evaluate(() =>
      window.threadlight.updateSettings({ listMode: 'recent', maxSessions: 10 }),
    )
    await view.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Recent', exact: true }).click()
    assert.equal(await view.innerText(), 'Recent')
    assert.equal((await control.innerText()).replace(/\s/g, ''), '−10+')
    await control.getByRole('button', { name: 'Decrease Sessions listed', exact: true }).click()
    await page.waitForFunction(
      () =>
        document
          .querySelector('header [role="group"][aria-label="Sessions listed"]')
          ?.textContent.replace(/\s/g, '') === '−9+',
    )
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).maxSessions),
      9,
    )
    assert.equal(await view.getAttribute('data-thread-view'), 'recent')
    assert.equal(await page.getByRole('button', { name: 'Unpin' }).count(), 0)
    await capture('recent-count-compact')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const row = page.getByText('Sessions listed', { exact: true }).locator('../..')
    assert.equal(await row.locator('[class*="_value_"]').innerText(), '9')
    await row.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await value.getByText('10', { exact: true }).waitFor()
    await page.evaluate(() => window.threadlight.updateSettings({ maxSessions: 3 }))
    await value.getByText('3', { exact: true }).waitFor()
    assert.equal(
      await control.getByRole('button', { name: 'Decrease Sessions listed' }).isDisabled(),
      true,
    )
    await page.evaluate(() => window.threadlight.updateSettings({ maxSessions: 25 }))
    await value.getByText('25', { exact: true }).waitFor()
    assert.equal(
      await control.getByRole('button', { name: 'Increase Sessions listed' }).isDisabled(),
      true,
    )
    await view.click()
    await page.locator('header [data-thread-view="workspace"]').waitFor()
    assert.equal(await control.count(), 0)
    assert.match(await view.innerText(), /^Workspace · /)
    await view.click()
    await page.locator('header [data-thread-view="active"]').waitFor()
    assert.equal(await control.count(), 0)
    await view.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'All', exact: true }).click()
    assert.equal(await control.count(), 0)
    console.log(
      'PASS: compact Recent −count+ saves Sessions listed, syncs both ways with Settings, obeys bounds and leaves other views unchanged.',
    )
  } finally {
    await page.evaluate((settings) => window.threadlight.updateSettings(settings), initial)
    await view.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Active', exact: true }).click()
  }
}

export async function checkToolbar(page) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const view = page.locator('header [data-thread-view]')
  const source = page.getByRole('button', { name: /^Filter applications:/ })
  const chooseSource = async (name) => {
    await source.click()
    await page.getByRole('menuitem', { name, exact: true }).click()
    await page.getByRole('button', { name: `Filter applications: ${name}`, exact: true }).waitFor()
  }
  await chooseSource('Both')
  await checkPinning(page)
  assert.deepEqual(
    await page.evaluate(async () => (await window.threadlight.getSettings()).enabledProviders),
    ['claude', 'codex'],
  )
  assert.equal(await view.getAttribute('data-thread-view'), 'active')
  await view.click()
  await page.locator('header [data-thread-view="recent"]').waitFor()
  await view.click()
  await page.locator('header [data-thread-view="workspace"]').waitFor()
  assert.equal(
    await page.locator('[data-session-id]').count(),
    2,
    'Both includes both apps in the same folder',
  )
  assert.equal(
    await page.locator('[data-card] [class*="_workspaceHeader_"]').count(),
    0,
    'no duplicate workspace heading',
  )
  await page.getByRole('button', { name: 'Choose workspace: shared', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search workspaces' }).fill('shared')
  const shared = page.getByRole('button', { name: /^shared/ })
  assert.equal(await shared.count(), 1, 'the folder picker does not duplicate a shared folder')
  await shared.click()
  await page.locator('header [data-thread-view="workspace"]').waitFor()
  await chooseSource('Codex')
  assert.equal(await page.locator('[data-session-id]').count(), 1)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(
    await page.getByRole('switch', { name: 'Codex', exact: true }).getAttribute('aria-checked'),
    'true',
  )
  assert.equal(
    await page.getByRole('switch', { name: 'Claude', exact: true }).getAttribute('aria-checked'),
    'false',
  )
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await chooseSource('Claude')
  assert.equal(await page.locator('[data-session-id]').count(), 1)
  await chooseSource('Both')
  await view.click()
  await page.locator('header [data-thread-view="active"]').waitFor()
  await view.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Recent', exact: true }).waitFor()
  await page.getByRole('menuitem', { name: 'Workspace', exact: true }).waitFor()
  await page.getByRole('menuitem', { name: 'All', exact: true }).click()
  await page.locator('header [data-thread-view="all"]').waitFor()
  await page.getByRole('button', { name: /^Claude · shared/ }).waitFor()
  await page.getByRole('button', { name: /^Codex · shared/ }).waitFor()
  await view.click()
  await page.locator('header [data-thread-view="active"]').waitFor()
  await source.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Filter applications: Claude', exact: true }).waitFor()
  await chooseSource('Both')
  await page.setViewportSize({ width: 316, height: 900 })
  for (const opensDown of [true, false]) {
    await page.evaluate(async (opensDown) => {
      const snapshot = await window.threadlight.getSnapshot()
      window.proof.emit('onPanelOpened', { maxHeight: 900, opensDown, fresh: true })
      window.proof.emit('onSnapshot', { ...snapshot, sessions: [], workspaces: [] })
    }, opensDown)
    await source.click()
    await page.getByRole('menu').waitFor()
    await page.waitForFunction(() => {
      const menu = document.querySelector('[role="menu"]').getBoundingClientRect()
      const lastResize = window.proof.resizes.at(-1)
      return lastResize && menu.top >= 0 && menu.bottom <= lastResize
    })
    const position = await page.evaluate(() => ({
      menu: document.querySelector('[role="menu"]').getBoundingClientRect().toJSON(),
      header: document.querySelector('header').getBoundingClientRect().toJSON(),
    }))
    assert.ok(position.menu.left >= 16 && position.menu.right <= 316)
    if (opensDown) assert.ok(position.menu.top >= position.header.bottom)
    else assert.ok(position.menu.bottom <= position.header.top)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('menu').count(), 0)
  }
  await page.evaluate(async (initial) => {
    await window.threadlight.updateSettings(initial)
    window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: true })
  }, initial)
  await page.setViewportSize({ width: 460, height: 900 })
  assert.equal(
    await page.getByRole('button', { name: 'Open the mic for voice commands' }).count(),
    0,
  )
  console.log(
    'PASS: toolbar view cycle, context menu, app/settings sync, shared folder selection and compact menus.',
  )
}

async function checkPinning(page) {
  const header = page.locator('header')
  const view = header.locator('[data-thread-view]')
  const pin = page.getByRole('button', {
    name: 'Pinned open. Click to unpin, or double-click the bar',
    exact: true,
  })
  const bare = () =>
    header.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const y = bounds.height / 2
      for (let x = bounds.width - 30; x > 0; x--) {
        if (document.elementFromPoint(bounds.x + x, bounds.y + y) === element) return { x, y }
      }
      throw new Error('The header has no bare background for its pin gesture')
    })
  const leaveCalls = () =>
    page.evaluate(() => window.proof.calls.filter((call) => call[0] === 'leavePanel').length)
  for (const [mode, label, next] of [
    ['active', 'Active', 'recent'],
    ['recent', 'Recent', 'workspace'],
    ['workspace', 'Workspace', 'active'],
    ['all', 'All', 'active'],
  ]) {
    if ((await view.getAttribute('data-thread-view')) !== mode) {
      await view.click({ button: 'right' })
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    }
    await header.locator(`[data-thread-view="${mode}"]`).waitFor()
    await header.dblclick({ position: await bare() })
    await pin.waitFor()
    assert.equal(await view.getAttribute('data-thread-view'), mode, 'pinning keeps the chosen view')
    const before = await leaveCalls()
    await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
    assert.equal(await leaveCalls(), before, 'pinned views stay open on pointer leave')
    await header.dblclick({ position: await bare() })
    await pin.waitFor({ state: 'detached' })
    assert.equal(
      await view.getAttribute('data-thread-view'),
      mode,
      'double-click unpins without resetting the view',
    )
    await header.click({ position: await bare(), clickCount: 3 })
    await pin.waitFor()
    assert.equal(
      await view.getAttribute('data-thread-view'),
      mode,
      'a triple click only performs its double-click toggle',
    )
    await view.click()
    await header.locator(`[data-thread-view="${next}"]`).waitFor()
    assert.equal(await pin.count(), 1, 'the view control changes lists without unpinning')
    await pin.click()
    await pin.waitFor({ state: 'detached' })
    assert.equal(
      await view.getAttribute('data-thread-view'),
      next,
      'the pin icon also preserves the view',
    )
  }
  console.log(
    'PASS: immediate double-click pin/unpin in all four views, ignored third click, pinned view switching and pointer leave.',
  )
}
