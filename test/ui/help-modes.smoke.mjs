/* global window, document */
import assert from 'node:assert/strict'

export async function checkHelpModes(page, row, capture) {
  const initial = await page.evaluate(async () => ({
    settings: await window.threadlight.getSettings(),
    snapshot: await window.threadlight.getSnapshot(),
  }))
  const tip = page.getByRole('tooltip')
  const settingsButton = () => page.getByRole('button', { name: 'Settings', exact: true })
  const mode = async (value) => {
    await settingsButton().click()
    const choice = page.getByRole('radio', { name: value, exact: true })
    await choice.click()
    await page.waitForFunction(
      async (value) => (await window.threadlight.getSettings()).hoverHelp === value.toLowerCase(),
      value,
    )
    await page.waitForFunction(
      (value) =>
        [...document.querySelectorAll('[role="radio"]')].some(
          (e) => e.textContent === value && e.getAttribute('aria-checked') === 'true',
        ),
      value,
    )
    assert.equal(await choice.getAttribute('aria-checked'), 'true')
    assert.equal(
      await page.evaluate(async () => (await window.threadlight.getSettings()).hoverHelp),
      value.toLowerCase(),
    )
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await page.evaluate(() => window.proof.emit('onSnapshot', window.proof.hoverModeSnapshot))
  }
  const hoverRow = async () => {
    const box = await row('Claude').boundingBox()
    await page.mouse.move(box.x + 65, box.y + 9)
  }
  try {
    await page.evaluate(async () => {
      await window.threadlight.updateSettings({
        enabledProviders: ['claude', 'codex'],
        hoverHelp: 'info',
      })
      const snapshot = await window.threadlight.getSnapshot()
      const prepared = {
        ...snapshot,
        sessions: snapshot.sessions.map((session) => ({
          ...session,
          git: {
            root: session.cwd,
            branch: 'main',
            ahead: 0,
            behind: 0,
            files: 1,
            newFiles: 0,
            added: 4,
            removed: 1,
            worktrees: [session.cwd],
          },
          threadDiff: { files: 1, added: 4, removed: 1, complete: true, revision: 'help-modes' },
          backgroundTasks:
            session.provider === 'claude'
              ? [{ id: 'help-task', label: 'Check hover modes', startedAt: Date.now() - 1000 }]
              : [],
        })),
      }
      window.proof.hoverModeSnapshot = prepared
      window.proof.emit('onSnapshot', prepared)
    })
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    assert.equal(await settingsButton().getAttribute('title'), 'Settings')
    await hoverRow()
    assert.equal(await tip.count(), 0, 'Info retains the stationary delay')
    await page.clock.runFor(1000)
    await tip.waitFor()
    assert.match(await tip.innerText(), /^Last active at /)
    await row('Codex').getByText('Needs your input', { exact: true }).hover()
    assert.doesNotMatch((await tip.allTextContents()).join(''), /waiting for an answer or approval/)
    await row('Claude').locator('[data-git-tracker]').hover()
    await tip.waitFor()
    assert.equal(await tip.innerText(), 'main', 'Info keeps the original Git hint')
    assert.equal(
      await page.locator('[data-hover-message] [role="tooltip"]').count(),
      0,
      'Info keeps short hints beside the cursor',
    )
    await mode('Tour')
    await hoverRow()
    await tip.waitFor()
    assert.match(
      await tip.innerText(),
      /^Last active at /,
      'Tour skips the one-second wait with the clock frozen',
    )
    await row('Codex').getByText('Needs your input', { exact: true }).hover()
    await tip.waitFor()
    assert.match(await tip.innerText(), /waiting for an answer or approval/)
    assert.equal(await tip.count(), 1, 'nested status owns its help')
    await capture('tour-needs-input')
    await row('Claude').locator('[data-git-tracker]').hover()
    await tip.waitFor()
    assert.match(await tip.innerText(), /thread's Git branch/)
    await row('Claude')
      .getByRole('button', { name: /^Thread diff/ })
      .hover()
    await tip.waitFor()
    assert.match(await tip.innerText(), /Click to view this thread's files and diffs/)
    await settingsButton().hover()
    await tip.waitFor()
    assert.equal(await tip.innerText(), 'Settings', 'Tour makes native title help immediate')
    assert.equal(
      await page.locator('[data-hover-message] [role="tooltip"]').count(),
      1,
      'Tour shows even a short hint in the footer',
    )
    assert.equal(await tip.count(), 1)
    assert.equal(await settingsButton().getAttribute('title'), '')
    await page.evaluate(() => window.threadlight.updateSettings({ hoverHelp: 'off' }))
    await tip.waitFor({ state: 'detached' })
    assert.equal(
      await page.locator('[data-hover-message]').innerText(),
      '',
      'turning help off releases an open hint immediately',
    )
    await mode('Off')
    for (const target of [
      row('Claude').getByLabel('Context 20%', { exact: true }),
      row('Claude').getByRole('button', { name: /^Thread diff/ }),
      row('Claude').locator('[data-git-tracker]'),
      row('Claude').locator('[class*="_taskTimer_"]'),
      row('Codex').getByText('Needs your input', { exact: true }),
      page.getByLabel(/^Claude · 5-hour limit/),
      settingsButton(),
    ]) {
      await target.hover()
      await page.clock.runFor(1100)
      assert.equal(await tip.count(), 0, 'Off hides every custom/native hint')
    }
    assert.equal(await page.locator('[data-hover-message]').innerText(), '')
    assert.equal(await settingsButton().getAttribute('title'), '')
    await settingsButton().evaluate((element) => (element.title = 'Updated settings help'))
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="Settings"]').getAttribute('title') === '',
    )
    await page.evaluate(() => window.threadlight.updateSettings({ hoverHelp: 'info' }))
    await page.evaluate(() => window.proof.emit('onSnapshot', window.proof.hoverModeSnapshot))
    assert.equal(
      await settingsButton().getAttribute('title'),
      'Updated settings help',
      'Info restores the latest native title',
    )
    await row('Claude').locator('[data-git-tracker]').hover()
    await tip.waitFor()
    assert.equal(await tip.innerText(), 'main')
    await mode('Off')
    await page.reload()
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="Settings"]')?.getAttribute('title') === '',
    )
    assert.equal(await settingsButton().getAttribute('title'), '', 'saved Off mode survives reload')
    await settingsButton().click()
    assert.equal(
      await page.getByRole('radio', { name: 'Off', exact: true }).getAttribute('aria-checked'),
      'true',
    )
    await page.getByRole('radio', { name: 'Info', exact: true }).click()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await capture('help-modes-settings-restored')
    console.log(
      'PASS: Tour immediate/native/nested explanations, Info timing and original wording, Off custom/task/native suppression, live title updates, Settings controls and saved reload.',
    )
  } finally {
    await page.clock.resume()
    await page.evaluate(async ({ settings, snapshot }) => {
      await window.threadlight.updateSettings(settings)
      window.proof.emit('onSnapshot', snapshot)
    }, initial)
  }
}
