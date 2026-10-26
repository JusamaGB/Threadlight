/* global window, document, innerWidth */
import assert from 'node:assert/strict'
import { chromium, previewUrl, outputPath } from './runtime.mjs'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1040, height: 920 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${previewUrl}/workspace-links.html`)
  await page.waitForFunction(() => window.workspaceWiresPreview?.inspect().layoutVersion > 0)
  const inspect = () => page.evaluate(() => window.workspaceWiresPreview.inspect())
  const initial = await inspect()
  assert.equal(await page.locator('[data-wire-toggle]').getAttribute('aria-pressed'), 'false')
  await page.locator('.panel-stage').screenshot({ path: outputPath('workspace-links-cut.png') })
  await page.getByRole('button', { name: 'Show workspace wires', exact: true }).click()
  assert.equal(await page.locator('[data-wire-toggle]').getAttribute('aria-pressed'), 'true')
  assert.equal(initial.layout[0].railX, 12, 'first rail stays four pixels outside the card')
  const main = initial.groups.find((group) => group.ids.includes('review'))
  assert.equal(initial.panelWidth, 300)
  assert.equal(initial.panelInset, 16)
  assert.ok(
    initial.layout.every((group) => group.railX < initial.panelInset),
    'rails sit outside the panel',
  )
  assert.equal(initial.groups.length, 3)
  assert.deepEqual(main.ids, ['review', 'motion', 'agent', 'hotfix'])
  assert.deepEqual(new Set(main.providers), new Set(['claude', 'codex']))
  assert.ok(
    initial.groups.every(
      (group) => !group.ids.includes('other-worktree') && !group.ids.includes('unknown'),
    ),
  )
  assert.equal(new Set(initial.groups.map((group) => group.lane)).size, 3)
  const row = (id) => page.locator(`[data-thread-id="${id}"]`)
  await row('motion').hover()
  assert.equal(await page.locator('.thread-row[data-match]').count(), 4)
  assert.equal(await page.locator('.wire-group[data-highlight]').count(), 1)
  await page
    .locator('.panel-stage')
    .screenshot({ path: outputPath('workspace-links-main-trace.png') })
  const before = initial.layout.find((group) => group.key === main.key).points.at(-1).y
  await row('review').getByRole('button').click()
  await page.waitForFunction(
    (version) => window.workspaceWiresPreview.inspect().layoutVersion > version,
    initial.layoutVersion,
  )
  const expanded = await inspect()
  assert.ok(expanded.layout.find((group) => group.key === main.key).points.at(-1).y > before + 40)
  await page
    .locator('.panel-stage')
    .screenshot({ path: outputPath('workspace-links-expanded.png') })
  await page
    .locator('.legend')
    .getByRole('button', { name: 'Threadlight · 4', exact: true })
    .click()
  await page.locator('.scroll').evaluate((element) => (element.scrollTop = 230))
  await page.waitForFunction(
    (before) =>
      window.workspaceWiresPreview.inspect().layout.find((group) => group.key === before.key)
        .points[0].y <
      before.y - 100,
    { key: main.key, y: expanded.layout.find((group) => group.key === main.key).points[0].y },
  )
  assert.equal(await page.locator('.thread-row[data-match]').count(), 4)
  await page
    .locator('.panel-stage')
    .screenshot({ path: outputPath('workspace-links-scrolled.png') })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.wire-group[data-highlight]').count(), 0)
  await row('quiz-audio').getByRole('button').focus()
  assert.equal(await page.locator('.thread-row[data-match]').count(), 3)
  await page.getByRole('button', { name: 'Change thread order', exact: true }).click()
  await page.waitForFunction(
    (version) => window.workspaceWiresPreview.inspect().layoutVersion > version,
    expanded.layoutVersion,
  )
  const reordered = await inspect()
  assert.deepEqual(
    new Set(reordered.groups.find((group) => group.key === main.key).ids),
    new Set(main.ids),
  )
  await page.getByLabel('List', { exact: true }).selectOption('active')
  await page.waitForFunction(() => window.workspaceWiresPreview.inspect().groups.length === 2)
  assert.equal(await row('other-worktree').count(), 0)
  await page.locator('.panel-stage').screenshot({ path: outputPath('workspace-links-active.png') })
  await page.getByLabel('List', { exact: true }).selectOption('workspace')
  await page.waitForFunction(() => window.workspaceWiresPreview.inspect().groups.length === 1)
  assert.equal(await page.locator('.thread-row').count(), 4)
  const withLinks = (await row('review').locator('.title').boundingBox()).x
  await page.locator('#show-links').uncheck()
  const withoutLinks = (await row('review').locator('.title').boundingBox()).x
  assert.equal(withLinks, withoutLinks, 'outside wires consume no title space')
  await page.getByRole('button', { name: 'Show workspace wires', exact: true }).press('Enter')
  await page.getByLabel('List', { exact: true }).selectOption('interleaved')
  await page.getByLabel('Layer wires on one rail').check()
  await page.waitForFunction(
    () =>
      new Set(window.workspaceWiresPreview.inspect().layout.map((group) => group.railX)).size === 1,
  )
  await page
    .locator('.legend')
    .getByRole('button', { name: 'Threadlight · 4', exact: true })
    .click()
  assert.equal(await page.locator('.thread-row[data-match]').count(), 4)
  assert.equal(await page.locator('.wire-group').last().getAttribute('data-highlight'), '')
  await page.locator('.scroll').evaluate((element) => (element.scrollTop = 0))
  await page
    .locator('.panel-stage')
    .screenshot({ path: outputPath('workspace-links-shared-rail.png') })
  await page.getByLabel('Layer wires on one rail').uncheck()
  await page.setViewportSize({ width: 360, height: 900 })
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
  assert.ok(
    await page.locator('.panel').evaluate((element) => element.scrollWidth <= element.clientWidth),
  )
  await page.screenshot({ path: outputPath('workspace-links-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1040, height: 920 })
  await page.locator('.scroll').evaluate((element) => (element.scrollTop = 0))
  await page.screenshot({ path: outputPath('workspace-links-proposal.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'PASS: cross-provider exact-folder links, separate worktree/unknown exclusions, lanes, hover/focus, expansion, scrolling, reorder, filters, gutter comparison and narrow layout.',
  )
} finally {
  await browser.close()
}
