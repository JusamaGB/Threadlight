/* global window */
import assert from 'node:assert/strict'

export async function checkThreadBadges(page, capture) {
  const initial = await page.evaluate(() => window.threadlight.getSettings())
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      listMode: 'workspace',
      combinedFocusWorkspace: null,
    })
  })
  const view = page.locator('header [data-thread-view]')
  if ((await view.getAttribute('data-thread-view')) !== 'workspace') {
    await view.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Workspace', exact: true }).click()
  }
  const snapshot = await page.evaluate(() => window.threadlight.getSnapshot())
  await page.evaluate((snapshot) => {
    const patch = (session) => ({
      ...session,
      threadDiff: { files: 2, added: 124, removed: 13, complete: true, revision: 'badge-fixture' },
      git: {
        root: 'Z:/General/repo',
        branch: 'main',
        added: 124,
        removed: 13,
        files: 2,
        newFiles: 0,
        ahead: 2,
        behind: 7,
        worktrees: Array.from({ length: 5 }, (_, i) => `Z:/General/repo-${i}`),
      },
      pullRequests: [{ number: 25, state: session.provider === 'codex' ? 'unknown' : 'merged' }],
    })
    window.proof.emit('onSnapshot', {
      ...snapshot,
      sessions: snapshot.sessions.map(patch),
      workspaces: snapshot.workspaces.map((workspace) => ({
        ...workspace,
        threads: workspace.threads.map((node) => ({ ...node, session: patch(node.session) })),
      })),
    })
  }, snapshot)
  for (const provider of ['claude', 'codex']) {
    const row = page.locator(`[data-session-id][data-provider="${provider}"]`).first()
    await row.getByText('+124', { exact: true }).waitFor()
    await row.getByText('−13', { exact: true }).waitFor()
    await row.getByText('↑2', { exact: true }).waitFor()
    if (provider === 'claude') {
      await row.locator(':scope > button').first().click()
      const line = row.locator('[class*="_gitLine_"]')
      assert.equal(await line.innerText(), 'main · 2 to push')
      assert.doesNotMatch(await line.innerText(), /behind main|worktrees/)
      assert.equal(
        await row.locator('[class*="_cwd_"]').innerText(),
        snapshot.sessions.find((session) => !session.id.startsWith('codex:')).cwd,
      )
      await row.locator(':scope > button').first().click()
    }
    const badge = row.locator('[title^="Pull request #25"]')
    assert.equal(
      await badge.getAttribute('data-state'),
      provider === 'codex' ? 'unknown' : 'merged',
    )
    if (provider === 'codex') {
      assert.match(await badge.getAttribute('title'), /linked; status unavailable/)
      await row.getByText('Needs your input', { exact: true }).waitFor()
    }
  }
  await capture('codex-thread-badges')
  await page.evaluate(
    async ({ snapshot, initial }) => {
      window.proof.emit('onSnapshot', snapshot)
      await window.threadlight.updateSettings(initial)
    },
    { snapshot, initial },
  )
  console.log(
    'PASS: Claude and Codex Git counts, linked PR badges and Codex attention tag render in Both + Workspace.',
  )
}
