/* global window, document */
import assert from 'node:assert/strict'

const stage = (page) => page.locator('#root > div').first()
const cardWidth = (page) =>
  page.evaluate(() =>
    Math.round(document.querySelector('[data-card]').getBoundingClientRect().width),
  )

const rowBox = (page, provider) =>
  page.evaluate((p) => {
    const row = document.querySelector(`[data-session-id][data-provider="${p}"]`)
    const r = row.getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) }
  }, provider)
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  )

/** Right-click the wire clip: Dual view widens the panel; Single view narrows it again. */
export async function checkPanelLayout(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const clip = page.getByRole('button', { name: /workspace wires$/ })
  try {
    // With only one provider there is nothing to put side by side, so there is no menu.
    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude'], panelLayout: 'single' }),
    )
    await clip.click({ button: 'right' })
    assert.equal(await page.getByRole('menu', { name: 'Panel layout' }).count(), 0)

    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
    )
    assert.equal(await cardWidth(page), 238, 'single view is the narrow column')
    assert.equal(await stage(page).getAttribute('data-wide'), null)

    await clip.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Panel layout' })
    await menu.waitFor()
    assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), ['Dual view'])
    await capture('panel-layout-menu')
    await menu.getByRole('menuitem', { name: 'Dual view' }).click()
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).panelLayout),
      'dual',
      'the choice is saved',
    )
    await page.waitForFunction(() => window.proof.layouts?.at(-1) === 'dual')
    assert.equal(await stage(page).getAttribute('data-wide'), 'true', 'the window widens first')
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 475,
    )
    assert.equal(await stage(page).getAttribute('data-dual'), 'true')
    // Once the card has grown the rows pull apart: Claude left, Codex right, gaps closed.
    await page.waitForFunction(() => {
      const left = document.querySelector('[data-session-id][data-provider="claude"]')
      const right = document.querySelector('[data-session-id][data-provider="codex"]')
      return left && right && left.getBoundingClientRect().left < right.getBoundingClientRect().left
    })
    await settled(page)
    const claude = await rowBox(page, 'claude')
    const codex = await rowBox(page, 'codex')
    assert.ok(claude.left < codex.left, 'Claude threads sit left of Codex threads')
    assert.ok(Math.abs(claude.top - codex.top) <= 1, 'the columns stack from the same top')
    assert.equal(claude.width, 236, 'a row is as wide as in the single column')
    assert.equal(codex.width, 236)
    await capture('panel-layout-dual')

    await clip.click({ button: 'right' })
    const back = page.getByRole('menu', { name: 'Panel layout' })
    assert.deepEqual(await back.getByRole('menuitem').allInnerTexts(), ['Single view'])
    await back.getByRole('menuitem', { name: 'Single view' }).click()
    await page.waitForFunction(() => window.proof.layouts?.at(-1) === 'single')
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 238,
    )
    assert.equal(await stage(page).getAttribute('data-wide'), null, 'the window narrows last')
    await settled(page)
    const stackedClaude = await rowBox(page, 'claude')
    const stackedCodex = await rowBox(page, 'codex')
    assert.equal(stackedClaude.left, stackedCodex.left, 'back to one column')
    assert.ok(stackedClaude.top > stackedCodex.top, 'the rows are one above the other again')

    // A saved dual layout is applied at once when the panel loads, without animating.
    await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'dual' }))
    await page.reload()
    await page.waitForFunction(
      () =>
        Math.round(document.querySelector('[data-card]')?.getBoundingClientRect().width) === 475,
    )
    // Turning a provider off drops back to one column without forgetting the choice.
    await page.evaluate(() => window.threadlight.updateSettings({ enabledProviders: ['codex'] }))
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 238,
    )
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).panelLayout),
      'dual',
    )
    console.log(
      'PASS: wire-clip right-click menu, single/dual choice saved, widen-then-grow and narrow-then-shrink order, instant restore on load, and one-provider fallback.',
    )
  } finally {
    await page.evaluate((settings) => window.threadlight.updateSettings(settings), {
      enabledProviders: initial.enabledProviders,
      panelLayout: initial.panelLayout,
    })
  }
}

