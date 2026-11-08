import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
/* global document, window */

/** Exercised by the isolated real Electron Settings runner; all workspace activity is simulated. */
export async function exerciseWorkspace({ page, application, resultPath }) {
  const button = (name) => page.getByRole('button', { name, exact: true })
  await button('Open workspace preview').click()
  const workspace = page.getByRole('region', { name: 'Kimi workspace', exact: true })
  const state = () => workspace.getByRole('status')
  const example = (name) => page.getByLabel('Example state', { exact: true }).selectOption(name)
  assert.ok(await workspace.isVisible())
  await workspace.getByText('Simulated activity', { exact: true }).waitFor()
  assert.equal(await state().innerText(), 'Empty')
  assert.equal(await button('Run Kimi').isEnabled(), false)
  await page
    .getByLabel('Example instruction', { exact: true })
    .fill('Keep this example draft across navigation.')
  await button('Settings').click()
  await button('Open workspace preview').press('Enter')
  assert.equal(
    await page.getByLabel('Example instruction', { exact: true }).inputValue(),
    'Keep this example draft across navigation.',
  )
  await button('Run example').click()
  await state().filter({ hasText: 'Awaiting permission' }).waitFor()
  await button('Deny example').click()
  await workspace.getByText('Write denied. No example file changed.', { exact: true }).waitFor()
  await example('permission')
  await button('Approve example').click()
  await workspace.getByText('Example completed: one greeting updated.', { exact: true }).waitFor()
  assert.equal(await workspace.locator('[data-stacked-diff]').count(), 1)
  await button('Content').click()
  assert.ok((await page.getByLabel('Example file content').innerText()).includes('Hello, Ada!'))
  await button('test/greeting.test.ts').click()
  assert.ok(
    (await page.getByLabel('Example file content').innerText()).includes('expect(greeting)'),
  )
  await example('working')
  await button('Stop example').click()
  assert.equal(await state().innerText(), 'Stop requested')
  assert.equal(await button('Continue example').isEnabled(), false)
  await button('Show uncertain outcome').click()
  assert.equal(await button('Continue example').isEnabled(), false)
  await example('stop-requested')
  await button('Show settled outcome').click()
  assert.equal(await state().innerText(), 'Stopped · settled')
  await button('Continue example').click()
  await workspace
    .getByText('Continuation explicitly requested for this example.', { exact: true })
    .waitFor()
  await example('restored')
  await page.waitForTimeout(800)
  assert.equal(await state().innerText(), 'Restored history · paused')
  await button('Continue example').click()
  assert.equal(await state().innerText(), 'Working')
  await example('failed')
  await workspace
    .getByText('Example connection failed before a write. No automatic retry.', { exact: true })
    .waitFor()
  await example('blocked')
  await workspace.getByRole('alert').waitFor()
  await example('completed')
  await button('src/greeting.ts · changed').click()
  await button('Changes').click()
  await workspace.locator('[data-stacked-diff]').waitFor()
  const capture = async (name, width) => {
    await application.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setSize(width, 850)
    }, width)
    await page.waitForTimeout(200)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    if (resultPath)
      writeFileSync(
        join(resultPath, `${name}.png`),
        Buffer.from(
          await application.evaluate(async () =>
            (await globalThis.kimiNativeProof.panel.capturePage()).toPNG().toString('base64'),
          ),
          'base64',
        ),
      )
  }
  await capture('workspace-desktop', 1100)
  await capture('workspace-narrow', 420)
  await workspace
    .getByText('Checks run here: none. A completed example does not verify a real task.', {
      exact: true,
    })
    .scrollIntoViewIfNeeded()
  await capture('workspace-narrow-files', 420)
  await page.getByLabel('Example state', { exact: true }).focus()
  await page.getByLabel('Example state', { exact: true }).scrollIntoViewIfNeeded()
  assert.equal(
    await page
      .getByLabel('Example state', { exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  await capture('workspace-review', 1100)
  if (resultPath)
    writeFileSync(
      join(resultPath, 'workspace-result.json'),
      JSON.stringify(
        {
          status: 'PASS',
          simulation: true,
          realExecution: false,
          states: [
            'empty',
            'working',
            'permission-approved',
            'permission-denied',
            'stop-requested',
            'stopped',
            'uncertain',
            'continued',
            'completed',
            'failed',
            'restored',
            'blocked',
          ],
          widths: [1100, 420],
          draftPreserved: true,
          settingsUnchanged: true,
        },
        null,
        2,
      ),
    )
}
