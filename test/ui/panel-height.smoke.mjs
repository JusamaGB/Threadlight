/* global window, document, getComputedStyle, MouseEvent */
import assert from 'node:assert/strict'

export async function checkWorkspaceHeight(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const card = page.locator('[data-card]')
  const grip = page.getByRole('separator', { name: 'Resize Workspace height' })
  const setRows = (count) =>
    page.evaluate(
      async (count) => window.proof.emit('onSnapshot', await window.mockWorkspaceRows(count)),
      count,
    )
  const choose = async (name) => {
    await page.locator('header [data-thread-view]').click({ button: 'right' })
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  const heightIs = (height) =>
    page.waitForFunction(
      (height) => document.querySelector('[data-card]').getBoundingClientRect().height === height,
      height,
    )
  try {
    await page.setViewportSize({ width: 460, height: 1200 })
    await page.evaluate(async () => {
      window.threadlight.setWorkspacePanel = async () => ({
        maxHeight: 900,
        opensDown: true,
        fresh: false,
      })
      await window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        listMode: 'workspace',
        workspacePanelHeight: null,
      })
    })
    await setRows(40)
    await choose('Workspace')
    await heightIs(900)
    assert.equal(await grip.locator('button, svg').count(), 0, 'no visible resize control')
    await page.getByLabel(/^Claude · 5-hour limit/).hover()
    await page.getByRole('tooltip').filter({ hasText: 'Claude · 5-hour limit' }).waitFor()
    const strip = page.locator('[class*="_workspaceResizeArea_"]')
    const box = await strip.boundingBox()
    assert.equal(box.height, 8, 'only the existing two usage bars take up space')
    // The left, centre and right of the actual bottom strip must all be draggable;
    // the old tiny grip above it passed keyboard/drag checks but was hard to find.
    for (const x of [box.x + 12, box.x + box.width / 2, box.x + box.width - 12]) {
      await page.mouse.move(x, box.y + box.height - 2)
      assert.equal(
        await page.evaluate(
          ({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)).cursor,
          { x, y: box.y + box.height - 2 },
        ),
        'ns-resize',
      )
    }
    const x = box.x + box.width - 12
    const y = box.y + box.height - 2
    await page.mouse.move(x, y)
    await capture('workspace-full-height-usage-resize')
    const before = await page.evaluate(
      () => window.proof.calls.filter((c) => c[0] === 'leavePanel').length,
    )
    await page.mouse.down()
    await page.mouse.move(x, y - 200)
    await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
    assert.equal(
      await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'leavePanel').length),
      before,
    )
    await page.mouse.up()
    await heightIs(700)
    await page.waitForFunction(
      async () => (await window.threadlight.getSettings()).workspacePanelHeight === 700,
    )
    await capture('workspace-picked-height')
    await setRows(0)
    await page.getByText(/Nothing within your chosen time frame/).waitFor()
    const emptyHeight = await card.evaluate((el) => el.getBoundingClientRect().height)
    assert.ok(emptyHeight < 120, 'an empty workspace uses only its empty-state content')
    assert.equal(await card.evaluate((el) => getComputedStyle(el).maxHeight), '700px')
    assert.equal(
      await page.evaluate(
        async () => (await window.threadlight.getSettings()).workspacePanelHeight,
      ),
      700,
    )
    await capture('workspace-empty-height')
    await setRows(4)
    const shortHeight = await card.evaluate((el) => el.getBoundingClientRect().height)
    assert.ok(
      shortHeight > emptyHeight && shortHeight < 700,
      'sparse workspaces grow only to their content',
    )
    const shortStrip = await strip.boundingBox()
    const shortX = shortStrip.x + shortStrip.width / 2,
      shortY = shortStrip.y + shortStrip.height - 2
    await page.mouse.move(shortX, shortY)
    await page.mouse.down()
    await page.mouse.move(shortX, shortY - 40)
    await page.mouse.up()
    await heightIs(Math.round(shortHeight - 40))
    assert.equal(
      await page.evaluate(
        async () => (await window.threadlight.getSettings()).workspacePanelHeight,
      ),
      Math.round(shortHeight - 40),
      'dragging a short panel starts at its visible bottom, not the old maximum',
    )
    await page.evaluate(() => window.threadlight.updateSettings({ workspacePanelHeight: 700 }))
    await setRows(40)
    await heightIs(700)
    for (const name of ['Recent', 'Active', 'All']) {
      await choose(name)
      assert.equal(await grip.count(), 0)
      assert.equal(await card.getAttribute('data-workspace-height'), null)
    }
    await choose('Workspace')
    await heightIs(700)
    await page.reload()
    await choose('Workspace')
    await heightIs(700)
    await page.evaluate(() =>
      window.proof.emit('onPanelOpened', { maxHeight: 550, opensDown: true, fresh: false }),
    )
    await heightIs(550)
    assert.equal(
      await page.evaluate(
        async () => (await window.threadlight.getSettings()).workspacePanelHeight,
      ),
      700,
    )
    await page.evaluate(() =>
      window.proof.emit('onPanelOpened', { maxHeight: 900, opensDown: true, fresh: false }),
    )
    await heightIs(700)
    await grip.press('Home')
    await heightIs(120)
    await page.waitForFunction(
      async () => (await window.threadlight.getSettings()).workspacePanelHeight === 120,
    )
    await grip.press('End')
    await heightIs(900)
    await page.waitForFunction(
      async () => (await window.threadlight.getSettings()).workspacePanelHeight === 900,
    )
    console.log(
      'PASS: Workspace shrinks to empty/sparse content, grows to its saved maximum, drags from its visible height, persists limits, clamps on smaller screens and keeps other views content-sized.',
    )
  } finally {
    await setRows(null)
    await page.evaluate((settings) => window.threadlight.updateSettings(settings), initial)
    await page.setViewportSize({ width: 460, height: 900 })
    await page.reload()
  }
}

