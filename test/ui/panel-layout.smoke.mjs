import { openHeaderPage, selectThreadView } from './header-navigation.mjs'
/* global window, document, requestAnimationFrame */
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

/** Right-click a thread: Dual view widens the panel; Single view narrows it again. */
export async function checkPanelLayout(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  const row = page.getByRole('button', { name: /Synthetic/ }).first()
  const threadMenu = async () => {
    await row.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await menu.waitFor()
    return menu
  }
  const showRecent = async () => {
    await selectThreadView(page, 'recent')
  }
  try {
    // With only one provider there is nothing to put side by side, so the thread menu has no
    // layout item.
    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude'], panelLayout: 'single' }),
    )
    await showRecent()
    const single = await threadMenu()
    assert.equal(await single.getByRole('menuitem', { name: /view$/ }).count(), 0)
    await page.keyboard.press('Escape')

    await page.evaluate(() =>
      window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
    )
    assert.equal(await cardWidth(page), 238, 'single view is the narrow column')
    assert.equal(await stage(page).getAttribute('data-wide'), null)

    const menu = await threadMenu()
    assert.equal(await menu.getByRole('menuitem', { name: 'Dual view' }).count(), 1)
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

    // Active is not a dual view: the card narrows to one column and no layout item is offered,
    // but the saved choice returns with the Recent list.
    await selectThreadView(page, 'active')
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 238,
    )
    const active = await threadMenu()
    assert.equal(await active.getByRole('menuitem', { name: /view$/ }).count(), 0)
    await page.keyboard.press('Escape')
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).panelLayout),
      'dual',
      'leaving Active does not forget the choice',
    )
    await showRecent()
    await page.waitForFunction(
      () => Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 475,
    )

    // Shared Spaces, the Agent and Settings use the thin card: the panel narrows while one is
    // open and goes back to the two columns when it closes. The saved choice stays dual.
    const narrow = () =>
      page.waitForFunction(
        () =>
          Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 238,
      )
    const wide = () =>
      page.waitForFunction(
        () =>
          Math.round(document.querySelector('[data-card]').getBoundingClientRect().width) === 475,
      )
    for (const [open, back] of [
      ['Settings', 'Back to sessions'],
      ['Shared Spaces', 'Back in Shared Spaces'],
      ['Agent', 'Back to sessions'],
    ]) {
      if (open === 'Settings') await page.getByRole('button', { name: open, exact: true }).click()
      else await openHeaderPage(page, open)
      await narrow()
      await page.waitForFunction(
        () => document.querySelector('#root > div').getAttribute('data-wide') === null,
      )
      assert.equal(await stage(page).getAttribute('data-dual'), null, `${open} uses the thin card`)
      await page.getByRole('button', { name: back, exact: true }).click()
      await wide()
      assert.equal(await stage(page).getAttribute('data-dual'), 'true', `${open} gives it back`)
      assert.equal(
        await page.evaluate(async () => (await window.threadlight.getSettings()).panelLayout),
        'dual',
      )
    }

    const back = await threadMenu()
    assert.equal(await back.getByRole('menuitem', { name: 'Dual view' }).count(), 0)
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

    // A saved dual layout waits for a dual-capable list: the panel opens on Active (one column)
    // and widens once Recent is chosen.
    await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'dual' }))
    await page.reload()
    await page.waitForFunction(
      () =>
        Math.round(document.querySelector('[data-card]')?.getBoundingClientRect().width) === 238,
    )
    // Moving between lists changes the rows themselves, so the columns open with the card: no
    // frame may show the card grown with every row still in one column, and no row may glide.
    await page.evaluate(() => {
      window.layoutProof = { crammed: 0, gliding: 0, frames: 0, stop: false }
      const sample = () => {
        const proof = window.layoutProof
        const stage = document.querySelector('#root > div')
        const left = document.querySelector('[class*="_dualLeft_"]')
        const rows = document.querySelectorAll('[data-session-id]')
        proof.frames++
        if (stage?.dataset.dual && left && !left.hasAttribute('data-split') && rows.length)
          proof.crammed++
        if ([...rows].some((row) => row.getAnimations().length > 0)) proof.gliding++
        if (!proof.stop) requestAnimationFrame(sample)
      }
      sample()
    })
    await showRecent()
    await page.waitForFunction(
      () =>
        Math.round(document.querySelector('[data-card]')?.getBoundingClientRect().width) === 475,
    )
    await page.waitForTimeout(800)
    await selectThreadView(page, 'active')
    await narrow()
    await page.waitForTimeout(800)
    const proof = await page.evaluate(() => {
      window.layoutProof.stop = true
      return window.layoutProof
    })
    assert.ok(proof.frames > 30, 'the transition was sampled')
    assert.equal(proof.crammed, 0, 'rows are never crammed into one column of a grown card')
    assert.equal(proof.gliding, 0, 'changing list does not glide the rows')
    await showRecent()
    await wide()
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
      'PASS: thread right-click menu item, single/dual choice saved, widen-then-grow and narrow-then-shrink order, saved dual waiting for Recent after a reload, and one-provider fallback, and the thin card for Settings, Shared Spaces and the Agent.',
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
      const sessions = [
        make(claude, 'claude-1', 'Live Voice Timer Fix', 2),
        make(codex, codexId(1), 'Handle UI changes and hotfixes', 4),
        make(claude, 'claude-2', 'Check sign-in launch integrations', 6),
        make(codex, codexId(2), 'Review and merge all work', 8),
        make(claude, 'claude-3', 'Add Threadlight to Hale.dev', 10),
        make(codex, codexId(3), 'Set up E2E monitoring', 12),
      ]
      // The same threads, grouped into the one workspace they share, for the Workspace list.
      const workspace = snap.workspaces?.[0]
      return {
        ...snap,
        sessions,
        workspaces: workspace
          ? [
              {
                ...workspace,
                threadCount: sessions.length,
                threads: sessions.map((session) => ({ session, children: [] })),
              },
            ]
          : snap.workspaces,
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

/** The wire runs down the divider beside two columns, and an open thread only moves its own column. */
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

    // The panel opens on Active, which stays one column; dual belongs to Recent.
    await selectThreadView(page, 'recent')
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
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-key]').length === 1)
    const centred = await page.evaluate(() => {
      const strip = document.querySelector('[data-wire-zone="centre"]').getBoundingClientRect()
      const right = document.querySelector('[data-dual-right]').getBoundingClientRect()
      const wire = document.querySelector('[data-wire-key]')
      return {
        offset: strip.left + strip.width / 2 - right.left,
        lane: wire.dataset.lane,
        members: wire.dataset.members,
      }
    })
    assert.ok(Math.abs(centred.offset) <= 1, 'the strip is centred on the divider')
    assert.equal(centred.lane, '0', 'the one group is the longest, so it is dead centre')
    assert.equal(
      await page.getByRole('button', { name: /workspace wires$/ }).count(),
      1,
      'the clip stays',
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

    // The Workspace list splits the same way: Claude's threads left, Codex's right.
    await page.evaluate(() =>
      window.threadlight.updateSettings({ listMode: 'workspace', panelLayout: 'dual' }),
    )
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
    assert.equal(await page.locator('[data-session-id]').count(), 6, 'every thread is listed once')
    await capture('panel-layout-dual-workspace')
    console.log(
      'PASS: dual view runs the wire down the divider and keeps the clip, an open thread moves only its own column, the Workspace list splits by provider, and the wire returns in single view.',
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

/** A very long list still splits into its two columns, just without the gliding animation. */
export async function checkDualLong(page) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  try {
    // Every snapshot the panel receives carries 140 idle threads, however settings change.
    await page.addInitScript(() => {
      const real = window.threadlight
      const decorate = (snap) => {
        if (!snap?.sessions?.length || snap.sessions.length > 6) return snap
        const base = snap.sessions[0]
        const sessions = Array.from({ length: 140 }, (_, i) => ({
          ...base,
          id: `${i % 2 ? 'codex:' : ''}long-${i}`,
          appId: `long-${i}`,
          title: `Long ${i}`,
          state: 'idle',
          attention: null,
          provider: i % 2 ? 'codex' : 'claude',
          lastActiveAt: Date.now() - i * 60000,
        }))
        return { ...snap, sessions, workspaces: [] }
      }
      window.threadlight = new Proxy(real, {
        get(target, name) {
          if (name === 'onSnapshot') return (fn) => real.onSnapshot((snap) => fn(decorate(snap)))
          if (name === 'getSnapshot') return async (...a) => decorate(await real.getSnapshot(...a))
          return real[name]
        },
      })
    })
    await page.evaluate(() =>
      window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        listMode: 'recent',
        maxSessions: 50,
        panelLayout: 'single',
      }),
    )
    await page.reload()
    const view = page.locator('[data-thread-view]')
    await view.waitFor()
    if ((await view.getAttribute('data-thread-view')) !== 'recent') {
      await selectThreadView(page, 'recent')
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-session-id]').length === 140)
    await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'dual' }))
    await page.waitForFunction(() => {
      const left = document.querySelector('[data-session-id="long-0"]')
      const right = document.querySelector('[data-session-id="codex:long-1"]')
      return (
        left &&
        right &&
        left.getBoundingClientRect().left < right.getBoundingClientRect().left &&
        Math.abs(left.getBoundingClientRect().top - right.getBoundingClientRect().top) < 1
      )
    })
    assert.equal(
      await page.evaluate(
        () =>
          [...document.querySelectorAll('[data-session-id]')].filter(
            (row) => row.getAnimations().length > 0,
          ).length,
      ),
      0,
      'a long list is rearranged without animating every row',
    )
    console.log('PASS: a list of 140 threads splits into its columns without per-row animation.')
  } finally {
    await page.evaluate((settings) => window.threadlight.updateSettings(settings), {
      enabledProviders: initial.enabledProviders,
      panelLayout: initial.panelLayout,
      listMode: initial.listMode,
      maxSessions: initial.maxSessions,
    })
  }
}
