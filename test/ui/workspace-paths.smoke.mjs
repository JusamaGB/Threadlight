/* global window, document */
import assert from 'node:assert/strict'

export async function checkWorkspacePaths(page) {
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
  await page.evaluate(async (initial) => {
    window.proof.emit('onSnapshot', await window.mockWorkspacePaths(null))
    await window.threadlight.updateSettings(initial)
    window.proof.emit('onPanelOpened', { maxHeight: 800, opensDown: true, fresh: true })
  }, initial)
  console.log(
    'PASS: Both + Workspace loads both path formats, deduplicates the picker and preserves provider IDs.',
  )
}