export async function checkPanelHeight(page) {
  await page.setViewportSize({ width: 460, height: 1200 })
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    const settings = await window.threadlight.getSettings()
    const template = snapshot.sessions[0]
    const sessions = Array.from({ length: 19 }, (_, i) => ({
      ...template,
      id: `synthetic-height-${i}`,
      title: `Synthetic height row ${i}`,
      state: 'idle',
      lastActiveAt: Date.now() - 3600_000,
      attention: null,
    }))
    window.proof.emit('onSettings', { ...settings, listMode: 'recent' })
    window.proof.emit('onSnapshot', { ...snapshot, sessions, lookupSessions: sessions })
    window.proof.emit('onPanelOpened', { maxHeight: 1200, opensDown: true, fresh: true })
  })
  const expandedList = page.locator('header button[data-thread-view]')
  await expandedList.click()
  await page.locator('[data-session-id="synthetic-height-18"]').waitFor()
  const measure = () =>
    page.evaluate(() => {
      const card = document.querySelector('[data-card]')
      const list = card.querySelector('[class*="_sessions_"] > [class*="_list_"]')
      const footer = card.querySelector('[class*="_usageBars_"]')
      return {
        height: card.getBoundingClientRect().height,
        maxHeight: Number.parseFloat(getComputedStyle(card).maxHeight),
        overflow: list.scrollHeight - list.clientHeight,
        listBottom: list.getBoundingClientRect().bottom,
        footerTop: footer.getBoundingClientRect().top,
      }
    })
  const natural = await measure()
  assert.equal(natural.overflow, 0)
  // Closing must not wait for an opacity transition or a timeout.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  const leaves = () =>
    page.evaluate(() => window.proof.calls.filter((call) => call[0] === 'leavePanel').length)
  await page.mouse.move(25, 5)
  const before = await leaves()
  await page.mouse.move(450, 1100)
  assert.equal(await leaves(), before + 1)
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  assert.equal(await leaves(), before + 2, 'native pointer fallback also closes without a timer')
  await page.evaluate(() => {
    document
      .querySelector('header')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  })
  await page.getByTitle(/Pinned open/).waitFor()
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  assert.equal(await leaves(), before + 2, 'double-click pins immediately, even with frozen timers')
  assert.equal(await expandedList.getAttribute('data-thread-view'), 'recent')
  await page.evaluate(() => {
    document
      .querySelector('header')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 3 }))
  })
  assert.equal(await page.getByTitle(/Pinned open/).count(), 1, 'the third click has no action')
  await page.evaluate(() => {
    document
      .querySelector('header')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  })
  await page.getByTitle(/Pinned open/).waitFor({ state: 'detached' })
  await page.evaluate(() => window.proof.emit('onPanelPointerOutside'))
  await page.clock.runFor(300)
  assert.equal(
    await page.getByTitle(/Pinned open/).count(),
    0,
    'unpinning leaves no delayed toggle',
  )
  assert.equal(await leaves(), before + 3, 'unpinning restores pointer-leave behavior')
  assert.equal(await expandedList.getAttribute('data-thread-view'), 'recent')
  await page.clock.resume()
  for (const opensDown of [true, false]) {
    const limit = Math.floor(natural.height - 35)
    await page.evaluate((layout) => window.proof.emit('onPanelOpened', layout), {
      maxHeight: limit,
      opensDown,
      fresh: false,
    })
    await page.waitForFunction(
      (height) => document.querySelector('[data-card]').getBoundingClientRect().height === height,
      limit,
    )
    const constrained = await measure()
    assert.ok(constrained.overflow > 0, 'scroll only when the list exceeds available room')
    assert.ok(constrained.listBottom <= constrained.footerTop + 0.5, 'usage bars reserve room')
    await page.evaluate((layout) => window.proof.emit('onPanelOpened', layout), {
      maxHeight: natural.height + 20,
      opensDown,
      fresh: false,
    })
    await page.waitForFunction(
      (height) => document.querySelector('[data-card]').getBoundingClientRect().height === height,
      natural.height,
    )
    assert.equal((await measure()).overflow, 0, 'extra room removes the scrollbar')
    assert.equal(await expandedList.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.locator('[data-session-id]').count(), 19)
  }
  await page.setViewportSize({ width: 460, height: 900 })
  await page.reload()
  console.log('PASS: panel grows/shrinks without resetting its list; borders and usage bars fit.')
}
