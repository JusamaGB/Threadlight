/* global window */
import assert from 'node:assert/strict'
import { selectThreadView } from './header-navigation.mjs'

export async function checkPinList(page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('pin-fixture-initialized')) {
      localStorage.removeItem('fixture.pinnedState')
      localStorage.setItem(
        'threadlight.pinned-code.v1',
        JSON.stringify([{ id: 'legacy', code: 'print(0)', language: 'python', title: 'Practice' }]),
      )
      sessionStorage.setItem('pin-fixture-initialized', '1')
    }
  })
  await page.reload()
  const dock = page.getByRole('region', { name: 'Pinned code' })
  await dock.getByText('Snippet · print(0)', { exact: false }).waitFor()
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({ panelLayout: 'single', listMode: 'recent' })
    const items = ['first', 'second'].map((id) => ({
      id,
      title: 'practice.py',
      path: 'C:/' + id + '/practice.py',
      source: 'reference',
      kind: 'text',
      mime: 'text/plain',
      createdAt: 1,
    }))
    window.threadlight.artifacts = async (_thread, action) => ({
      ok: true,
      items,
      ...(action === 'read' ? { content: 'print(1)  # ' + 'long line '.repeat(50) } : {}),
    })
  })
  await selectThreadView(page, 'recent')
  await page
    .getByRole('button', { name: /Synthetic Claude/ })
    .first()
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Artifacts', exact: true }).click()
  const stage = page.getByLabel('Artifact content', { exact: true })
  for (const [i, id] of ['first', 'second'].entries()) {
    await page.locator('[data-artifact-id="' + id + '"]').click()
    await stage.locator('summary').filter({ hasText: 'practice.py' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
    const header = dock.locator('summary').nth(i + 1)
    await header.waitFor()
    assert.match(await header.textContent(), /practice\.pyPython/)
    await header.focus()
    await page
      .locator('[data-hover-message] [role="tooltip"]')
      .filter({ hasText: 'C:/' + id + '/practice.py' })
      .waitFor()
    assert.match(await header.getAttribute('aria-description'), /Recorded file/)
    if (i === 0) await header.press('Enter')
  }
  assert.equal(await dock.locator('details:not([open])').count(), 1)
  await page.reload()
  await dock.locator('summary').nth(2).waitFor()
  assert.equal(await dock.locator('details').nth(1).getAttribute('open'), null)
  assert.notEqual(await dock.locator('details').nth(2).getAttribute('open'), null)
  assert.equal(
    await dock.locator('summary').first().getAttribute('aria-description'),
    'Unnamed code snippet\nConversation · Practice\nPin · legacy',
  )
  await dock.locator('summary').nth(2).hover()
  await page
    .locator('[data-hover-message] [role="tooltip"]')
    .filter({ hasText: 'C:/second/practice.py' })
    .waitFor()
  console.log(
    'PASS legacy snippet, pinning same-basename actual artifacts, independent folding and persistence, full path in the shared footer on focus and hover.',
  )
}
