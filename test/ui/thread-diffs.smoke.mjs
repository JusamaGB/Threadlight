import { selectThreadView } from './header-navigation.mjs'
/* global window, document, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict'
import { checkPagePinning } from './toolbar.smoke.mjs'

/** Both providers share a checkout and a filename; neither may open the other's patches. */
export async function checkThreadDiffs(page, capture) {
  const initial = await page.evaluate(async () => ({
    settings: await window.threadlight.getSettings(),
    snapshot: await window.threadlight.getSnapshot(),
  }))
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  await selectThreadView(page, 'recent')
  await page.evaluate(async () => {
    const snapshot = await window.threadlight.getSnapshot()
    window.proof.threadDiff = {
      saved: {
        getLocalTracking: window.threadlight.getLocalTracking,
        getChanges: window.threadlight.getChanges,
        getFileDiff: window.threadlight.getFileDiff,
        openChangedFile: window.threadlight.openChangedFile,
        getWorktreeChanges: window.threadlight.getWorktreeChanges,
        getWorktreeFileDiff: window.threadlight.getWorktreeFileDiff,
        openWorktreeChangedFile: window.threadlight.openWorktreeChangedFile,
      },
      snapshot,
      revision: 1,
      partial: false,
      unavailable: false,
      calls: [],
    }
    const proof = window.proof.threadDiff
    window.threadlight.getLocalTracking = async () => null
    window.threadlight.getChanges = async (id) => {
      proof.calls.push(['files', id])
      if (proof.ownershipError) throw new Error('Synthetic ownership unavailable')
      return proof.unavailable
        ? null
        : {
            branch: 'same-worktree',
            revision: `thread-${proof.revision}`,
            complete: !proof.partial,
            groups: proof.groups,
            files:
              proof.rootFiles ??
              (
                proof.ownedPaths?.[id.startsWith('codex:') ? 'codex' : 'claude'] ?? [
                  'src/shared.ts',
                ]
              ).map((path) => ({
                path,
                status: 'modified',
                added: id.startsWith('codex:') ? proof.revision + 3 : 2,
                removed: id.startsWith('codex:') ? 2 : 1,
                binary: false,
              })),
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
    window.threadlight.getWorktreeChanges = async (id, lens, rootId) => {
      proof.calls.push(['worktree-files', id, lens, rootId])
      return {
        branch: 'same-worktree',
        revision: 'worktree-1',
        files: [
          { path: 'src/shared.ts', status: 'modified', added: 700, removed: 50, binary: false },
          { path: 'other-writer.ts', status: 'added', added: 10, removed: 0, binary: false },
        ],
      }
    }
    window.threadlight.getWorktreeFileDiff = async (id, path) => {
      proof.calls.push(['worktree-file', id, path])
      return {
        kind: 'text',
        lines: [{ type: 'add', text: 'All worktree writers: ' + path, newLine: 1 }],
      }
    }
    window.threadlight.openWorktreeChangedFile = (...args) =>
      proof.calls.push(['worktree-open', ...args])
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
          files: 2,
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
    // Pending counts are explicit; publishing metadata/diffs replaces the placeholder in-place.
    await page.evaluate(() => {
      const current = window.proof.threadDiff.current
      window.proof.emit('onSnapshot', {
        ...current,
        sessions: current.sessions.map((session) => ({
          ...session,
          threadDiff: null,
          threadDiffStatus: 'loading',
          git: { ...session.git, pending: true },
        })),
      })
    })
    await page.getByLabel('Loading thread changes').first().waitFor()
    assert.equal((await page.getByLabel('Loading thread changes').first().innerText()).trim(), '…')
    assert.equal((await page.locator('body').innerText()).includes('\uFFFD'), false)
    await page.evaluate(() => window.proof.emit('onSnapshot', window.proof.threadDiff.current))
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
      6,
      'Git tracker sits at the right of the second row',
    )
    assert.equal(layout.inlineAge, false, 'last active time no longer takes up row space')
    assert.equal(layout.padding, 2, 'adjacent thread contents retain the compact row padding')
    await page.evaluate(() => {
      const current = window.proof.threadDiff.current
      window.proof.emit('onSnapshot', {
        ...current,
        sessions: current.sessions.map((session) => ({
          ...session,
          threadDiff: {
            ...session.threadDiff,
            complete: false,
            groups: [
              { rootId: 'one', root: 'C:/one' },
              { rootId: 'two', root: 'C:/two' },
            ],
          },
        })),
      })
    })
    const coverage = thread('Claude').locator('[data-diff-coverage]')
    await coverage.waitFor()
    assert.equal((await badge('Claude').innerText()).replace(/\s/g, ''), '+2−1')
    assert.match(await coverage.innerText(), /Partial/)
    assert.match(await coverage.innerText(), /2 roots/)
    const placement = await thread('Claude').evaluate((row) => {
      const tracker = row.querySelector('[data-git-tracker]').getBoundingClientRect()
      const status = row.querySelector('[data-diff-coverage]').getBoundingClientRect()
      const top = row.querySelector('[class*="_rowTop_"]').getBoundingClientRect()
      return {
        sameLine: Math.abs(tracker.y - status.y) < 2,
        rightOfBranch: status.left > tracker.right,
        belowTitle: status.y >= top.bottom,
        inside: status.right <= row.getBoundingClientRect().right,
      }
    })
    assert.deepEqual(placement, {
      sameLine: true,
      rightOfBranch: true,
      belowTitle: true,
      inside: true,
    })
    await coverage.hover()
    await page.getByRole('tooltip').waitFor()
    assert.match(await page.getByRole('tooltip').innerText(), /2 source folders or checkouts/)
    await capture('thread-diff-second-row-coverage')
    await coverage.click()
    await page.locator('header').getByText('Thread diff · 1 file', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await page.evaluate(() => window.proof.emit('onSnapshot', window.proof.threadDiff.current))
    await badge('Claude').hover()
    const tip = page.getByRole('tooltip')
    await tip.waitFor()
    assert.match(await tip.innerText(), /Thread diff/)
    assert.match(await tip.innerText(), /1 file changed/)
    assert.match(await tip.innerText(), /\+2 added/)
    assert.match(await tip.innerText(), /−1 removed/)
    await capture('thread-diff-independent-badges')
    await badge('Claude').click()
    await page.locator('header').getByText('Thread diff · 1 file', { exact: true }).waitFor()
    assert.equal(await page.locator('[class*="_fileRow_"][data-provider]').count(), 0)
    await checkPagePinning(page, 'Thread diff · 1 file')
    await page.getByRole('button', { name: /edit shared.ts/ }).click()
    await page.getByText('Claude own patch', { exact: true }).waitFor()
    assert.equal(await page.getByText(/^Codex own patch/).count(), 0)
    await page.getByRole('button', { name: 'Open ↗', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.proof.threadDiff.calls.at(-1)), [
      'open',
      'synthetic-claude',
      'src/shared.ts',
      'thread-1',
    ])
    await capture('thread-diff-claude-recorded-file')
    await back()
    await badge('Codex').click()
    await page.getByRole('button', { name: /edit shared.ts/ }).click()
    await page.getByText('Codex own patch 1', { exact: true }).waitFor()
    assert.equal(await page.getByText('Claude own patch', { exact: true }).count(), 0)
    await page.locator('[data-stacked-diff] button[aria-pressed]').click()
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.stackedElement = document.querySelector('[data-stacked-diff]')
      proof.pendingChanges = []
      proof.pendingDiffs = []
      proof.restoreChanges = window.threadlight.getChanges
      proof.restoreDiff = window.threadlight.getFileDiff
      window.threadlight.getChanges = async (...args) => {
        const result = await proof.restoreChanges(...args)
        return new Promise((resolve) => proof.pendingChanges.push(() => resolve(result)))
      }
      window.threadlight.getFileDiff = async (...args) => {
        const result = await proof.restoreDiff(...args)
        return new Promise((resolve) => proof.pendingDiffs.push(() => resolve(result)))
      }
    })
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
    await page.waitForFunction(() => window.proof.threadDiff.pendingChanges.length === 1)
    assert.equal(await page.getByText('Codex own patch 1', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Reading changes…', { exact: true }).count(), 0)
    assert.equal(
      await page.getByRole('button', { name: 'Refresh', exact: true }).innerText(),
      'Refreshing…',
    )
    await page.evaluate(() => window.proof.threadDiff.pendingChanges.shift()())
    await page.waitForFunction(() => window.proof.threadDiff.pendingDiffs.length === 1)
    assert.equal(await page.getByText('Codex own patch 1', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Reading changes…', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Open ↗', exact: true }).isDisabled(), true)
    await capture('thread-diff-refresh-retained')
    await page.evaluate(() => window.proof.threadDiff.pendingDiffs.shift()())
    await page.getByText('Codex own patch 2', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-stacked-diff]').getAttribute('data-wrap'), 'false')
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector('[data-stacked-diff]') === window.proof.threadDiff.stackedElement,
      ),
      true,
    )
    // A superseded same-comparison refresh must not roll back the displayed result.
    for (const revision of [3, 4]) {
      await page.evaluate((value) => {
        window.proof.threadDiff.revision = value
      }, revision)
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.waitForFunction(
        (count) => window.proof.threadDiff.pendingChanges.length === count,
        revision - 2,
      )
    }
    await page.evaluate(() => window.proof.threadDiff.pendingChanges.pop()())
    await page.waitForFunction(() => window.proof.threadDiff.pendingDiffs.length === 1)
    await page.evaluate(() => window.proof.threadDiff.pendingDiffs.shift()())
    await page.getByText('Codex own patch 4', { exact: true }).waitFor()
    await page.evaluate(async () => {
      const proof = window.proof.threadDiff
      proof.pendingChanges.shift()()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      window.threadlight.getChanges = proof.restoreChanges
      window.threadlight.getFileDiff = proof.restoreDiff
      proof.revision = 2
    })
    assert.equal(await page.getByText('Codex own patch 4', { exact: true }).count(), 1)
    await capture('thread-diff-codex-refresh')
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.groups = ['one', 'two'].map((name) => ({
        rootId: name,
        root: `C:/repo-${name}`,
        recorded: [
          {
            path: 'historical.ts',
            state: name === 'one' ? 'committed' : 'separate-branch',
            commit: '1234567890abcdef',
            branches: ['related'],
            added: 1,
            removed: 1,
            explanation:
              name === 'one'
                ? 'Recorded patch matches checkout history.'
                : 'Recorded patch remains on branch related.',
          },
        ],
        lens: 'git-current',
        files: 1,
        added: 1,
        removed: 1,
        complete: false,
        available: true,
      }))
      proof.rootFiles = ['one', 'two'].map((name) => ({
        path: `${name}/src/shared.ts`,
        displayPath: 'src/shared.ts',
        rootId: name,
        status: 'modified',
        added: 1,
        removed: 1,
        binary: false,
      }))
    })
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    const secondRoot = page.getByRole('region', { name: 'Changes in C:/repo-two' })
    await secondRoot
      .getByText('Recorded patch remains on branch related.', { exact: false })
      .waitFor()
    await page.getByText('Recorded patch matches checkout history.', { exact: false }).waitFor()
    await secondRoot.getByRole('button', { name: /edit shared.ts/ }).click()
    await secondRoot.getByRole('button', { name: 'Open ↗', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.proof.threadDiff.calls.at(-1)), [
      'open',
      'codex:11111111-1111-4111-8111-111111111111',
      'two/src/shared.ts',
      'thread-2',
    ])
    await capture('thread-diff-multiple-roots')
    await page.getByRole('combobox', { name: 'Source folder' }).selectOption('two')
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('git-staged')
    await page.locator('header').getByText('Staged diff · 2 files', { exact: true }).waitFor()
    assert.deepEqual(
      await page.evaluate(() =>
        window.proof.threadDiff.calls.filter((call) => call[0] === 'worktree-files').at(-1),
      ),
      ['worktree-files', 'codex:11111111-1111-4111-8111-111111111111', 'git-staged', 'two'],
    )
    await page.getByRole('combobox', { name: 'Source folder' }).selectOption('')
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('thread')
    await page.evaluate(() => {
      delete window.proof.threadDiff.groups
      delete window.proof.threadDiff.rootFiles
    })
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
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
    await page.getByText(/Coverage is partial/).waitFor()
    await capture('thread-diff-partial-history')
    await page
      .locator('header')
      .getByText('Thread diff · 1 file shown · partial', { exact: true })
      .waitFor()
    await page.evaluate(() => {
      window.proof.threadDiff.ownedPaths = { codex: [] }
    })
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByText(/No current changes could be matched/).waitFor()
    await page
      .locator('header')
      .getByText('Thread diff · 0 files shown · partial', { exact: true })
      .waitFor()
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('git-staged')
    await page.locator('header').getByText('Staged diff · 2 files', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('folder-baseline')
    await page.locator('header').getByText('Folder diff · 2 files', { exact: true }).waitFor()
    // A late response from a previous mode must not replace the selected comparison.
    await page.evaluate(() => {
      const read = window.threadlight.getWorktreeChanges
      window.proof.threadDiff.restoreComparison = read
      window.threadlight.getWorktreeChanges = (id, lens) =>
        lens === 'git-staged'
          ? new Promise((resolve) => {
              window.proof.threadDiff.releaseStaged = () =>
                resolve({ branch: null, files: [], lens: 'git-staged', complete: true })
            })
          : read(id, lens)
    })
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('git-staged')
    await page.waitForFunction(() => !!window.proof.threadDiff.releaseStaged)
    assert.equal(await page.getByRole('button', { name: /edit shared.ts/ }).count(), 0)
    await page.getByText('Reading changes…', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('git-current')
    await page.locator('header').getByText('Worktree diff · 2 files', { exact: true }).waitFor()
    await page.evaluate(async () => {
      window.proof.threadDiff.releaseStaged()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      window.threadlight.getWorktreeChanges = window.proof.threadDiff.restoreComparison
    })
    assert.equal(
      await page.locator('header').getByText('Worktree diff · 2 files', { exact: true }).count(),
      1,
    )
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('thread')
    await page.getByText(/No current changes could be matched/).waitFor()

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
    // A commit clears the badge even when the older recorded history was partial.
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      window.proof.emit('onSnapshot', {
        ...proof.current,
        sessions: proof.current.sessions.map((session) => ({
          ...session,
          threadDiff: { files: 0, added: 0, removed: 0, complete: true, revision: 'committed' },
        })),
      })
    })
    await page
      .getByRole('button', { name: /^Thread diff/ })
      .first()
      .waitFor({ state: 'detached' })
    await capture('thread-diff-committed-clear')
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      window.proof.emit('onSnapshot', {
        ...proof.current,
        sessions: proof.current.sessions.map((session) => ({
          ...session,
          git: {
            ...session.git,
            branch: 'main',
            ahead: 0,
            behind: 0,
            files: 0,
            added: 0,
            removed: 0,
          },
          threadDiff: { files: 0, added: 0, removed: 0, complete: true, revision: 'clean' },
        })),
      })
    })
    await thread('Claude')
      .locator('[data-git-tracker]')
      .getByText('main', { exact: true })
      .waitFor()
    assert.equal(await page.getByRole('button', { name: /^Thread diff/ }).count(), 0)
    await capture('thread-diff-clean-branch-visible')
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      window.proof.emit('onSnapshot', {
        ...proof.current,
        sessions: proof.current.sessions.map((session) => ({
          ...session,
          git: {
            ...session.git,
            branch: 'feature/a-very-long-branch-name-for-a-compact-panel',
            ahead: 0,
            behind: 0,
          },
        })),
      })
    })
    const branch = thread('Claude').locator('[data-git-tracker] > span')
    await branch
      .filter({ hasText: 'feature/a-very-long-branch-name-for-a-compact-panel' })
      .waitFor()
    assert.equal(
      await branch.evaluate(
        (element) => element.clientWidth <= 90 && element.scrollWidth > element.clientWidth,
      ),
      true,
    )
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.unavailable = false
      proof.ownedPaths = { claude: ['SRC\\SHARED.TS'], codex: ['other-writer.ts'] }
      proof.worktreeSnapshot = {
        ...proof.current,
        sessions: proof.current.sessions.map((session) => ({ ...session, threadDiff: null })),
      }
      window.proof.emit('onSnapshot', proof.worktreeSnapshot)
    })
    assert.equal(await page.getByRole('button', { name: /^Thread diff/ }).count(), 0)
    assert.equal(await page.getByText('+10k', { exact: true }).count(), 0)
    await thread('Claude').locator('button').first().click({ button: 'right' })
    assert.equal(await page.getByRole('menuitem', { name: 'Thread diff', exact: true }).count(), 0)
    await page.getByRole('menuitem', { name: 'Worktree diff', exact: true }).click()
    await page.locator('header').getByText('Worktree diff · 2 files', { exact: true }).waitFor()
    const sharedRow = page.getByRole('button', { name: /edit shared.ts/ }).locator('..')
    const otherRow = page.getByRole('button', { name: /new other-writer.ts/ }).locator('..')
    const waitOwner = (path, provider) =>
      page.waitForFunction(
        ({ path, provider }) =>
          document
            .querySelector(`button[title="${path}"]`)
            ?.parentElement.getAttribute('data-provider') === provider,
        { path, provider },
      )
    await waitOwner('src/shared.ts', 'claude')
    assert.equal(await otherRow.getAttribute('data-provider'), null)
    const edges = await sharedRow.evaluate((row) => ({
      before: getComputedStyle(row, '::before').backgroundImage,
      after: getComputedStyle(row, '::after').backgroundImage,
      left: getComputedStyle(row, '::before').left,
      right: getComputedStyle(row, '::after').right,
      events: getComputedStyle(row, '::before').pointerEvents,
    }))
    assert.equal(
      edges.before,
      await thread('Claude').evaluate((row) => getComputedStyle(row, '::before').backgroundImage),
    )
    assert.equal(edges.before, edges.after)
    assert.equal(edges.left, '0px')
    assert.equal(edges.right, '0px')
    assert.equal(edges.events, 'none')
    await checkPagePinning(page, 'Worktree diff · 2 files')
    await page.getByRole('button', { name: /edit shared.ts/ }).click()
    await page.getByText('All worktree writers: src/shared.ts', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Open ↗', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.proof.threadDiff.calls.at(-1)), [
      'worktree-open',
      'synthetic-claude',
      'src/shared.ts',
      'worktree-1',
    ])
    await capture('worktree-diff-shared-file')
    // Attribution can change without any change to the worktree's counts or file list.
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.ownedPaths.claude = ['other-writer.ts']
      window.proof.emit('onSnapshot', {
        ...proof.worktreeSnapshot,
        sessions: proof.worktreeSnapshot.sessions.map((session) => ({
          ...session,
          threadDiff: {
            files: 1,
            added: 1,
            removed: 0,
            complete: false,
            revision: 'ownership-only',
          },
        })),
      })
    })
    await waitOwner('other-writer.ts', 'claude')
    assert.equal(await sharedRow.getAttribute('data-provider'), null)
    assert.equal(
      await page.getByText('All worktree writers: src/shared.ts', { exact: true }).count(),
      1,
    )
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.ownershipError = true
      window.proof.emit('onSnapshot', {
        ...proof.worktreeSnapshot,
        sessions: proof.worktreeSnapshot.sessions.map((session) => ({
          ...session,
          threadDiff: {
            files: 1,
            added: 1,
            removed: 0,
            complete: false,
            revision: 'ownership-error',
          },
        })),
      })
    })
    await page.waitForFunction(
      () => document.querySelectorAll('[class*="_fileRow_"][data-provider]').length === 0,
    )
    assert.equal(await page.getByRole('button', { name: /new other-writer.ts/ }).count(), 1)
    await page.evaluate(() => {
      window.proof.threadDiff.ownershipError = false
    })
    await back()
    await thread('Codex').locator('button').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Worktree diff', exact: true }).click()
    await waitOwner('other-writer.ts', 'codex')
    assert.equal(await sharedRow.getAttribute('data-provider'), null)
    assert.notEqual(
      await otherRow.evaluate((row) => getComputedStyle(row, '::before').backgroundImage),
      edges.before,
    )
    await capture('worktree-diff-codex-ownership')
    await page.getByRole('button', { name: /new other-writer.ts/ }).click()
    await page.getByText('All worktree writers: other-writer.ts', { exact: true }).waitFor()
    await back()
    await page.evaluate(() => {
      const proof = window.proof.threadDiff
      proof.unavailable = false
      window.threadlight.getChanges = async () => ({
        branch: 'same-worktree',
        files: [],
        complete: true,
      })
      window.threadlight.getWorktreeChanges = async () => ({ branch: 'same-worktree', files: [] })
      window.proof.emit('onSnapshot', {
        ...proof.current,
        sessions: proof.current.sessions.map((session) => ({
          ...session,
          git: { ...session.git, files: 0 },
          threadDiff: { files: 0, added: 0, removed: 0, revision: 'zero', complete: true },
        })),
      })
    })
    await thread('Claude').locator('button').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Worktree diff', exact: true }).click()
    await page
      .getByText('No changes between the last commit and current files.', { exact: true })
      .waitFor()
    await back()
    await page.evaluate(() =>
      window.proof.emit('onSnapshot', {
        ...window.proof.threadDiff.current,
        sessions: window.proof.threadDiff.current.sessions.map((session) => ({
          ...session,
          git: null,
        })),
      }),
    )
    await thread('Claude').locator('button').first().click({ button: 'right' })
    assert.equal(
      await page.getByRole('menuitem', { name: 'Worktree diff', exact: true }).isDisabled(),
      false,
    )
    await page.evaluate(() => {
      window.threadlight.getWorktreeChanges = async () => null
      window.threadlight.getLocalTracking = async () => ({
        rootId: 'folder',
        root: 'C:/synthetic/folder',
        recording: false,
        baseline: null,
        policyRevision: 0,
        bytes: 0,
        limit: 1000,
        reasons: [],
      })
    })
    await page.getByRole('menuitem', { name: 'Worktree diff', exact: true }).click()
    await page.getByText("This thread's Git worktree is unavailable.", { exact: true }).waitFor()
    await page.getByRole('combobox', { name: 'Change comparison' }).selectOption('folder-baseline')
    await page.getByText(/Enable local file history to capture a starting baseline/).waitFor()
    await page.getByText('Local file history · off', { exact: true }).click()
    await page.getByRole('button', { name: 'Record local file history', exact: true }).waitFor()
    await capture('folder-diff-enable-history')
    await back()
    console.log(
      'PASS: independent thread badges and right-click worktree diffs for both providers; shared-file ownership, scoped Open, refresh, empty/unavailable states and non-Git baseline entry.',
    )
  } finally {
    const close = page.getByRole('button', { name: 'Back to sessions', exact: true })
    if (await close.count()) await close.click()
    await page.evaluate(async (initial) => {
      Object.assign(window.threadlight, window.proof.threadDiff.saved)
      await window.threadlight.updateSettings(initial.settings)
      window.proof.emit('onSnapshot', initial.snapshot)
    }, initial)
    await selectThreadView(page, 'active')
  }
}
