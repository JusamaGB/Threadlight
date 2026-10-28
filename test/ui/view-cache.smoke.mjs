/* global window, document */
import assert from 'node:assert/strict'
import { selectThreadView } from './header-navigation.mjs'

export async function checkViewCache(page, capture) {
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'dual',
      listMode: 'recent',
    })
    window.proof.catalogReads = []
    window.proof.snapshotReads = 0
    const snapshot = window.threadlight.getSnapshot
    window.threadlight.getSnapshot = (...args) => {
      window.proof.snapshotReads++
      return snapshot(...args)
    }
    // Hold future discovery replies: view switches must use the already received catalog.
    window.threadlight.artifacts = (id) => {
      window.proof.catalogReads.push(id)
      return new Promise(() => {})
    }
    for (const threadId of ['synthetic-claude', 'codex:11111111-1111-4111-8111-111111111111'])
      window.proof.emit('onArtifactsChanged', {
        threadId,
        items: [
          {
            id: 'cached',
            title: 'Cached storyboard.html',
            kind: 'html',
            mime: 'text/html',
            createdAt: 1,
          },
        ],
      })
  })
  const view = page.locator('header [data-thread-view]')
  const choose = async (name) => {
    if ((await view.getAttribute('data-thread-view')) === name.toLowerCase()) return
    await selectThreadView(page, name.toLowerCase())
    await page.waitForFunction(
      (name) =>
        document.querySelector('header [data-thread-view]')?.getAttribute('data-thread-view') ===
        name.toLowerCase(),
      name,
    )
  }
  for (const name of ['Recent', 'Workspace', 'Active', 'Recent', 'Workspace', 'Recent']) {
    await choose(name)
    assert.equal(
      await page.locator('[data-session-id="synthetic-claude"]').count(),
      1,
      `${name}: Claude remains available`,
    )
    assert.equal(
      await page.locator('[data-session-id^="codex:"]').count(),
      1,
      `${name}: Codex remains available`,
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Open artifact: Cached storyboard.html', exact: true })
        .count(),
      2,
      `${name}: chips render without waiting for discovery`,
    )
  }
  assert.equal(
    await page.evaluate(() => window.proof.snapshotReads),
    0,
    'switches do not refetch snapshots',
  )
  const reads = await page.evaluate(() => window.proof.catalogReads)
  assert.equal(reads.length, new Set(reads).size, 'remounts share each pending discovery request')
  await page.evaluate(() =>
    window.proof.emit('onArtifactsChanged', {
      threadId: 'synthetic-claude',
      items: [
        {
          id: 'new',
          title: 'New live artifact.html',
          kind: 'html',
          mime: 'text/html',
          createdAt: 2,
        },
      ],
    }),
  )
  await page
    .getByRole('button', { name: 'Open artifact: New live artifact.html', exact: true })
    .waitFor()
  await capture('cached-views-live-artifacts')
  // Preloading extra rows must not change All view's count or Show more behavior.
  await page.evaluate(async () => {
    window.proof.emit('onSnapshot', await window.mockWorkspaceRows(14))
  })
  await choose('All')
  for (const header of await page.locator('button[class*="_workspaceHeader_"]').all()) {
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  }
  assert.equal(await page.locator('[data-session-id]').count(), 20)
  const more = page.getByRole('button', { name: 'Show 4 more', exact: true })
  assert.equal(await more.count(), 2)
  await more.first().click()
  assert.equal(await page.locator('[data-session-id]').count(), 24)
  await more.click()
  assert.equal(await page.locator('[data-session-id]').count(), 28)
}
