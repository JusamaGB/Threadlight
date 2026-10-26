/* global window, getComputedStyle */
import assert from 'node:assert/strict'

/** Both providers share a checkout and a filename; neither may open the other's patches. */
export async function checkThreadDiffs(page, capture) {
  const initial = await page.evaluate(async () => ({
    settings: await window.threadlight.getSettings(),
    snapshot: await window.threadlight.getSnapshot(),
  }))
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await page.locator('header [data-thread-view]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Recent', exact: true }).click()
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    window.proof.threadDiff = {
      saved: {
        getChanges: window.threadlight.getChanges,
        getFileDiff: window.threadlight.getFileDiff,
        openChangedFile: window.threadlight.openChangedFile,
      },
      snapshot,
      revision: 1,
      partial: false,
      unavailable: false,
      calls: [],
    }
    const proof = window.proof.threadDiff
    window.threadlight.getChanges = async (id) => {
      proof.calls.push(['files', id])
      return proof.unavailable
        ? null
        : {
            branch: 'same-worktree',
            complete: !proof.partial,
            files: [
              {
                path: 'src/shared.ts',
                status: 'modified',
                added: id.startsWith('codex:') ? proof.revision + 3 : 2,
                removed: id.startsWith('codex:') ? 2 : 1,
                binary: false,
              },
            ],
          }
    }
    window.threadlight.getFileDiff = async (id, path) => {
      proof.calls.push(['diff', id, path])
      return {
        kind: 'text',
        lines: [
          { type: 'hunk', text: 'Recorded thread changes' },
          { type: 'remove', text: 'original line', oldLine: 1 },
          {
            type: 'add',
            text: id.startsWith('codex:')
              ? 'Codex own patch ' + proof.revision
              : 'Claude own patch',
            newLine: 1,
          },
        ],
      }
    }
    window.threadlight.openChangedFile = (...args) => proof.calls.push(['open', ...args])
    proof.current = {
      ...snapshot,
      sessions: snapshot.sessions.map((session) => ({
        ...session,
        state: 'idle',
        attention: null,
        plan: [],
        git: {
          root: 'C:/shared-worktree',
          branch: 'same-worktree',
          added: 9999,
          removed: 8888,
          files: 99,
          newFiles: 0,
          ahead: 3,
          behind: 1,
          worktrees: [],
        },
        threadDiff: {
          files: 1,
          added: session.provider === 'codex' ? 4 : 2,
          removed: session.provider === 'codex' ? 2 : 1,
          revision: 'own-1',
          complete: true,
        },
      })),
    }
    window.proof.emit('onSnapshot', proof.current)
  })
  const thread = (provider) =>
    page
      .locator(`[data-session-id${provider === 'Codex' ? '^="codex:"' : '="synthetic-claude"'}]`)
      .first()
  const badge = (provider) =>
    thread(provider).getByRole('button', { name: /^Thread diff · 1 file changed/ })
  const back = () => page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  try {
    await badge('Claude').waitFor()
    assert.equal((await badge('Claude').innerText()).replace(/\s/g, ''), '+2−1')
    assert.equal((await badge('Codex').innerText()).replace(/\s/g, ''), '+4−2')
    assert.equal(await page.getByText('+10k', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /Worktree total/ }).count(), 0)
    const layout = await thread('Claude').evaluate((row) => {
      const tracker = row.querySelector('[data-git-tracker]'),
        diff = row.querySelector('[class*="_diffLink_"]'),
        button = row.querySelector('button'),
        bounds = tracker.getBoundingClientRect(),
        totals = diff.getBoundingClientRect(),
        style = getComputedStyle(button)
      return {
        text: tracker.textContent,
        trackerY: bounds.y,
        diffY: totals.y,
        right: bounds.right,
        rowRight: button.getBoundingClientRect().right,
        inlineAge: !!row.querySelector('[class*="_age_"]'),
        padding: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
      }
    })
    assert.match(layout.text, /↑3↓1/)
    assert.ok(layout.trackerY > layout.diffY, 'Git tracker is below thread diff totals')
    assert.equal(
      layout.rowRight - layout.right,
      10,
      'Git tracker sits at the right of the second row',
    )
    assert.equal(layout.inlineAge, false, 'last active time no longer takes up row space')
    assert.equal(layout.padding, 6, 'adjacent thread contents have six pixels of padding')
    await badge('Claude').hover()
    const tip = page.getByRole('tooltip')
    await tip.waitFor()
    assert.match(await tip.innerText(), /Thread diff · 1 file changed · \+2 · −1/)
    await capture('thread-diff-independent-badges')
    await badge('Claude').click()
    await page.locator('header').getByText('Thread diff · 1 file', { exact: true }).waitFor()
    await page.getByRole('button', { name: /edit shared.ts/ }).click()
    await page.getByText('Claude own patch', { exact: true }).waitFor()
    assert.equal(await page.getByText(/^Codex own patch/).count(), 0)
    await page.getByRole('button', { name: 'Open ↗', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.proof.threadDiff.calls.at(-1)), [
      'open',
      'synthetic-claude',
      'src/shared.ts',
    ])
    await capture('thread-diff-claude-recorded-file')
    await back()
    await badge('Codex').click()
    await page.getByRole('button', { name: /edit shared.ts/ }).click()
    await page.getByText('Codex own patch 1', { exact: true }).waitFor()
    assert.equal(await page.getByText('Claude own patch', { exact: true }).count(), 0)
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.revision = 2
      proof.current = {
        ...proof.current,
        sessions: proof.current.sessions.map((session) =>
          session.provider === 'codex'
            ? { ...session, threadDiff: { ...session.threadDiff, added: 5, revision: 'own-2' } }
            : session,
        ),
      }
      window.proof.emit('onSnapshot', proof.current)
    })
    await page.getByText('Codex own patch 2', { exact: true }).waitFor()
    await capture('thread-diff-codex-refresh')
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.partial = true
      proof.current = {
        ...proof.current,
        sessions: proof.current.sessions.map((session) =>
          session.provider === 'codex'
            ? {
                ...session,
                threadDiff: { ...session.threadDiff, complete: false, revision: 'own-3' },
              }
            : session,
        ),
      }
      window.proof.emit('onSnapshot', proof.current)
    })
    await page.getByText(/Some recorded edits could not be combined/).waitFor()
    await capture('thread-diff-partial-history')
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.unavailable = true
      proof.current = {
        ...proof.current,
        sessions: proof.current.sessions.map((session) =>
          session.provider === 'codex'
            ? { ...session, threadDiff: { ...session.threadDiff, revision: 'own-4' } }
            : session,
        ),
      }
      window.proof.emit('onSnapshot', proof.current)
    })
    await page
      .getByText("This thread's recorded changes are unavailable.", { exact: true })
      .waitFor()
    await back()
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      window.proof.emit('onSnapshot', {
        ...proof.current,
        sessions: proof.current.sessions.map((session) => ({ ...session, threadDiff: null })),
      })
    })
    assert.equal(await page.getByRole('button', { name: /^Thread diff/ }).count(), 0)
    assert.equal(await page.getByText('+10k', { exact: true }).count(), 0)
    await thread('Claude').locator('button').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Thread diff', exact: true }).click()
    await page
      .getByText("This thread's recorded changes are unavailable.", { exact: true })
      .waitFor()
    await back()
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.unavailable = false
      window.threadlight.getChanges = async () => ({
        branch: 'same-worktree',
        files: [],
        complete: true,
      })
      window.proof.emit('onSnapshot', {
        ...proof.current,
        sessions: proof.current.sessions.map((session) => ({
          ...session,
          threadDiff: { files: 0, added: 0, removed: 0, revision: 'zero', complete: true },
        })),
      })
    })
    await thread('Claude').locator('button').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Thread diff', exact: true }).click()
    await page.getByText('No recorded file changes in this thread.', { exact: true }).waitFor()
    console.log(
      'PASS: independent Claude/Codex thread badges, same-file ownership, own-file Open, thread-revision refresh, partial/unavailable history and no Git-total fallback.',
    )
  } finally {
    const close = page.getByRole('button', { name: 'Back to sessions', exact: true })
    if (await close.count()) await close.click()
    await page.evaluate(async (initial) => {
      Object.assign(window.threadlight, window.proof.threadDiff.saved)
      await window.threadlight.updateSettings(initial.settings)
      window.proof.emit('onSnapshot', initial.snapshot)
    }, initial)
    await page.locator('header [data-thread-view]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Active', exact: true }).click()
  }
}
