/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { revealActivity } from './activity-grouping.smoke.mjs'

export async function checkStackedDiff(page, conversation, capture) {
  const viewport = page.viewportSize()
  const patch = [
    '@@ -447,4 +447,6 @@',
    '                 <h3>Your shared spaces</h3>',
    '-                <p className={styles.hint}>',
    '-                  Notes, files and decisions shared between the chats you connect.',
    '-                </p>',
    '+                {!allMemory?.spaces.length && (',
    '+                  <p className={styles.hint}>',
    '+                    Notes, files and decisions shared between the chats you connect.',
    '+                  </p>',
    '+                )}',
    '@@ -100001 +100002 @@ separate edit',
    '-                old marker',
    '+                new marker',
    '',
  ].join('\n')
  await page.evaluate((patch) => {
    const event = window.proof.timeline.items.find((item) => item.activity === 'files')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items,
        {
          ...event,
          id: 'stacked-diff-proof',
          text: 'Edited 1 file',
          fileCount: 1,
          fileChanges: [{ path: 'src/Indented.tsx', added: 6, removed: 4, diff: patch }],
        },
      ],
    })
  }, patch)
  await revealActivity(conversation, 'stacked-diff-proof')
  await conversation
    .locator('[data-message-id="stacked-diff-proof"]')
    .getByRole('button', { name: 'View', exact: true })
    .click()
  const changes = page.getByRole('region', { name: 'Card changes', exact: true })
  await changes.getByRole('button', { name: /Indented.tsx/ }).click()
  await page.setViewportSize({ width: 280, height: 900 })
  const diff = changes.locator('[data-stacked-diff]')
  const removed = diff.getByRole('region', { name: 'Removed · 3 lines', exact: true })
  const added = diff.getByRole('region', { name: 'Added · 5 lines', exact: true })
  await removed.waitFor()
  await added.waitFor()
  assert.equal(await diff.getAttribute('data-wrap'), 'true')
  assert.equal(await removed.locator('[data-diff-number]').first().textContent(), '448')
  assert.equal(await added.locator('[data-diff-number]').first().textContent(), '448')
  assert.equal(
    await removed.locator('[data-diff-text]').first().textContent(),
    '<p className={styles.hint}>',
  )
  assert.equal(
    await added.locator('[data-diff-text]').nth(1).textContent(),
    '  <p className={styles.hint}>',
  )
  assert.equal(
    await diff.getByText('<h3>Your shared spaces</h3>', { exact: true }).isVisible(),
    false,
  )
  const bounds = await diff.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    overflow: [...element.querySelectorAll('[data-diff-text]')].some(
      (text) => text.scrollWidth > text.clientWidth + 1,
    ),
    lineColumns: getComputedStyle(
      element.querySelector('[data-diff-number]').parentElement,
    ).gridTemplateColumns.split(' ').length,
  }))
  assert.ok(bounds.width <= 240, 'the real card diff fits the narrow panel')
  assert.equal(bounds.overflow, false, 'wrapped source stays inside its text column')
  assert.equal(bounds.lineColumns, 2, 'each row has one number and one text column')
  await capture('stacked-diff-narrow')
  await diff.getByRole('button', { name: 'Wrap on', exact: true }).click()
  assert.equal(
    await removed.locator('[data-diff-text]').first().textContent(),
    '                <p className={styles.hint}>',
  )
  const removedScroll = removed.locator('[class*="_codeLines_"]')
  const addedScroll = added.locator('[class*="_codeLines_"]')
  for (const section of [removedScroll, addedScroll]) {
    const dimensions = await section.evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth,
      track: element.offsetHeight - element.clientHeight,
    }))
    assert.equal(dimensions.overflow, true, 'long unwrapped lines overflow their own section')
    assert.equal(dimensions.track, 6, 'each overflowing section reserves its own slim scrollbar')
  }
  const box = await removedScroll.boundingBox()
  const start = { x: box.x + 10, y: box.y + box.height - 3 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 55, start.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Removed · 3 lines"] [class*="_codeLines_"]').scrollLeft >
      0,
  )
  assert.equal(
    await addedScroll.evaluate((element) => element.scrollLeft),
    0,
    'dragging Removed leaves Added in place',
  )
  const addedBox = await addedScroll.boundingBox()
  await page.mouse.move(addedBox.x + addedBox.width / 2, addedBox.y + 10)
  await page.mouse.wheel(120, 0)
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Added · 5 lines"] [class*="_codeLines_"]').scrollLeft >
      0,
  )
  assert.equal(
    await diff.evaluate((element) => element.scrollLeft),
    0,
    'horizontal scrolling stays inside the section',
  )
  await capture('stacked-diff-section-scrollbars')
  await diff.getByRole('button', { name: 'Wrap off', exact: true }).click()
  for (const section of [removedScroll, addedScroll]) {
    assert.equal(
      await section.evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
      'wrapping removes horizontal overflow',
    )
    assert.equal(
      await section.evaluate((element) => element.offsetHeight - element.clientHeight),
      0,
      'wrapped sections do not reserve scrollbar space',
    )
  }
  const context = diff.getByText('1 unchanged line', { exact: true })
  await context.focus()
  await context.press('Enter')
  await diff.getByText('<h3>Your shared spaces</h3>', { exact: true }).waitFor()
  assert.equal(await diff.getByText('100001', { exact: true }).count(), 1)
  assert.equal(await diff.getByText('100002', { exact: true }).count(), 1)
  assert.equal(
    await page.evaluate(
      () =>
        window.proof.timeline.items.find((item) => item.id === 'stacked-diff-proof').fileChanges[0]
          .diff,
    ),
    patch,
    'display indentation and wrapping never rewrite the captured patch',
  )
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.setViewportSize(viewport)
  console.log(
    'PASS: narrow stacked diffs, independent slim section scrollbars with thumb dragging and horizontal wheel input, original whitespace, source numbers and keyboard context expansion.',
  )
}
