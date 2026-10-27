/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'

export async function checkWorkspaceLinks(page, capture) {
  const original = await page.evaluate(async () => ({
    snapshot: await window.threadlight.getSnapshot(),
    settings: await window.threadlight.getSettings(),
  }))
  try {
    await page.evaluate(() =>
      window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        listMode: 'recent',
        workspaceWires: false,
      }),
    )
    await page.locator('header [data-thread-view]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Recent', exact: true }).click()
    await page.evaluate(async () => {
      const snapshot = await window.threadlight.getSnapshot(),
        base = snapshot.sessions[0]
      const make = (id, root, title) => ({
        ...base,
        id,
        title,
        state: 'working',
        attention: null,
        plan: [],
        thinking: false,
        cwd: 'C:/broad-parent',
        git: {
          root,
          branch: 'main',
          added: 0,
          removed: 0,
          files: 0,
          newFiles: 0,
          ahead: 0,
          behind: 0,
          worktrees: [root],
        },
      })
      const sessions = [
        make('wire-claude', 'C:/same-folder', 'Wire Claude'),
        make('codex:wire', 'c:\\SAME-FOLDER\\', 'Wire Codex'),
        make('codex:other', 'C:/other-worktree', 'Separate worktree'),
        ...Array.from({ length: 14 }, (_, i) =>
          make(`filler-${i}`, `C:/unique-${i}`, `Filler ${i}`),
        ),
        make('wire-last', 'C:/same-folder', 'Last linked thread'),
      ]
      sessions.push({
        ...base,
        id: 'unknown-wire',
        cwd: '',
        git: null,
        attention: null,
        state: 'working',
        title: 'Unknown folder',
      })
      window.proof.wireSnapshot = { ...snapshot, sessions }
      window.proof.savedWireView = window.threadlight.setTreeView
      window.threadlight.setTreeView = () => {}
      window.proof.savedWireUpdate = window.threadlight.updateSettings
      window.threadlight.updateSettings = async (patch) => {
        const result = await window.proof.savedWireUpdate(patch)
        window.proof.emit('onSnapshot', window.proof.wireSnapshot)
        return result
      }
      window.proof.emit('onSnapshot', window.proof.wireSnapshot)
      window.proof.emit('onPanelOpened', { maxHeight: 280, opensDown: true, fresh: false })
    })
    const toggle = page.locator('[data-wire-toggle]')
    const wire = toggle.locator('[data-header-wire]')
    await wire.locator('.conductor').waitFor()
    const target = await toggle.boundingBox()
    assert.equal(target.width, 16)
    assert.equal(target.height, 24)
    assert.equal(await wire.locator('.conductor').getAttribute('stroke'), '#737b86')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => {
      const burst = document.querySelector('[data-header-wire] .discharge')
      if (Number(burst?.style.opacity) < 0.9) return false
      const sparks = [...document.querySelectorAll('[data-header-wire] .embers path')].filter(
        (p) => Number(p.getAttribute('opacity')) > 0.4,
      )
      return sparks.length >= 10 && Math.min(...sparks.map((p) => p.getBBox().x)) < 8
    })
    await capture('workspace-wires-bright-spark')
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await page.locator('[data-wire-key]').count(), 0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(
      () => document.querySelector('[data-header-wire] .discharge')?.style.opacity === '0.18',
    )
    const still = await wire.screenshot()
    await page.waitForTimeout(150)
    assert.deepEqual(await wire.screenshot(), still, 'reduced motion holds the live wire steady')
    await capture('workspace-wires-cut')
    await page.getByRole('button', { name: 'Show workspace wires', exact: true }).click()
    await page.waitForFunction(
      () =>
        document.querySelector('[data-header-wire] .conductor')?.getAttribute('stroke') ===
        '#aacfd6',
    )
    assert.equal(await wire.locator('.live-halo').getAttribute('opacity'), '.22')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-header-wire] .travelling-core path')].some(
        (p) => Number(p.getAttribute('opacity')) > 0.1,
      ),
    )
    const moving = await wire.locator('.travelling-core').innerHTML()
    await page.waitForFunction(
      (before) =>
        document.querySelector('[data-header-wire] .travelling-core')?.innerHTML !== before,
      moving,
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(
      () => document.querySelector('[data-wire-key]')?.getAttribute('data-members') === '3',
    )
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).workspaceWires),
      true,
    )
    assert.equal(
      await page
        .locator('[data-wire-key] path')
        .first()
        .evaluate((path) => path.getBBox().x),
      12,
      'first rail sits four pixels outside the panel',
    )
    assert.equal(
      await page.locator('[data-wire-key]').count(),
      1,
      'separate worktrees and unknown paths are excluded',
    )
    const card = await page.locator('[data-card]').boundingBox(),
      wires = await page.locator('[data-workspace-links]').boundingBox()
    assert.equal(card.width, 238)
    assert.equal(card.x - wires.x, 16)
    const list = page.getByRole('region', { name: 'Threads', exact: true })
    assert.equal(await page.getByRole('scrollbar').count(), 0)
    assert.equal(await list.evaluate((el) => getComputedStyle(el).scrollbarWidth), 'none')
    assert.equal(await list.evaluate((el) => el.offsetWidth - el.clientWidth), 0)
    const row = page.locator('[data-session-id="wire-claude"]')
    await row.hover()
    await page.locator('[data-wire-key][data-highlight]').waitFor()
    const before = await page.locator('[data-wire-key] path').first().getAttribute('d')
    await row.locator('button[aria-expanded]').first().click()
    await page.waitForFunction(
      (before) => document.querySelector('[data-wire-key] path')?.getAttribute('d') !== before,
      before,
    )
    await capture('workspace-wires-production')
    const expanded = await page.locator('[data-wire-key] path').first().getAttribute('d')
    await list.hover()
    await page.mouse.wheel(0, 100)
    await page.waitForFunction(
      (before) => document.querySelector('[data-wire-key] path')?.getAttribute('d') !== before,
      expanded,
    )
    assert.ok(
      await page.locator('[data-workspace-thread-list]').evaluate((list) => list.scrollTop > 0),
      'native wheel scrolling remains available without a scrollbar',
    )
    await list.press('Home')
    await page.waitForFunction(
      () => document.querySelector('[data-workspace-thread-list]').scrollTop === 0,
    )
    await list.press('End')
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-workspace-thread-list]')
      return Math.abs(list.scrollTop - (list.scrollHeight - list.clientHeight)) < 1
    })
    await list.hover()
    await page.mouse.wheel(0, -100)
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-workspace-thread-list]')
      return list.scrollTop < list.scrollHeight - list.clientHeight - 20
    })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-wire-key][data-highlight]').count(), 0)
    await page.getByRole('button', { name: 'Hide workspace wires', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[data-wire-key]'))
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).workspaceWires),
      false,
    )
    await toggle.press('Enter')
    await page.waitForFunction(() => !!document.querySelector('[data-wire-key]'))
    await page.evaluate(() =>
      window.proof.emit('onSnapshot', {
        ...window.proof.wireSnapshot,
        sessions: window.proof.wireSnapshot.sessions.slice(0, 1),
      }),
    )
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-key]').length === 0)
    await page.evaluate(() => {
      const proof = window.proof,
        originals = proof.wireSnapshot.sessions
      const sessions = [...originals, { ...originals[0], id: 'outside-last' }].map((session, i) => {
        const root =
          i === 0 || i === 2
            ? 'C:/short'
            : i === 1 || i === 17
              ? 'C:/long'
              : i === 3 || i === 4
                ? 'C:/inner'
                : i >= 18
                  ? 'C:/outside'
                  : `C:/unique-${i}`
        return { ...session, cwd: root, git: { ...originals[0].git, root } }
      })
      proof.emit('onSnapshot', { ...proof.wireSnapshot, sessions })
    })
    await page.waitForFunction(() => document.querySelectorAll('[data-wire-key]').length === 4)
    const lanes = await page
      .locator('[data-wire-key]')
      .evaluateAll((groups) =>
        Object.fromEntries(
          groups.map((group) => [group.dataset.wireKey, Number(group.dataset.railX)]),
        ),
      )
    assert.deepEqual(lanes, { 'c:/long': 12, 'c:/short': 8, 'c:/inner': 8, 'c:/outside': 12 })
    await page.locator('[data-workspace-thread-list]').evaluate((list) => {
      list.scrollTop = 0
    })
    await capture('workspace-wires-longest-closest')
    console.log(
      'PASS: production outside wires preserve row width, link exact cross-provider worktrees, exclude unknown/separate paths and follow hover, expansion, scroll and filtering.',
    )
  } finally {
    await page.evaluate(async ({ snapshot, settings }) => {
      window.threadlight.setTreeView = window.proof.savedWireView
      window.threadlight.updateSettings = window.proof.savedWireUpdate
      await window.threadlight.updateSettings(settings)
      window.proof.emit('onSnapshot', snapshot)
      window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: false })
    }, original)
  }
}
