import { selectThreadView } from './header-navigation.mjs'
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'

/** A thread waiting on the user can be set aside in Threadlight alone, and brought back. */
export async function checkIgnoreInput(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  await page.evaluate(() =>
    window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      listMode: 'recent',
    }),
  )
  const view = page.locator('header [data-thread-view]')
  if ((await view.getAttribute('data-thread-view')) !== 'recent') {
    await selectThreadView(page, 'recent')
  }
  const snapshot = await page.evaluate(() => window.threadlight.getSnapshot())
  const codex = page.locator('[data-session-id][data-provider="codex"]').first()
  const claude = page.locator('[data-session-id][data-provider="claude"]').first()
  const tag = codex.getByText('Needs your input', { exact: true })
  await tag.waitFor()
  const colour = () => tag.evaluate((el) => getComputedStyle(el).color)
  const calls = () => page.evaluate(() => window.proof.calls.filter((call) => call[0] === 'ignore'))
  const codexId = await codex.getAttribute('data-session-id')
  const claudeId = await claude.getAttribute('data-session-id')
  // Publish the fixture with some sessions changed, like the main process republishing.
  const publish = (changes) =>
    page.evaluate(
      ({ snapshot, changes }) => {
        const change = (session) => ({ ...session, ...(changes[session.id] ?? {}) })
        window.proof.emit('onSnapshot', {
          ...snapshot,
          sessions: snapshot.sessions.map(change),
          workspaces: snapshot.workspaces.map((workspace) => ({
            ...workspace,
            threads: workspace.threads.map((node) => ({ ...node, session: change(node.session) })),
          })),
        })
      },
      { snapshot, changes },
    )
  const listed = (label) => page.getByRole('menuitem', { name: label, exact: true })
  const menu = async (row) => {
    await row.click({ button: 'right' })
    await page.getByRole('menu').waitFor()
  }
  try {
    // Only a thread that is waiting on the user offers it.
    await publish({ [claudeId]: { state: 'idle', attention: null } })
    await menu(claude)
    assert.equal(await listed('Ignore').count(), 0, 'a thread that is not waiting has no Ignore')
    await page.keyboard.press('Escape')

    const waiting = await colour()
    await menu(codex)
    assert.equal(await listed('Stop ignoring').count(), 0)
    await listed('Ignore').hover()
    const tip = page.getByRole('tooltip')
    await tip.waitFor()
    assert.match(await tip.innerText(), /Only Threadlight stops flagging this thread/)
    assert.match(await tip.innerText(), /Nothing changes in Claude or Codex/)
    // The explanation opens in the panel's info area, not beside the cursor.
    const info = page.locator('[data-hover-message] [role="tooltip"]')
    assert.equal(await info.count(), 1, 'the hint is in the info area')
    assert.equal(await tip.getAttribute('data-docked'), '')
    await capture('ignore-needs-input-menu')
    await listed('Ignore').click()
    assert.deepEqual(await calls(), [['ignore', codexId, true]])

    // The main process answers with the thread flagged as set aside: same row, quieter tag.
    await publish({ [claudeId]: { state: 'idle', attention: null }, [codexId]: { ignored: true } })
    await page.waitForFunction(
      (id) => document.querySelector(`[data-session-id="${id}"] [data-ignored]`) !== null,
      codexId,
    )
    assert.notEqual(await colour(), waiting, 'the tag is toned down once it is set aside')
    assert.equal(await tag.count(), 1, 'the thread stays listed and keeps its tag')
    await capture('ignored-needs-input-tag')

    await menu(codex)
    assert.equal(await listed('Ignore').count(), 0)
    await listed('Stop ignoring').hover()
    await tip.waitFor()
    assert.match(await tip.innerText(), /Flag this thread as needing your input again/)
    await listed('Stop ignoring').click()
    assert.deepEqual(await calls(), [
      ['ignore', codexId, true],
      ['ignore', codexId, false],
    ])
    console.log(
      'PASS: Ignore appears only on waiting threads, explains that only Threadlight changes, sends the choice, tones the tag down and can be undone.',
    )
  } finally {
    await page.evaluate(
      async ({ snapshot, initial }) => {
        window.proof.emit('onSnapshot', snapshot)
        await window.threadlight.updateSettings(initial)
      },
      { snapshot, initial },
    )
  }
}
