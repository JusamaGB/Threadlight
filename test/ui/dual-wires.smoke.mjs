import { selectThreadView } from './header-navigation.mjs'
/* global window, document, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict'

/** Real lists, measured anchors and production SVG routing, with synthetic thread membership. */
export async function checkDualWires(page, capture) {
  await page.setViewportSize({ width: 700, height: 1000 })
  await page.addInitScript(() => {
    const real = window.threadlight
    window.dualWireMode = 'all'
    const decorate = (snapshot) => {
      if (!snapshot?.sessions?.length) return snapshot
      const base = snapshot.sessions[0]
      const make = (codex, name, group, order) => ({
        ...base,
        id: `${codex ? 'codex:' : ''}${name}`,
        appId: name,
        provider: codex ? 'codex' : 'claude',
        title: name,
        stage: 'Ready',
        state: 'idle',
        attention: null,
        threadDiff: null,
        threadDiffStatus: 'ready',
        plan: [],
        planText: null,
        replyText: 'Expanded thread detail for wire geometry.',
        lastActiveAt: Date.now() - order * 60000,
        git: {
          root: `C:/wire-${group}`,
          branch: 'main',
          added: 0,
          removed: 0,
          files: 0,
          newFiles: 0,
          ahead: 0,
          behind: 0,
          worktrees: [`C:/wire-${group}`],
        },
      })
      const sessions = [
        make(false, 'Claude shared first', 'shared', 0),
        make(false, 'Claude outer first', 'claude', 2),
        make(false, 'Claude short first', 'claude-short', 4),
        make(false, 'Claude short last', 'claude-short', 6),
        make(false, 'Claude shared last', 'shared', 8),
        make(false, 'Claude outer last', 'claude', 10),
        make(true, 'Codex outer first', 'codex', 1),
        make(true, 'Codex short first', 'codex-short', 3),
        make(true, 'Codex shared first', 'shared', 5),
        make(true, 'Codex short last', 'codex-short', 7),
        make(true, 'Codex outer last', 'codex', 9),
        make(true, 'Codex shared last', 'shared', 11),
      ].filter(
        (s) =>
          (window.dualWireMode !== 'singleton' || !s.title.includes('shared last')) &&
          (!window.dualWireProviders || window.dualWireProviders.includes(s.provider)),
      )
      if (window.dualWireMode !== 'all')
        for (const session of sessions)
          if (session.provider === 'codex' && session.title.includes('shared'))
            session.git.root = 'C:/wire-codex'
      const nodes = sessions.map((session) => ({ session, children: [] }))
      // Workspace view includes a nested thread; its root still owns the same outside wire.
      const nested = nodes.find((n) => n.session.title === 'Claude outer last')
      if (nested) nodes.find((n) => n.session.title === 'Claude outer first').children.push(nested)
      const workspace = {
        ...snapshot.workspaces[0],
        name: 'Wire project',
        activeCount: 0,
        threadCount: sessions.length,
        hiddenCount: 0,
        worktrees: 0,
        threads: nodes.filter((n) => n !== nested),
      }
      return { ...snapshot, sessions, workspaces: [workspace], allWorkspaces: [workspace] }
    }
    window.threadlight = new Proxy(real, {
      get(target, name) {
        if (name === 'getSnapshot') return async () => decorate(await real.getSnapshot())
        if (name === 'onSnapshot')
          return (fn) => real.onSnapshot((snapshot) => fn(decorate(snapshot)))
        return target[name]
      },
    })
  })
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'dual',
      workspaceWires: true,
      listMode: 'recent',
      maxSessions: 50,
    }),
  )
  await page.reload()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const recent = async () => {
    await selectThreadView(page, 'recent')
  }
  await recent()
  const settled = async () => {
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((a) => a.playState !== 'running' || a.effect.getTiming().iterations === Infinity),
    )
    // ResizeObserver and the wire overlay finish their queued paint after the animation.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
  }
  const routes = () =>
    page.locator('[data-wire-key]').evaluateAll((groups) =>
      Object.fromEntries(
        groups.map((g) => [
          g.dataset.wireKey,
          {
            zone: g.dataset.wireZone,
            lane: Number(g.dataset.lane),
            members: Number(g.dataset.members),
          },
        ]),
      ),
    )
  let workspace = false
  const checkGeometry = async () => {
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-wire-key]').length === 5 &&
        document.querySelector('[data-wire-zone="centre"]') &&
        document.querySelector('[data-dual]'),
    )
    await settled()
    const wires = await routes()
    assert.deepEqual(wires, {
      'c:/wire-claude': { zone: 'left', lane: 0, members: 2 },
      'c:/wire-claude-short': { zone: 'left', lane: workspace ? 0 : 1, members: 2 },
      'c:/wire-codex': { zone: 'right', lane: 0, members: 2 },
      'c:/wire-codex-short': { zone: 'right', lane: 1, members: 2 },
      'c:/wire-shared': { zone: 'centre', lane: 0, members: 4 },
    })
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('[data-card]').getBoundingClientRect()
      const overlay = document.querySelector('[data-workspace-links]').getBoundingClientRect()
      const divider = document.querySelector('[data-dual-right]').getBoundingClientRect().left
      return {
        card: card.toJSON(),
        overlay: overlay.toJSON(),
        divider,
        groups: [...document.querySelectorAll('[data-wire-key]')].map((g) => ({
          zone: g.dataset.wireZone,
          box: g.getBoundingClientRect().toJSON(),
          first: g.querySelector('path').getPointAtLength(0).y + overlay.top,
          anchors: [...document.querySelectorAll('[data-workspace-folder]')]
            .filter((row) => row.dataset.workspaceFolder === g.dataset.wireKey)
            .map((row) => {
              const box = row.querySelector('[data-workspace-anchor]').getBoundingClientRect()
              return box.top + box.height / 2
            }),
        })),
        pointer: getComputedStyle(document.querySelector('[data-workspace-links]')).pointerEvents,
      }
    })
    assert.equal(geometry.card.width, 475)
    assert.equal(geometry.overlay.width, 501)
    assert.equal(geometry.card.left - geometry.overlay.left, 16)
    assert.equal(geometry.overlay.right - geometry.card.right, 10)
    assert.equal(geometry.pointer, 'none')
    for (const { zone, box, first, anchors } of geometry.groups) {
      assert.ok(
        Math.abs(first - Math.min(...anchors)) < 0.1,
        'wire starts at the measured first row',
      )
      assert.ok(
        Math.abs(box.bottom - Math.max(...anchors)) < 0.1,
        'wire ends at the measured last row',
      )
      if (zone === 'left') assert.ok(box.right <= geometry.card.left + 0.1)
      if (zone === 'right') assert.ok(box.left >= geometry.card.right - 0.1)
      if (zone === 'centre')
        assert.ok(box.left >= geometry.divider - 9 && box.right <= geometry.divider + 9)
    }
  }
  await settled()
  await checkGeometry()
  await capture('dual-wires-three-zones')

  const leftRow = page.locator('[data-session-id="Claude outer first"]')
  await leftRow.hover()
  await page.locator('[data-wire-zone="left"][data-highlight]').waitFor()
  assert.equal(await page.locator('[data-wire-linked]').count(), 2)
  const leftPath = page.locator('[data-wire-key="c:/wire-claude"] path').first()
  const before = await leftPath.getAttribute('d')
  await leftRow.locator('button[aria-expanded]').click()
  await page.waitForFunction(
    (before) =>
      document.querySelector('[data-wire-key="c:/wire-claude"] path').getAttribute('d') !== before,
    before,
  )
  assert.equal((await routes())['c:/wire-codex'].zone, 'right')
  await capture('dual-wires-expanded')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-wire-linked]').count(), 0)

  await page.evaluate(() =>
    window.proof.emit('onPanelOpened', { maxHeight: 260, opensDown: true, fresh: false }),
  )
  const list = page.locator('[data-workspace-thread-list]')
  const scrollPath = await leftPath.getAttribute('d')
  await list.evaluate((list) => {
    list.scrollTop = 25
  })
  await page.waitForFunction(
    (before) =>
      document.querySelector('[data-wire-key="c:/wire-claude"] path').getAttribute('d') !== before,
    scrollPath,
  )
  const clip = await page.evaluate(() => {
    const list = document.querySelector('[data-workspace-thread-list]').getBoundingClientRect()
    const overlay = document.querySelector('[data-workspace-links]').getBoundingClientRect()
    return Math.abs(list.top - overlay.top) < 1 && Math.abs(list.height - overlay.height) < 1
  })
  assert.equal(clip, true, 'all zones clip to the list viewport')
  await list.evaluate((list) => {
    list.scrollTop = 0
  })
  await page.evaluate(() =>
    window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: false }),
  )

  // Entire groups move to the outside as their last counterpart disappears.
  await page.evaluate(async () => {
    window.dualWireMode = 'exclusive'
    window.proof.emit('onSnapshot', await window.threadlight.getSnapshot())
  })
  await page.waitForFunction(() => !document.querySelector('[data-wire-zone="centre"]'))
  assert.equal((await routes())['c:/wire-shared'].zone, 'left')
  assert.equal((await routes())['c:/wire-codex'].members, 4)
  await page.evaluate(async () => {
    window.dualWireMode = 'singleton'
    window.proof.emit('onSnapshot', await window.threadlight.getSnapshot())
  })
  await page.waitForFunction(() => document.querySelectorAll('[data-wire-key]').length === 4)
  assert.equal((await routes())['c:/wire-shared'], undefined)
  await page.evaluate(async () => {
    window.dualWireMode = 'all'
    window.proof.emit('onSnapshot', await window.threadlight.getSnapshot())
  })
  await checkGeometry()

  // Every zone is controlled by the existing single toggle.
  await page.locator('[data-wire-toggle]').click()
  await page.waitForFunction(() => !document.querySelector('[data-wire-key]'))
  await page.waitForFunction(() => window.proof.rightWireGutter === 0)
  assert.equal(
    await page.locator('#root > div').evaluate((node) => node.getBoundingClientRect().width),
    491,
  )
  await page.locator('[data-wire-toggle]').press('Enter')
  await checkGeometry()
  workspace = true
  await page.evaluate(() => window.threadlight.updateSettings({ listMode: 'workspace' }))
  await page.waitForFunction(() => document.querySelector('[class*="_workspace_"]'))
  const header = page.getByRole('button', { name: /Wire project/ }).first()
  if (await header.count()) {
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  }
  await checkGeometry()
  assert.equal(
    await page
      .locator('[data-session-id="Claude outer last"]')
      .evaluate((row) =>
        row.closest('[style*="--thread-inset"]').style.getPropertyValue('--thread-inset'),
      ),
    '15px',
  )
  await capture('dual-wires-workspace-nested')

  // Animated transitions settle to the same routing, then reduced motion does so instantly.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'single' }))
  await settled()
  await page.waitForFunction(() => !document.querySelector('[data-dual]'))
  assert.equal(await page.locator('[data-wire-zone="left"]').count(), 5)
  assert.equal(await page.locator('[data-wire-zone="right"], [data-wire-zone="centre"]').count(), 0)
  assert.equal(
    await page.locator('[data-workspace-links]').evaluate((el) => el.getBoundingClientRect().width),
    16,
  )
  await page.evaluate(() => window.threadlight.updateSettings({ panelLayout: 'dual' }))
  await settled()
  await checkGeometry()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => {
    window.dualWireProviders = ['codex']
    return window.threadlight.updateSettings({ enabledProviders: ['codex'] })
  })
  await page.waitForFunction(() => !document.querySelector('[data-wide]'))
  await page.waitForFunction(
    () => !document.querySelector('[data-wire-zone="right"], [data-wire-zone="centre"]'),
  )
  assert.equal(await page.locator('[data-session-id^="codex:"]').count(), 6)
  assert.equal(await page.locator('[data-session-id]:not([data-session-id^="codex:"])').count(), 0)
  await page.evaluate(() => {
    window.dualWireProviders = ['claude', 'codex']
    return window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] })
  })
  await checkGeometry()
  console.log(
    'PASS: all three dual wire zones, independent lanes, outside bounds, hover, expansion, scrolling, membership/filter changes, singleton removal, toggle, nested Workspace rows and animated/reduced-motion layout changes.',
  )
}
