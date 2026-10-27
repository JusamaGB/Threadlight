/* global window */
import assert from 'node:assert/strict'

export async function checkChecklistDiff(page, row, capture) {
  const snapshot = await page.evaluate(() => window.threadlight.getSnapshot())
  await page.evaluate((snapshot) => {
    const saved = Object.fromEntries(
      ['getStepActivity', 'getChanges', 'getFileDiff', 'openChangedFile'].map((key) => [
        key,
        window.threadlight[key],
      ]),
    )
    const files = [
      { path: 'shared/src/a.ts', added: 2, removed: 1, status: 'modified', binary: false },
      { path: 'shared/src/b.ts', added: 3, removed: 0, status: 'added', binary: false },
    ]
    window.proof.checklist = { saved, calls: [], mode: 'text', revision: 1, files }
    window.threadlight.getStepActivity = async () => ({
      startedAt: Date.now() - 5000,
      endedAt: null,
      files: [
        { path: 'C:\\synthetic\\SHARED\\src\\a.ts', added: 2, removed: 1 },
        { path: 'C:/synthetic/shared/src/b.ts', added: 3, removed: 0 },
        { path: 'C:/outside/note.md', added: 1, removed: 0 },
      ],
      commands: [],
      tools: [],
      said: [],
    })
    window.threadlight.getChanges = async (sessionId) => {
      window.proof.checklist.calls.push(['changes', sessionId])
      return { branch: 'main', files: window.proof.checklist.files }
    }
    window.threadlight.getFileDiff = async (sessionId, path) => {
      const proof = window.proof.checklist
      proof.calls.push(['diff', sessionId, path])
      if (proof.mode === 'error') throw new Error('Synthetic read failure')
      if (proof.mode === 'binary') return { kind: 'binary' }
      if (proof.mode === 'too-big') return { kind: 'too-big', lines: 2000 }
      return {
        kind: 'text',
        lines: [
          { type: 'hunk', text: 'synthetic context' },
          { type: 'remove', text: 'old content', oldLine: 1 },
          { type: 'add', text: `new content ${proof.revision} ${path}`, newLine: 1 },
        ],
      }
    }
    window.threadlight.openChangedFile = (...args) =>
      window.proof.checklist.calls.push(['open', ...args])
    const next = {
      ...snapshot,
      sessions: snapshot.sessions.map((session) =>
        session.provider === 'claude'
          ? {
              ...session,
              git: {
                root: 'C:/synthetic',
                branch: 'main',
                added: 5,
                removed: 1,
                files: 2,
                newFiles: 1,
                ahead: 0,
                behind: 0,
                worktrees: [],
              },
              threadDiff: {
                files: 2,
                added: 5,
                removed: 1,
                revision: 'checklist-own-diff',
                complete: true,
              },
              plan: [
                {
                  content: 'Update the preview',
                  status: 'in_progress',
                  files: ['src/a.ts', 'src/untouched.ts'],
                },
                { content: 'Check the preview', status: 'pending', files: ['src/pending.ts'] },
              ],
            }
          : session,
      ),
    }
    window.proof.checklist.snapshot = next
    window.proof.emit('onSnapshot', next)
  }, snapshot)
  const step = page.getByRole('button', { name: /Update the preview$/ })
  const link = (path) => page.getByRole('button', { name: `Show diff for ${path}`, exact: true })
  const calls = () => page.evaluate(() => window.proof.checklist.calls)
  try {
    await row('Claude').click()
    await step.click()
    await link('src/a.ts').waitFor()
    assert.deepEqual(await calls(), [], 'opening a checklist does not read diffs')
    assert.equal(await page.getByRole('button', { name: /Show diff for .*untouched/ }).count(), 0)
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    await link('src/a.ts').hover()
    const tooltip = page.getByRole('tooltip')
    await tooltip.waitFor()
    assert.match(await tooltip.innerText(), /2 lines added, 1 removed on this step/)
    assert.match(await tooltip.innerText(), /this thread's recorded file diff/)
    assert.deepEqual(await calls(), [], 'hovering does not read diffs')
    await capture('checklist-diff-hover')
    await link('src/a.ts').click()
    await page.getByText('new content 1 shared/src/a.ts', { exact: true }).waitFor()
    assert.equal(await link('src/a.ts').getAttribute('aria-expanded'), 'true')
    assert.equal(await step.getAttribute('aria-expanded'), 'true')
    assert.equal(await row('Claude').getAttribute('aria-expanded'), 'true')
    assert.equal(await tooltip.count(), 0)
    assert.ok(
      (await calls()).some((call) => call[0] === 'diff' && call[2] === 'shared/src/a.ts'),
      'Git casing and nested cwd resolve to its canonical path',
    )
    await capture('checklist-diff-open')
    await page.getByRole('button', { name: 'Open ↗', exact: true }).last().click()
    assert.deepEqual((await calls()).at(-1), ['open', 'synthetic-claude', 'shared/src/a.ts'])
    await link('src/b.ts').focus()
    await page.keyboard.press('Enter')
    await page.getByText('new content 1 shared/src/b.ts', { exact: true }).waitFor()
    assert.equal(await link('src/a.ts').getAttribute('aria-expanded'), 'false')
    assert.equal(await page.getByText('old content', { exact: true }).count(), 1)
    await page.keyboard.press('Space')
    await page.getByText('old content', { exact: true }).waitFor({ state: 'detached' })
    await link('src/a.ts').click()
    await page.getByText('new content 1 shared/src/a.ts', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.proof.checklist.revision = 2
      const snapshot = window.proof.checklist.snapshot
      window.proof.emit('onSnapshot', {
        ...snapshot,
        sessions: snapshot.sessions.map((session) =>
          session.provider === 'claude'
            ? { ...session, lastActiveAt: session.lastActiveAt + 1 }
            : session,
        ),
      })
    })
    await page.getByText('new content 2 shared/src/a.ts', { exact: true }).waitFor()
    for (const [mode, message] of [
      ['binary', 'A binary file: not drawn here.'],
      ['too-big', '2000 lines: too long to draw here.'],
      ['error', 'This diff could not be read.'],
    ]) {
      await link('src/a.ts').click()
      await page.evaluate((mode) => {
        window.proof.checklist.mode = mode
      }, mode)
      await link('src/a.ts').click()
      await page.getByText(message, { exact: false }).waitFor()
    }
    await link('outside/note.md').click()
    await page.getByText('This diff could not be read.', { exact: true }).waitFor()
    assert.equal(
      (await calls()).some((call) => call[0] === 'diff' && call[2].includes('outside')),
      false,
    )
    await page.evaluate(() => {
      window.proof.checklist.files = []
    })
    await link('src/a.ts').click()
    await page.getByText('This diff could not be read.', { exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Open ↗', exact: true }).count(),
      1,
      'an already committed file has no false Open action',
    )
    await page.getByRole('button', { name: /Check the preview$/ }).click()
    await page.getByText('src/pending.ts', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /Show diff for/ }).count(), 0)
    await page.evaluate(() => {
      const proof = window.proof.checklist
      proof.mode = 'text'
      proof.files = [
        { path: 'shared/src/a.ts', added: 2, removed: 1, status: 'modified', binary: false },
      ]
    })
    // The pre-existing Changes caller must still render and open a file.
    await row('Claude')
      .getByRole('button', { name: /Thread diff · 2 files changed/ })
      .hover()
    const worktreeTip = page.getByRole('tooltip')
    await worktreeTip.waitFor()
    assert.match(await worktreeTip.innerText(), /Thread diff · 2 files changed/)
    assert.doesNotMatch(await worktreeTip.innerText(), /Worktree total/)
    await capture('thread-diff-tooltip')
    await row('Claude')
      .getByRole('button', { name: /Thread diff · 2 files changed/ })
      .click()
    await page.getByRole('button', { name: /edit a.ts/ }).click()
    await page.getByText('new content 2 shared/src/a.ts', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    console.log(
      'PASS: checklist diff hover, exact file, keyboard, refresh, fallbacks and existing Changes viewer.',
    )
  } finally {
    await page.clock.resume()
    await page.evaluate((snapshot) => {
      Object.assign(window.threadlight, window.proof.checklist.saved)
      window.proof.emit('onSnapshot', snapshot)
    }, snapshot)
    if ((await row('Claude').getAttribute('aria-expanded')) === 'true') await row('Claude').click()
  }
}
