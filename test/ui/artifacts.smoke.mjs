import { selectThreadView } from './header-navigation.mjs'
/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'

export async function checkArtifacts(page, capture) {
  await page.setViewportSize({ width: 520, height: 900 })
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'single',
    })
    const records = new Map()
    window.proof.artifactRecords = records
    window.threadlight.artifacts = async (thread, action, id) => {
      const items = records.get(thread) ?? []
      if (action === 'link') {
        items.push(
          { id: 'html', title: 'Storyboard.html', kind: 'html' },
          { id: 'text', title: 'Notes.txt', kind: 'text' },
          { id: 'image', title: 'Frame.png', kind: 'image' },
        )
        records.set(thread, items)
        window.proof.emit('onArtifactsChanged', { threadId: thread, items: [...items] })
      }
      if (window.proof.artifactFail) return { ok: false, reason: 'Artifact file unavailable.' }
      const contents = {
        html: '<h1>Storyboard preview</h1><style>h1 { color: rgb(20, 80, 160); }</style><script>parent.artifactExecuted=true</script><a href="https://example.invalid">Blocked link</a><img src="https://example.invalid/tracker"><iframe src="https://example.invalid"></iframe>',
        text: '<script>literal text</script>',
        image:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=',
      }
      return { ok: true, items, ...(action === 'read' ? { content: contents[id] } : {}) }
    }
  })
  await selectThreadView(page, 'recent')
  const open = async (provider) => {
    await page
      .getByRole('button', { name: new RegExp(`Synthetic ${provider}`) })
      .first()
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Artifacts…', exact: true }).click()
  }
  const network = []
  const claudeRow = page.locator('[data-session-id="synthetic-claude"]')
  const rowHeightBefore = (await claudeRow.boundingBox()).height
  assert.equal(
    await page.getByRole('group', { name: 'Thread attachments', exact: true }).count(),
    0,
  )
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) network.push(request.url())
  })
  await open('Claude')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-dual]') &&
      document.querySelector('[data-card]').getBoundingClientRect().width > 450,
  )
  assert.equal(
    await page.evaluate(async () => (await window.threadlight.getSettings()).panelLayout),
    'single',
    'artifact width does not change the saved layout',
  )
  await page.getByRole('button', { name: 'Link file…' }).click()
  await page.frameLocator('iframe').getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Artifact', exact: true }).count(), 0)
  for (const name of ['Refresh', 'Keep a copy', 'Link file…']) {
    const action = page.locator('header').getByRole('button', { name, exact: true })
    assert.equal(await action.count(), 1, `${name} is in the header`)
    assert.equal(await action.textContent(), '', `${name} uses only an icon`)
    assert.equal(await action.locator('svg').count(), 1)
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).hover()
  await page
    .locator('[data-hover-message]')
    .getByText('Refresh this artifact from its original file.', { exact: true })
    .waitFor()
  await page.waitForTimeout(250)
  await capture('artifact-header-help')
  await page.mouse.move(510, 800)
  assert.equal(
    await page.getByLabel('Artifact information', { exact: true }).count(),
    0,
    'loaded artifacts have no filename or thread-title footer',
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Open artifact 1: Storyboard.html', exact: true })
      .getAttribute('title'),
    'Storyboard.html',
    'the header chip retains the filename on hover',
  )
  assert.equal(await page.getByText('Choose an artifact', { exact: true }).count(), 0)
  assert.equal(await page.getByText(/Saved copies/).count(), 0)
  const navigation = page.getByRole('navigation', { name: 'Thread artifact navigation' })
  assert.equal(await navigation.locator('button[aria-pressed]').count(), 3)
  const layout = await navigation.evaluate((nav) => {
    const rect = nav.getBoundingClientRect()
    const header = nav.closest('header').getBoundingClientRect()
    const chips = [...nav.querySelectorAll('button[aria-pressed]')]
    const marks = chips.map((chip) => chip.firstElementChild.getBoundingClientRect())
    const arrows = [...nav.querySelectorAll('button:not([aria-pressed])')].map((el) =>
      el.getBoundingClientRect(),
    )
    return {
      centered: Math.abs(rect.x + rect.width / 2 - header.x - header.width / 2) < 1,
      onDivider: marks.every(
        (mark) => Math.abs(mark.y + mark.height / 2 - (header.bottom - 0.5)) < 1,
      ),
      small: marks.every((mark) => mark.width === 12 && mark.height === 3),
      blank: chips.every((chip) => chip.textContent === ''),
      closeArrows: marks[0].left - arrows[0].right <= 4 && arrows[1].left - marks.at(-1).right <= 4,
    }
  })
  assert.deepEqual(layout, {
    centered: true,
    onDivider: true,
    small: true,
    blank: true,
    closeArrows: true,
  })
  await page.keyboard.press('ArrowRight')
  await page.getByText('<script>literal text</script>', { exact: true }).waitFor()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('img', { name: 'Frame.png' }).waitFor()
  await page.keyboard.press('ArrowRight')
  await page.frameLocator('iframe').getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  await page.keyboard.press('ArrowLeft')
  await page.getByRole('img', { name: 'Frame.png' }).waitFor()
  await page.keyboard.press('Control+ArrowLeft')
  assert.equal(
    await navigation.locator('[aria-pressed="true"]').getAttribute('data-artifact-id'),
    'image',
  )
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'artifact-editing-check'
    input.value = 'editable'
    document.querySelector('[aria-label="Thread artifacts"]').append(input)
    input.focus()
  })
  await page.keyboard.press('ArrowLeft')
  assert.equal(
    await navigation.locator('[aria-pressed="true"]').getAttribute('data-artifact-id'),
    'image',
    'editing arrows stay in text fields',
  )
  await page.evaluate(() => document.querySelector('#artifact-editing-check').remove())
  await page.keyboard.press('ArrowRight')
  await page.frameLocator('iframe').getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  await page.getByRole('button', { name: 'Next artifact', exact: true }).click()
  await page.getByText('<script>literal text</script>', { exact: true }).waitFor()
  assert.equal(
    await navigation
      .getByRole('button', { name: 'Open artifact 2: Notes.txt', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  await page.getByRole('button', { name: 'Previous artifact', exact: true }).click()
  await page.frameLocator('iframe').getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  await page.getByRole('button', { name: 'Previous artifact', exact: true }).click()
  await page.getByRole('img', { name: 'Frame.png' }).waitFor()
  await page.getByRole('button', { name: 'Next artifact', exact: true }).click()
  await page.frameLocator('iframe').getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  await navigation.getByRole('button', { name: 'Open artifact 3: Frame.png', exact: true }).click()
  await page.getByRole('img', { name: 'Frame.png' }).waitFor()
  await navigation
    .getByRole('button', { name: 'Open artifact 1: Storyboard.html', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  await page.frameLocator('iframe').getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  await navigation
    .getByRole('button', { name: 'Open artifact 1: Storyboard.html', exact: true })
    .click()
  const frame = page.frameLocator('iframe[title="Storyboard.html"]')
  await frame.getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  assert.equal(await frame.locator('a').getAttribute('href'), null)
  assert.equal(await page.evaluate(() => window.artifactExecuted), undefined)
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), '')
  const stage = await page.locator('iframe').boundingBox()
  assert.ok(Math.abs(stage.width - stage.height) < 2, 'square preview')
  const previewLayout = await page
    .getByLabel('Artifact content', { exact: true })
    .evaluate((el) => {
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      const card = el.closest('[data-card]').getBoundingClientRect()
      return {
        border: style.borderWidth,
        radius: style.borderRadius,
        fullWidth: Math.abs(box.width - card.width + 2) < 1,
      }
    })
  assert.deepEqual(previewLayout, { border: '0px', radius: '0px', fullWidth: true })
  await page.mouse.move(510, 800)
  await capture('artifact-storyboard')
  await navigation.getByRole('button', { name: 'Open artifact 2: Notes.txt', exact: true }).click()
  await page.getByText('<script>literal text</script>', { exact: true }).waitFor()
  await navigation.getByRole('button', { name: 'Open artifact 3: Frame.png', exact: true }).click()
  await page.getByRole('img', { name: 'Frame.png' }).waitFor()
  assert.equal(
    await page
      .getByRole('img', { name: 'Frame.png' })
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  )
  await page.getByRole('button', { name: 'Back to threads' }).click()
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-wide]') &&
      document.querySelector('[data-card]').getBoundingClientRect().width < 250,
  )
  const tiles = claudeRow.getByRole('button', { name: /^Open artifact:/ })
  await tiles.first().waitFor()
  assert.equal(await tiles.count(), 3, 'one tile per saved artifact')
  const attachments = claudeRow.getByRole('group', { name: 'Thread attachments', exact: true })
  const stripBox = await attachments.boundingBox()
  const textBox = await claudeRow.locator(':scope > button').first().boundingBox()
  assert.ok(stripBox.y >= textBox.y + textBox.height, 'attachments sit below both text lines')
  const checker = await tiles.first().locator(':scope > span').first().boundingBox()
  assert.equal(checker.y - stripBox.y, 1, 'checker marks sit closer to the text above')
  assert.equal(checker.height, 3, 'checker marks retain their visible size')
  assert.equal(
    (await claudeRow.boundingBox()).height,
    rowHeightBefore,
    'adding attachments preserves the thread container height',
  )
  assert.equal(
    (await page.locator('[data-session-id^="codex:"]').first().boundingBox()).height,
    rowHeightBefore,
    'threads with and without attachments have the same height',
  )
  assert.equal(
    await page.locator('[data-provider="codex"] [aria-label="Thread attachments"]').count(),
    0,
  )
  await page.getByRole('button', { name: 'Open artifact: Notes.txt', exact: true }).hover()
  await page.getByRole('tooltip').filter({ hasText: 'Notes.txt' }).waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: 'Open artifact: Notes.txt', exact: true })
      .getAttribute('title'),
    'Notes.txt',
  )
  await capture('artifact-checker-strip')
  await page.getByRole('button', { name: 'Open artifact: Notes.txt', exact: true }).click()
  await page.getByText('<script>literal text</script>', { exact: true }).waitFor()
  assert.equal(
    await claudeRow.locator('[aria-expanded="true"]').count(),
    0,
    'tile does not expand row',
  )
  await page.getByRole('button', { name: 'Back to threads' }).click()
  await page.getByRole('button', { name: 'Open artifact: Frame.png', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('img', { name: 'Frame.png' }).waitFor()
  await page.getByRole('button', { name: 'Back to threads' }).click()
  await page.waitForFunction(() => !document.querySelector('[data-wide]'))
  await page.evaluate(() => {
    window.proof.retainedArtifacts = window.proof.artifactRecords.get('synthetic-claude')
    window.proof.artifactRecords.set('synthetic-claude', [])
    window.proof.emit('onArtifactsChanged', { threadId: 'synthetic-claude', items: [] })
  })
  await attachments.waitFor({ state: 'detached' })
  assert.equal(
    (await claudeRow.boundingBox()).height,
    rowHeightBefore,
    'removing attachments also preserves the thread container height',
  )
  await page.evaluate(() => {
    const items = window.proof.retainedArtifacts
    window.proof.artifactRecords.set('synthetic-claude', items)
    window.proof.emit('onArtifactsChanged', { threadId: 'synthetic-claude', items })
  })
  await attachments.waitFor()
  await page.evaluate(() => {
    window.proof.originalArtifacts = window.proof.artifactRecords.get('synthetic-claude')
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `frame-${index}`,
      title: `Frame ${index + 1}.png`,
      kind: 'image',
    }))
    window.proof.artifactRecords.set('synthetic-claude', items)
    window.proof.emit('onArtifactsChanged', {
      threadId: 'synthetic-claude',
      items,
    })
  })
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-session-id="synthetic-claude"] [aria-label^="Open artifact:"]',
      ).length === 20,
  )
  assert.equal(await tiles.count(), 20)
  const rowBounds = await claudeRow.boundingBox()
  for (const tile of await tiles.all()) {
    const bounds = await tile.boundingBox()
    assert.ok(
      bounds.x >= rowBounds.x && bounds.x + bounds.width <= rowBounds.x + rowBounds.width,
      'all tiles stay inside the row',
    )
    assert.ok(bounds.width >= 8, 'crowded strip retains distinct targets')
  }
  assert.equal(
    rowBounds.height,
    rowHeightBefore,
    'a full attachment strip preserves the same height',
  )
  await page.getByRole('button', { name: 'Open artifact: Frame 20.png', exact: true }).hover()
  await page.getByRole('tooltip').filter({ hasText: 'Frame 20.png' }).waitFor()
  await capture('artifact-checker-strip-full')
  await page.evaluate(() => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: `frame-${index}`,
      title: `Frame ${index + 1}.png`,
      kind: 'image',
    }))
    window.proof.artifactRecords.set('synthetic-claude', items)
    window.proof.emit('onArtifactsChanged', { threadId: 'synthetic-claude', items })
  })
  await claudeRow.getByRole('button', { name: 'View all thread artifacts', exact: true }).waitFor()
  assert.equal(await tiles.count(), 19)
  await page.evaluate(() => {
    window.proof.artifactRecords.set('synthetic-claude', window.proof.originalArtifacts)
    window.proof.emit('onArtifactsChanged', {
      threadId: 'synthetic-claude',
      items: window.proof.originalArtifacts,
    })
  })
  await open('Codex')
  assert.equal(
    await page.getByRole('navigation', { name: 'Thread artifact navigation' }).count(),
    0,
    'no cross-thread artifacts',
  )
  await page.keyboard.press('Escape')
  await open('Claude')
  await page.frameLocator('iframe').getByRole('heading', { name: 'Storyboard preview' }).waitFor()
  await page.evaluate(() => {
    window.proof.artifactFail = true
  })
  await navigation.getByRole('button', { name: 'Open artifact 2: Notes.txt', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Artifact file unavailable.' }).waitFor()
  await page.evaluate(() => {
    window.proof.artifactFail = false
    const items = Array.from({ length: 60 }, (_, index) => ({
      id: index === 59 ? 'text' : `extra-${index}`,
      title: `Attachment ${index + 1}.txt`,
      kind: 'text',
    }))
    window.proof.artifactRecords.set('synthetic-claude', items)
  })
  await navigation
    .getByRole('button', { name: 'Open artifact 60: Attachment 60.txt', exact: true })
    .waitFor()
  await navigation
    .getByRole('button', { name: 'Open artifact 60: Attachment 60.txt', exact: true })
    .click()
  await page.getByText('<script>literal text</script>', { exact: true }).waitFor()
  await capture('artifact-navigation-overflow')
  await page.getByRole('button', { name: 'Next artifact', exact: true }).click()
  await page.waitForFunction(
    () =>
      document
        .querySelector('nav[aria-label="Thread artifact navigation"] button[aria-pressed="true"]')
        ?.getAttribute('aria-label') === 'Open artifact 1: Attachment 1.txt',
  )
  assert.equal(
    await navigation.locator('button[aria-pressed="true"]').evaluate((el) => {
      const b = el.getBoundingClientRect(),
        rail = el.parentElement.getBoundingClientRect()
      return b.left >= rail.left && b.right <= rail.right + 1
    }),
    true,
    'cycling brings the selected chip into view',
  )
  await page.evaluate(() =>
    window.proof.artifactRecords.set('synthetic-claude', [
      { id: 'text', title: 'Only file.txt', kind: 'text' },
    ]),
  )
  await navigation
    .getByRole('button', { name: 'Open artifact 1: Only file.txt', exact: true })
    .waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Next artifact', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Previous artifact', exact: true }).isDisabled(),
    true,
  )
  assert.deepEqual(network, [])
  console.log(
    'PASS: live attachment updates on a third line beneath the title/Now text, exact artifact click/keyboard opening, thread isolation, square HTML/image/text viewer, blocked scripts/network, Back/Escape and read errors.',
  )
}
