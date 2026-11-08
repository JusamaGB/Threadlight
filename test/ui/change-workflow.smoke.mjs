/* global window */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { selectThreadView } from './header-navigation.mjs'

/** Real renderer and real Git service; only the IPC transport and provider snapshot are synthetic. */
export async function checkChangeWorkflow(page, capture) {
  const require = createRequire(import.meta.url)
  const { ChangeWorkflowService } = require('../../src/main/changeWorkflow.ts')
  const root = await mkdtemp(join(tmpdir(), 'threadlight-guided-ui-'))
  const alternate = await mkdtemp(join(tmpdir(), 'threadlight-guided-alternate-'))
  const store = await mkdtemp(join(tmpdir(), 'threadlight-guided-ui-store-'))
  const exec = promisify(execFile)
  const git = async (...args) =>
    (await exec('git', args, { cwd: root, windowsHide: true })).stdout.trim()
  try {
    await git('init', '-b', 'main')
    await git('config', 'user.email', 'ui@example.invalid')
    await git('config', 'user.name', 'UI proof')
    await git('config', 'core.autocrlf', 'false')
    await git('config', 'commit.gpgsign', 'false')
    await writeFile(join(root, 'feature.txt'), 'before\n')
    await writeFile(join(root, 'other.txt'), 'original\n')
    await git('add', '.')
    await git('commit', '-m', 'base')
    await exec('git', ['clone', '--no-hardlinks', root, alternate], { windowsHide: true })
    await writeFile(join(alternate, 'alternative-only.txt'), 'other checkout\n')
    await writeFile(join(root, 'feature.txt'), 'after\n')
    await writeFile(join(root, 'other.txt'), 'another chat staged this\n')
    await git('add', 'other.txt')
    const indexBefore = await readFile(join(root, '.git', 'index'))
    const headBefore = await git('rev-parse', 'HEAD')
    const service = new ChangeWorkflowService(store)
    const choices = []
    for (const folder of [root, alternate]) {
      const result = await service.request('fixture', folder, { action: 'roots' })
      assert.equal(result.kind, 'roots')
      choices.push(...result.roots)
    }
    await page.exposeFunction('guidedWorkflowProof', (id, command, rootId) => {
      if (command.action === 'roots') return { kind: 'roots', roots: choices }
      const selected = choices.find((choice) => choice.id === rootId)
      return selected
        ? service.request(id, selected.root, command)
        : { kind: 'error', reason: 'Choose a checkout' }
    })
    await page.evaluate(async () => {
      window.threadlight.changeWorkflow = (id, command, rootId) =>
        window.guidedWorkflowProof(id, command, rootId)
      window.threadlight.getLocalTracking = async () => null
      window.threadlight.getChanges = window.threadlight.getWorktreeChanges = async () => ({
        branch: 'main',
        revision: 'proof',
        complete: true,
        files: [{ path: 'feature.txt', status: 'modified', added: 1, removed: 1 }],
      })
      await window.threadlight.updateSettings({
        hoverHelp: 'teach',
        enabledProviders: ['claude', 'codex'],
      })
      const snapshot = await window.threadlight.getSnapshot()
      window.proof.emit('onSnapshot', {
        ...snapshot,
        sessions: snapshot.sessions.map((s) => ({
          ...s,
          threadDiff: { files: 1, added: 1, removed: 1, revision: 'proof', complete: true },
        })),
      })
    })
    await selectThreadView(page, 'recent')
    // Enter from a thread's own diff badge, not a standalone demo page.
    await page
      .getByRole('button', { name: /^Thread diff/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Prepare changes', exact: true }).click()
    const workflow = page.getByRole('region', { name: 'Prepare changes', exact: true })
    await workflow.getByText('Choose changes to save', { exact: true }).waitFor()
    await workflow.getByLabel('Checkout', { exact: true }).selectOption(choices[1].id)
    await workflow.getByRole('checkbox', { name: /alternative-only\.txt/ }).waitFor()
    await workflow.getByLabel('Checkout', { exact: true }).selectOption(choices[0].id)
    await workflow.getByRole('checkbox', { name: /feature\.txt/ }).check()
    assert.equal(await workflow.getByRole('checkbox', { name: /alternative-only\.txt/ }).count(), 0)
    assert.equal(await workflow.getByRole('checkbox', { name: /other\.txt/ }).isChecked(), false)
    await page
      .locator('[data-teach-footer]')
      .getByText('What am I selecting?', { exact: true })
      .waitFor()
    await capture('guided-selection-teach')
    await workflow.getByRole('button', { name: 'Prepare 1 selected file', exact: true }).click()
    await workflow.getByText('Check the selected change', { exact: true }).waitFor()
    assert.match(await workflow.locator('pre').first().innerText(), /\+after/)
    assert.doesNotMatch(await workflow.locator('pre').first().innerText(), /another chat/)
    await workflow.getByRole('button', { name: 'Run selected checks', exact: true }).click()
    await workflow.getByRole('button', { name: 'Review local commit', exact: true }).click()
    await workflow.getByLabel('New local branch', { exact: true }).fill('ui-reviewed')
    await workflow.getByLabel('Commit message', { exact: true }).fill('Save reviewed feature')
    assert.equal(
      await workflow.getByRole('button', { name: 'Save local commit', exact: true }).isEnabled(),
      false,
    )
    await workflow
      .getByRole('checkbox', { name: 'I understand that no project checks were run.', exact: true })
      .check()
    await capture('guided-review-teach')
    await page.evaluate(() => window.threadlight.updateSettings({ hoverHelp: 'off' }))
    assert.equal(await page.locator('[data-teach-footer]').innerText(), '')
    await workflow.getByText('Nothing is uploaded.', { exact: false }).waitFor()
    await page.evaluate(() => window.threadlight.updateSettings({ hoverHelp: 'teach' }))
    await workflow.getByRole('button', { name: 'Save local commit', exact: true }).click()
    await workflow.getByText('Local checkpoint saved', { exact: true }).waitFor()
    assert.equal(await git('show', 'ui-reviewed:feature.txt'), 'after')
    assert.equal(await git('show', 'ui-reviewed:other.txt'), 'original')
    assert.equal(await git('rev-parse', 'HEAD'), headBefore)
    assert.deepEqual(await readFile(join(root, '.git', 'index')), indexBefore)
    await capture('guided-saved-teach')
    await workflow.getByRole('button', { name: 'Back to diff', exact: true }).click()
    assert.equal(
      await page.locator('[data-teach-footer]').innerText(),
      '',
      'teaching unmounts with workflow',
    )
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    for (const label of ['Tour', 'Full', 'Teach', 'Off'])
      await page.getByRole('radio', { name: label, exact: true }).waitFor()
    await page.getByRole('radio', { name: 'Teach', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    assert.equal(
      await page.getByRole('radio', { name: 'Teach', exact: true }).getAttribute('aria-checked'),
      'true',
    )
    console.log(
      'PASS: thread diff → selected candidate → checks → local commit; real Git preserves source HEAD and index; Teach footer, Off essentials and persisted settings.',
    )
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
    await rm(alternate, { recursive: true, force: true, maxRetries: 3 })
    await rm(store, { recursive: true, force: true, maxRetries: 3 })
  }
}
