/* global window, document */
import assert from 'node:assert/strict'

export async function checkCompaction(page, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'dual',
      listMode: 'recent',
    })
    await window.proof.patch({
      state: 'working',
      attention: null,
      compacting: true,
      thinking: false,
      stage: 'Compacting context',
      lastAction: 'An outdated progress update',
    })
  })
  const row = page.locator('[data-session-id^="codex:"]').first()
  await row.getByText('Compacting context', { exact: true }).waitFor()
  const collapsedHeight = (await row.boundingBox()).height
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('p')].some((p) => p.textContent === 'Compacting context'),
  )
  assert.equal(await row.getByText('An outdated progress update', { exact: true }).count(), 0)
  await capture('compacting-context-now')
  await row
    .getByRole('button', { name: /Synthetic Codex/ })
    .first()
    .click()
  await page.evaluate(() =>
    window.proof.patch({ compacting: false, stage: 'Resuming work', lastAction: 'Resuming work' }),
  )
  await row.getByText('Resuming work', { exact: true }).waitFor()
  assert.equal(await page.getByText('Compacting context', { exact: true }).count(), 0)
  assert.equal(
    (await row.boundingBox()).height,
    collapsedHeight,
    'status uses the existing row space',
  )
  console.log(
    'PASS: compaction replaces Now in the row and expanded detail, resumes cleanly, and adds no row height.',
  )
}
