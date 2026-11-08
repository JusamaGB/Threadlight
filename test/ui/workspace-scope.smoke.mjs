/* global window, document */
import assert from 'node:assert/strict'
import { selectThreadView } from './header-navigation.mjs'

export async function checkWorkspaceScope(page, capture) {
  await page.evaluate(async () => {
    const initial = await window.threadlight.getSnapshot()
    const base = initial.sessions[0]
    const now = Date.now()
    const chat = (id, cwd, state, age) => ({
      ...base,
      id,
      provider: id.startsWith('codex:') ? 'codex' : 'claude',
      title: id,
      cwd,
      state,
      attention: null,
      unread: false,
      lastActiveAt: now - age,
      orderAt: now - age,
    })
    const own = [
      chat('claude-own', 'C:/project', 'working', 120000),
      chat('codex:own', '\\\\?\\C:\\project', 'waiting', 180000),
      chat('codex:idle', 'C:/project', 'idle', 240000),
    ]
    const outside = [
      chat('codex:worktree', 'C:/project-worktree', 'working', 60000),
      chat('claude-other-drive', 'Z:/elsewhere', 'working', 70000),
    ]
    const group = (id, rows) => ({
      id,
      name: id.split(/[\\/]/).at(-1),
      threads: rows.map((session) => ({ session, children: [] })),
      threadCount: rows.length,
      activeCount: rows.filter((s) => s.state !== 'idle').length,
      hiddenCount: 0,
      worktrees: 1,
      anyWorking: true,
    })
    const groups = [
      group('claude:C:/project', own.slice(0, 1)),
      group('codex:\\\\?\\C:\\project', own.slice(1)),
      group('codex:C:/project-worktree', outside.slice(0, 1)),
      group('claude:Z:/elsewhere', outside.slice(1)),
    ]
    const update = window.threadlight.updateSettings
    window.threadlight.updateSettings = async (patch) => {
      const result = await update(patch)
      const enabled = (await window.threadlight.getSettings()).enabledProviders
      const workspaces = groups
        .filter((g) => enabled.includes(g.id.split(':')[0]))
        .map((g) => ({
          ...g,
          id: enabled.length === 2 ? g.id : g.id.replace(/^(claude|codex):/, ''),
        }))
      window.proof.emit('onSnapshot', {
        ...initial,
        providers: enabled,
        provider: enabled.length === 1 ? enabled[0] : undefined,
        // None of the selected folder's chats made the global Recent list.
        sessions: outside.filter((s) => enabled.includes(s.provider)),
        lookupSessions: [],
        workspaces,
        allWorkspaces: workspaces.map(({ id, name }) => ({ id, name })),
        currentWorkspace: workspaces[0]?.id ?? null,
      })
      return result
    }
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      maxSessions: 3,
      combinedFocusWorkspace: 'codex:C:/project',
      focusWorkspace: 'C:/project',
      codexFocusWorkspace: 'C:/project',
      workspaceAllDrives: false,
      listMode: 'recent',
    })
  })
  const expectRows = async (expected) => {
    await page.waitForFunction(
      (expected) =>
        JSON.stringify(
          [...document.querySelectorAll('[data-session-id]')]
            .map((row) => row.dataset.sessionId)
            .sort(),
        ) === JSON.stringify(expected),
      [...expected].sort(),
    )
    assert.deepEqual(
      await page
        .locator('[data-session-id]')
        .evaluateAll((rows) => rows.map((row) => row.dataset.sessionId).sort()),
      [...expected].sort(),
    )
  }
  const own = ['claude-own', 'codex:own', 'codex:idle']
  for (let cycle = 0; cycle < 2; cycle++) {
    await selectThreadView(page, 'active')
    await expectRows(own.slice(0, 2))
    assert.equal(await page.locator('[data-thread-view]').innerText(), 'Active · 2')
    await selectThreadView(page, 'recent')
    await expectRows(own)
    await selectThreadView(page, 'workspace')
    await expectRows(own)
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).workspaceAllDrives),
      false,
    )
  }
  await capture('workspace-scope-shared')
  await page.getByRole('button', { name: /^Choose workspace:/ }).click()
  await page.getByRole('button', { name: 'Use All Drives', exact: true }).click()
  await expectRows([...own, 'codex:worktree', 'claude-other-drive'])
  await selectThreadView(page, 'active')
  await expectRows(['claude-own', 'codex:own', 'codex:worktree', 'claude-other-drive'])
  await selectThreadView(page, 'recent')
  await expectRows(['codex:worktree', 'claude-other-drive', 'claude-own'])
  await page.getByRole('button', { name: 'Choose workspace: All drives', exact: true }).waitFor()
  await page.evaluate(() =>
    window.threadlight.updateSettings({ workspaceAllDrives: false, combinedFocusWorkspace: 'C:' }),
  )
  await selectThreadView(page, 'active')
  await expectRows(['claude-own', 'codex:own', 'codex:worktree'])
  await page.evaluate(() =>
    window.threadlight.updateSettings({ combinedFocusWorkspace: 'C:/project-worktree' }),
  )
  for (const mode of ['recent', 'workspace', 'active']) {
    await selectThreadView(page, mode)
    await expectRows(['codex:worktree'])
  }
  for (const [provider, expected] of [
    ['Claude', ['claude-own']],
    ['Codex', ['codex:own']],
  ]) {
    await page.getByRole('button', { name: /^Filter applications:/ }).click()
    await page.getByRole('menuitem', { name: provider, exact: true }).click()
    await expectRows(expected)
  }
  await page.evaluate(() =>
    window.threadlight.updateSettings({ codexFocusWorkspace: 'C:/missing-worktree' }),
  )
  for (const mode of ['recent', 'workspace', 'active']) {
    await selectThreadView(page, mode)
    await expectRows([])
    await page
      .getByRole('button', { name: 'Choose workspace: missing-worktree', exact: true })
      .waitFor()
  }
  await page.reload()
  for (const mode of ['active', 'recent', 'workspace']) {
    await selectThreadView(page, mode)
    await expectRows([])
    await page
      .getByRole('button', { name: 'Choose workspace: missing-worktree', exact: true })
      .waitFor()
  }
  console.log(
    'PASS: shared scope across view cycles; limit after filtering; worktree/drive isolation; All drives; provider changes; empty saved folder and reload.',
  )
}
