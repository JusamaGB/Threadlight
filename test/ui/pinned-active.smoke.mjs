/* global window, document */
import assert from 'node:assert/strict'
import { openHeaderPage, selectThreadView } from './header-navigation.mjs'
import { setupLegacySpace } from './space-navigation.mjs'

export async function checkPinnedActive(page, capture) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      workspaceWires: false,
      panelLayout: 'single',
    }),
  )
  const wire = page.locator('[data-wire-toggle]')
  const pinned = page.getByRole('region', { name: 'Pinned Active threads', exact: true })
  const menu = page.getByRole('menu', { name: 'Wire menu', exact: true })
  const bars = page.locator('[class*="_usageBars_"]')
  const pin = async (enabled, keyboard = false) => {
    if (keyboard) {
      await wire.focus()
      await wire.press('Shift+F10')
    } else await wire.click({ button: 'right' })
    await menu
      .getByRole('menuitem', {
        name: enabled ? 'Pin active threads' : 'Unpin active threads',
        exact: true,
      })
      .click()
  }
  const checkBelow = async (above) => {
    const active = await pinned.boundingBox()
    const footer = await bars.boundingBox()
    assert.ok(
      active.y + active.height <= footer.y + 1,
      'Active remains above info and context bars',
    )
    if (above) {
      const content = await above.boundingBox()
      assert.ok(content.y + content.height <= active.y + 1, 'page content stays above Active')
    }
  }
  assert.equal(await pinned.count(), 0)
  await openHeaderPage(page, 'Agent')
  await page.getByRole('button', { name: 'Reply to Agent' }).click()
  const draft = page.getByPlaceholder('Ask your agent…')
  await draft.fill('Keep working here while Active is pinned')
  const messages = () =>
    page.evaluate(() =>
      window.proof.calls.filter(([name]) =>
        ['send', 'answer', 'agentSend', 'agentRespond', 'agentResume'].includes(name),
      ),
    )
  const before = await messages()
  await wire.click({ button: 'right' })
  await capture('wire-pin-menu')
  await menu.getByRole('menuitem', { name: 'Pin active threads', exact: true }).click()
  await pinned.getByText('Synthetic Codex', { exact: true }).waitFor()
  await pinned.getByText('Synthetic Claude', { exact: true }).waitFor()
  assert.equal(await draft.inputValue(), 'Keep working here while Active is pinned')
  assert.deepEqual(await messages(), before, 'pinning sends no messages')
  assert.equal(
    await page.evaluate(async () => (await window.threadlight.getSettings()).workspaceWires),
    false,
  )
  await checkBelow(draft)
  await capture('pinned-active-agent')
  await page.evaluate(() => {
    window.threadlight.threadTimeline = async ({ threadId }) => ({
      ok: true,
      timeline: {
        threadId,
        revision: 1,
        connection: 'live',
        hasMore: false,
        loadingOlder: false,
        items: [
          {
            id: 'pinned-reply',
            role: 'assistant',
            kind: 'message',
            text: 'A reply from the pinned thread.',
            phase: 'final',
            at: Date.now(),
            turnId: 'turn',
            complete: true,
            source: 'codex_stream',
          },
        ],
      },
    })
  })
  await pinned.getByRole('button', { name: /Synthetic Codex/ }).press('Enter')
  const pinnedReply = pinned
    .getByLabel('Conversation history')
    .getByText('A reply from the pinned thread.', { exact: true })
  await pinnedReply.waitFor()
  await checkBelow(draft)
  await page.evaluate(() => window.proof.emit('onPanelNavigate', 'back'))
  await pinnedReply.waitFor({ state: 'detached' })
  assert.equal(await draft.inputValue(), 'Keep working here while Active is pinned')
  const clickPinnedThread = async () => {
    await pinned.getByRole('button', { name: /Synthetic Codex/ }).click()
    await pinnedReply.waitFor()
  }
  const collapsePin = async () => {
    await pinned.getByRole('button', { name: /Synthetic Codex/ }).click()
    await pinnedReply.waitFor({ state: 'detached' })
  }

  await page.evaluate(() =>
    window.proof.patch({
      state: 'working',
      attention: null,
      stage: 'Live pinned progress',
      unread: true,
    }),
  )
  await pinned.getByText('Live pinned progress', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      async () =>
        (await window.threadlight.getSnapshot()).sessions.find((s) => s.provider === 'codex')
          .unread,
    ),
    true,
  )
  await wire.press('Shift+F10')
  await menu.getByRole('menuitem', { name: 'Unpin active threads', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await wire.evaluate((el) => document.activeElement === el), true)
  await draft.waitFor()

  await wire.click()
  await page.locator('[data-thread-view="active"]').waitFor()
  assert.equal(await pinned.count(), 0, 'Active main view is not duplicated')
  assert.equal(
    await page.evaluate(async () => (await window.threadlight.getSettings()).pinnedActiveThreads),
    true,
  )
  await wire.click()
  await page.waitForFunction(async () => (await window.threadlight.getSettings()).workspaceWires)
  await selectThreadView(page, 'recent')
  await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'dual' }))
  await page.locator('[data-dual="true"]').waitFor()
  await pinned.waitFor()
  await checkBelow(page.getByRole('region', { name: 'Threads', exact: true }))
  await capture('pinned-active-dual-recent')
  await clickPinnedThread()
  await page.locator('header [data-thread-view="recent"]').waitFor()
  await collapsePin()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await pinned.waitFor()
  await checkBelow()
  await clickPinnedThread()
  await page.getByRole('button', { name: 'Collapse pinned thread', exact: true }).click()
  await pinnedReply.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).waitFor()
  await openHeaderPage(page, 'Shared Spaces')
  await setupLegacySpace(page)
  await page.getByRole('tab', { name: 'Notes', exact: true }).click()
  const note = page.getByRole('textbox', { name: 'New note', exact: true })
  await note.fill('Pinned note draft')
  await checkBelow(note)
  await capture('pinned-active-notes')
  await pin(false, true)
  await pinned.waitFor({ state: 'detached' })
  assert.equal(await note.inputValue(), 'Pinned note draft')
  assert.equal(
    await page.evaluate(async () => (await window.threadlight.getSettings()).workspaceWires),
    true,
  )
  await pin(true)
  await pinned.waitFor()
  await clickPinnedThread()
  await checkBelow(note)
  await capture('pinned-active-notes-expanded')
  assert.equal(await note.inputValue(), 'Pinned note draft')
  await page.evaluate(() => window.proof.emit('onPanelNavigate', 'back'))
  await pinnedReply.waitFor({ state: 'detached' })
  assert.equal(await note.inputValue(), 'Pinned note draft')

  await page.reload()
  await openHeaderPage(page, 'Agent')
  await pinned.waitFor()
  assert.equal(
    await page.evaluate(async () => (await window.threadlight.getSettings()).pinnedActiveThreads),
    true,
  )
  await page.evaluate(async () => {
    window.proof.emit('onSnapshot', await window.mockWorkspaceRows(20))
    window.proof.emit('onPanelOpened', { maxHeight: 320, opensDown: true, fresh: false })
  })
  const list = pinned.locator('[class*="_peekList_"]')
  const sizes = await list.evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }))
  assert.ok(sizes.content > sizes.height, 'long Active list scrolls independently')
  assert.ok((await pinned.boundingBox()).height <= 97, 'Active uses at most 30% of the small panel')
  await list.press('End')
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Pinned Active threads"] [tabindex="0"]').scrollTop > 0,
  )
  await checkBelow(draft)
  assert.ok((await page.locator('[data-card]').boundingBox()).height <= 320)
  await capture('pinned-active-small-long')
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    const base = snapshot.sessions[0]
    const own = {
      ...base,
      id: 'pinned-own',
      title: 'Scoped Active',
      provider: 'claude',
      cwd: 'C:/pinned-own',
      state: 'working',
      attention: null,
    }
    const other = {
      ...own,
      id: 'pinned-other',
      title: 'Other folder Active',
      cwd: 'C:/pinned-other',
    }
    const stale = {
      ...own,
      id: 'pinned-stale',
      title: 'Expired unread',
      state: 'idle',
      unread: true,
      lastActiveAt: Date.now() - 11 * 60_000,
    }
    const groups = [
      {
        id: 'claude:C:/pinned-own',
        name: 'pinned-own',
        threads: [own, stale].map((session) => ({ session, children: [] })),
        threadCount: 2,
        activeCount: 1,
      },
      {
        id: 'claude:C:/pinned-other',
        name: 'pinned-other',
        threads: [{ session: other, children: [] }],
        threadCount: 1,
        activeCount: 1,
      },
    ]
    await window.threadlight.updateSettings({
      combinedFocusWorkspace: 'claude:C:/pinned-own',
      workspaceAllDrives: false,
    })
    window.proof.emit('onSnapshot', {
      ...snapshot,
      sessions: [own, other, stale],
      lookupSessions: [],
      workspaces: groups,
      allWorkspaces: groups.map(({ id, name }) => ({ id, name })),
    })
  })
  await pinned.getByText('Scoped Active', { exact: true }).waitFor()
  assert.equal(await pinned.getByText('Other folder Active', { exact: true }).count(), 0)
  assert.equal(await pinned.getByText('Expired unread', { exact: true }).count(), 0)
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    window.proof.emit('onSnapshot', {
      ...snapshot,
      sessions: [],
      lookupSessions: [],
      workspaces: [],
    })
  })
  await pinned.getByText('No active threads', { exact: true }).waitFor()
  await capture('pinned-active-empty')

  await page.evaluate(() => {
    const update = window.threadlight.updateSettings
    window.threadlight.updateSettings = async (patch) => {
      if ('pinnedActiveThreads' in patch) return { ok: false, reason: 'Synthetic pin save failure' }
      return update(patch)
    }
  })
  await pin(false)
  await page.getByRole('alert').filter({ hasText: 'Synthetic pin save failure' }).waitFor()
  assert.equal(
    await page.evaluate(async () => (await window.threadlight.getSettings()).pinnedActiveThreads),
    true,
  )
  await pinned.waitFor()
  console.log(
    'PASS: wire context menu and keyboard pinning, live updates, page and draft retention, main-view behavior, saved pin, independent wires, footer ordering, bounded scrolling, empty state and save failure.',
  )
}
