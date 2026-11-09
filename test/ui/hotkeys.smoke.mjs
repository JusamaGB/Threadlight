/* global window */
import assert from 'node:assert/strict'

export async function checkHotkeys(page, capture) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const location = (choice) =>
    page.getByRole('button', { name: 'Ghost practice location: ' + choice })
  await location('Current file').click()
  await page.getByRole('menuitem', { name: 'Practice copy', exact: true }).click()
  await location('Practice copy').click()
  await page.getByRole('menuitem', { name: 'Current file', exact: true }).click()
  await location('Current file').waitFor()
  const preference = page.getByRole('button', {
    name: 'Automatic Python suggestions: VS Code setting',
  })
  await preference.click()
  await page.getByRole('menuitem', { name: 'On', exact: true }).click()
  await page.getByRole('button', { name: 'Automatic Python suggestions: On' }).waitFor()
  const toggle = page.getByRole('button', { name: 'Hotkeys', exact: true })
  await toggle.waitFor()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  await page.evaluate(() => {
    window.proof.emit('onHotkeyProblem', 'Pause/Break is unavailable for mic mute.')
    window.threadlight.setHotkeyCapture = (value) =>
      window.proof.calls.push(['capture-hotkey', value])
  })
  await page.getByRole('alert').filter({ hasText: 'Pause/Break is unavailable' }).waitFor()
  await toggle.focus()
  await toggle.press('Enter')
  // React's useId may include punctuation. Look up the controlled region by exact attribute.
  const guide = page.locator('[id="' + (await toggle.getAttribute('aria-controls')) + '"]')
  await guide.getByText('Pause/Break or Ctrl+Alt+M', { exact: true }).waitFor()
  await guide.getByText('Ctrl+Alt+B', { exact: true }).waitFor()
  await guide.getByText('Accept Inline Change', { exact: true }).waitFor()
  await guide.getByText('Indent while tracing', { exact: true }).waitFor()
  await guide.getByText('Dismiss Trace', { exact: true }).waitFor()
  await guide.getByText('Preview Predicted Python Edit', { exact: true }).waitFor()
  await guide.getByText('Skip Proposed Change', { exact: true }).waitFor()
  await guide.getByText('Ctrl + right-drag', { exact: true }).waitFor()
  const field = guide.locator('button').filter({ hasText: /^(Ctrl\+Alt\+Q|F8)$/ })
  await field.click()
  await page.keyboard.press('F8')
  await guide.getByRole('button', { name: 'F8', exact: true }).waitFor()
  assert.deepEqual(
    await page.evaluate(() =>
      window.proof.calls
        .filter((c) => c[0] === 'capture-hotkey')
        .map((c) => c[1])
        .slice(0, 2),
    ),
    [true, false],
  )
  await page.evaluate(() => window.proof.emit('onHotkeyProblem', null))
  assert.equal(
    await page.getByText('Pause/Break is unavailable for mic mute.', { exact: true }).count(),
    0,
  )
  const fit = await guide.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  assert.ok(fit, 'shortcut guide fits the narrow settings panel')
  await capture('settings-hotkeys')
  await toggle.press('Space')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  await toggle.click()
  await guide.getByRole('button', { name: 'F8', exact: true }).waitFor()
  console.log(
    'PASS collapsed and keyboard-operated Hotkeys, current Talk capture, Brainstorm, Pause and alternate mute, screen regions, companion defaults and registration errors.',
  )
}
