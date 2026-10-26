/* global window, document */
import assert from 'node:assert/strict'

export async function checkWorkspacePaths(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const view = page.locator('header [data-thread-view]')
  const chooseSource = async (name) => {
    await page.getByRole('button', { name: /^Filter applications:/ }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  const waitForProviders = async (expected) => {
    await page.waitForFunction((expected) => {
      const providers = [...document.querySelectorAll('[data-session-id]')]
        .map((row) => (row.dataset.sessionId.startsWith('codex:') ? 'codex' : 'claude'))
        .sort()
      return JSON.stringify(providers) === JSON.stringify(expected)
    }, expected)
  }
  for (const paths of [
    { claude: 'C:\\synthetic\\shared', codex: '\\\\?\\C:\\synthetic\\shared' },
    { claude: '\\\\server\\share\\shared', codex: '\\\\?\\UNC\\server\\share\\shared' },
  ]) {
    await page.evaluate(async (paths) => {
      await window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        listMode: 'workspace',
        combinedFocusWorkspace: null,
        focusWorkspace: null,
        codexFocusWorkspace: null,
      })
      window.proof.emit('onSnapshot', await window.mockWorkspacePaths(paths))
    }, paths)
    if ((await view.getAttribute('data-thread-view')) !== 'workspace') {
      await view.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Workspace', exact: true }).click()
    }
    // The fixture begins with no loaded workspace threads; only exact adapter IDs load them.
    await waitForProviders(['claude', 'codex'])
    assert.equal(await view.innerText(), 'Workspace · 2')
    assert.deepEqual(
      await page
        .locator('[data-session-id]')
        .evaluateAll((rows) => rows.map((row) => row.dataset.provider)),
      ['codex', 'claude'],
      'Both + Workspace merges providers by latest activity instead of application order',
    )
    assert.deepEqual(
      await page.evaluate(() => window.proof.calls.filter((call) => call[0] === 'views').at(-1)[1]),
      ['claude', 'codex'].map((provider) => ({
        provider,
        view: { expanded: [paths[provider]], showAll: [paths[provider]] },
      })),
      'both adapters receive their original path spelling for loading all threads',
    )
    await page.getByRole('button', { name: 'Choose workspace: shared', exact: true }).click()
    const shared = page.getByRole('button', { name: /^shared/ })
    assert.equal(await shared.count(), 1, 'equivalent Windows paths share one picker row')
    await shared.click()
    await waitForProviders(['claude', 'codex'])
    assert.equal(
      await page.evaluate(
        async () => (await window.threadlight.getSettings()).combinedFocusWorkspace,
      ),
      `codex:${paths.codex}`,
      'the saved selection retains its original provider workspace ID',
    )
    await chooseSource('Claude')
    await waitForProviders(['claude'])
    await chooseSource('Codex')
    await waitForProviders(['codex'])
    await chooseSource('Both')
    await waitForProviders(['claude', 'codex'])
  }
  await checkMergedWorkspace(page, capture)
  await page.evaluate(async (initial) => {
    window.proof.emit('onSnapshot', await window.mockWorkspacePaths(null))
    await window.threadlight.updateSettings(initial)
    window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: true })
  }, initial)
  console.log(
    'PASS: Both + Workspace loads both path formats, deduplicates the picker and preserves provider IDs.',
  )
}

async function checkMergedWorkspace(page, capture) {
  const snapshot = await page.evaluate(() => window.threadlight.getSnapshot())
  // This scenario supplies complete snapshots; disable the preceding lazy-loading fixture.
  await page.evaluate(() => window.mockWorkspacePaths(null))
  const claude = snapshot.workspaces.find((workspace) => workspace.id.startsWith('claude:'))
  const codex = snapshot.workspaces.find((workspace) => workspace.id.startsWith('codex:'))
  const now = Date.now()
  const node = (workspace, id, title, hoursAgo, state = 'idle', children = []) => ({
    session: {
      ...workspace.threads[0].session,
      id,
      title,
      state,
      attention: null,
      lastActiveAt: now - hoursAgo * 3600_000,
    },
    children,
  })
  const child = node(claude, 'claude-child', 'Claude side thread', 0)
  const middle = node(claude, 'claude-middle', 'Claude middle thread', 2, 'idle', [child])
  const oldest = node(claude, 'claude-oldest', 'Claude oldest thread', 4, 'working')
  const newest = node(codex, 'codex:newest', 'Codex newest thread', 1)
  // Equal activity is ordered deterministically even when provider snapshots arrive reversed.
  const tied = node(codex, 'codex:tied', 'Codex tied thread', 2)
  const older = node(codex, 'codex:older', 'Codex older thread', 3)
  const elsewhere = {
    ...codex,
    id: 'codex:C:/synthetic/elsewhere',
    threads: [node(codex, 'codex:elsewhere', 'Unrelated folder', 0)],
  }
  claude.threads = [middle, oldest]
  claude.threadCount = 3
  codex.threads = [newest, tied, older]
  codex.threadCount = 3
  snapshot.workspaces = [claude, codex, elsewhere]
  const emit = () =>
    page.evaluate((snapshot) => window.proof.emit('onSnapshot', snapshot), snapshot)
  const waitForOrder = (expected) =>
    page.waitForFunction((expected) => {
      const ids = [...document.querySelectorAll('[data-session-id]')].map(
        (row) => row.dataset.sessionId,
      )
      return JSON.stringify(ids) === JSON.stringify(expected)
    }, expected)
  const order = [
    'codex:newest',
    'claude-middle',
    'claude-child',
    'codex:tied',
    'codex:older',
    'claude-oldest',
  ]
  await emit()
  await waitForOrder(order)
  assert.equal(await page.locator('header [data-thread-view]').innerText(), 'Workspace · 6')
  assert.equal(
    await page
      .locator('[data-session-id="claude-child"]')
      .evaluate((row) => Boolean(row.closest('[class*="_children_"]'))),
    true,
    'a newer side thread remains nested beneath its parent',
  )
  await capture('workspace-merged-by-time')
  const middleButton = page.locator('[data-session-id="claude-middle"] > button').first()
  await middleButton.click()
  assert.equal(await middleButton.getAttribute('aria-expanded'), 'true')
  snapshot.workspaces = [codex, elsewhere, claude]
  await emit()
  await waitForOrder(order)
  oldest.session.lastActiveAt = now + 1000
  await emit()
  await waitForOrder(['claude-oldest', ...order.slice(0, -1)])
  assert.equal(
    await middleButton.getAttribute('aria-expanded'),
    'true',
    'activity reordering preserves the expanded chat',
  )
  await middleButton.click()
  console.log(
    'PASS: mixed provider chronology, stable ties, nested side threads, workspace isolation and live reordering.',
  )
}