/** Six interleaved threads (three each), so the columns have something to stack. */
async function withSixThreads(page) {
  await page.addInitScript(() => {
    const real = window.threadlight
    const decorate = (snap) => {
      if (!snap?.sessions || snap.sessions.length !== 2) return snap
      const claude = snap.sessions.find((s) => s.provider === 'claude')
      const codex = snap.sessions.find((s) => s.provider === 'codex')
      if (!claude || !codex) return snap
      const make = (source, id, title, minutes) => ({
        ...source,
        id,
        appId: id,
        title,
        attention: null,
        plan: [],
        stage: 'Idle',
        lastActiveAt: Date.now() - minutes * 60000,
      })
      const codexId = (n) => `codex:aaaaaaaa-0000-4000-8000-00000000000${n}`
      return {
        ...snap,
        sessions: [
          make(claude, 'claude-1', 'Live Voice Timer Fix', 2),
          make(codex, codexId(1), 'Handle UI changes and hotfixes', 4),
          make(claude, 'claude-2', 'Check sign-in launch integrations', 6),
          make(codex, codexId(2), 'Review and merge all work', 8),
          make(claude, 'claude-3', 'Add Threadlight to Hale.dev', 10),
          make(codex, codexId(3), 'Set up E2E monitoring', 12),
        ],
      }
    }
    window.threadlight = new Proxy(real, {
      get(target, name) {
        if (name === 'onSnapshot') return (fn) => real.onSnapshot((snap) => fn(decorate(snap)))
        if (name === 'getSnapshot') return async (...a) => decorate(await real.getSnapshot(...a))
        return real[name]
      },
    })
  })
  await page.reload()
  await page.waitForFunction(() => document.querySelectorAll('[data-session-id]').length === 6)
}

const rowTops = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-session-id]')].map((row) => [
        row.dataset.sessionId,
        Math.round(row.getBoundingClientRect().top),
      ]),
    ),
  )

/** Wires are hidden beside two columns, and an open thread only moves its own column. */
export async function checkDualDetails(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  try {
    await page.evaluate(() =>
      window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        workspaceWires: true,
        panelLayout: 'single',
        listMode: 'recent',
        maxSessions: 10,
      }),
    )
    await withSixThreads(page)
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-key]').length === 1)

    await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'dual' }))
    await page.waitForFunction(() => {
      const left = document.querySelector('[data-session-id="claude-1"]')
      const right = document.querySelector('[data-session-id^="codex:"]')
      return (
        left &&
        right &&
        left.getBoundingClientRect().left < right.getBoundingClientRect().left &&
        Math.abs(left.getBoundingClientRect().top - right.getBoundingClientRect().top) < 1
      )
    })
    await settled(page)
    assert.equal(await page.locator('[data-wire-key]').count(), 0, 'no wires beside two columns')
    assert.equal(
      await page.getByRole('button', { name: /workspace wires$/ }).count(),
      1,
      'the clip, and so its menu, stays',
    )

    const before = await rowTops(page)
    await page
      .getByRole('button', { name: /Check sign-in launch integrations/ })
      .first()
      .click()
    await settled(page)
    const after = await rowTops(page)
    for (const id of Object.keys(before).filter((key) => key.startsWith('codex:')))
      assert.equal(after[id], before[id], 'the other column does not move')
    assert.equal(after['claude-1'], before['claude-1'], 'rows above the open thread stay put')
    assert.ok(after['claude-3'] > before['claude-3'], 'rows below it make room')
    await capture('panel-layout-dual-expanded')

    await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'single' }))
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-key]').length === 1)
    console.log(
      'PASS: dual view hides the wires but keeps the clip, an open thread moves only its own column, and the wire returns in single view.',
    )
  } finally {
    await page.evaluate((settings) => window.threadlight.updateSettings(settings), {
      enabledProviders: initial.enabledProviders,
      panelLayout: initial.panelLayout,
      workspaceWires: initial.workspaceWires,
      listMode: initial.listMode,
      maxSessions: initial.maxSessions,
    })
  }
}
