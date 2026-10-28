/* global window, document */
import assert from 'node:assert/strict'

export async function checkThreadImages(page, conversation, capture) {
  await page.evaluate(() => {
    const render = (width, height, color, label) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 24px sans-serif'
      ctx.fillText(label, 15, 40)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 4
      ctx.strokeRect(12, 60, width - 24, height - 75)
      return canvas.toDataURL('image/png')
    }
    window.proof.imageRequests = []
    const sources = {
      'image-one': render(480, 300, '#31678d', 'Landscape'),
      'image-two': render(220, 600, '#90613a', 'Portrait'),
    }
    window.proof.imageSources = sources
    window.proof.inspectedImages = []
    const artifactItems = [
      { id: 'first-image', title: 'image-one.png', kind: 'image', mime: 'image/png', createdAt: 1 },
    ]
    window.threadlight.artifacts = async (thread, action, id) => ({
      ok: true,
      items: artifactItems,
      ...(action === 'read'
        ? { content: sources[id === 'first-image' ? 'image-one' : 'image-two'] }
        : {}),
    })
    window.threadlight.threadImage = async (request) => {
      if (request.action === 'inspect') {
        window.proof.inspectedImages.push(request)
        if (window.proof.inspectFailure)
          return { ok: false, reason: 'The original image is unavailable.' }
        const artifactId = 'inspected-' + request.itemId
        if (!artifactItems.some((item) => item.id === artifactId))
          artifactItems.push({
            id: artifactId,
            title: request.itemId + '.png',
            kind: 'image',
            mime: 'image/png',
            createdAt: 2,
          })
        window.proof.emit('onArtifactsChanged', {
          threadId: request.threadId,
          items: [...artifactItems],
        })
        return { ok: true, dataUrl: sources[request.itemId], artifactId }
      }
      window.proof.imageRequests.push(request)
      return sources[request.itemId]
        ? { ok: true, dataUrl: sources[request.itemId] }
        : { ok: false, reason: 'Image unavailable.' }
    }
    const base = window.proof.timeline.items.find((i) => i.id === 'tool')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items,
        {
          ...base,
          id: 'gallery-divider',
          role: 'assistant',
          kind: 'message',
          text: 'Checking the screenshots',
          complete: true,
        },
        ...['image-one', 'image-two', 'image-missing'].map((id) => ({
          ...base,
          id,
          activity: 'image',
          text: 'Viewed an image',
          detail: 'C:/screenshots/' + id + '.png',
          complete: true,
        })),
      ],
    })
  })
  const group = conversation.locator('details[data-message-id="image-one"]')
  await group.locator(':scope > summary').click()
  assert.equal(
    await page.evaluate(() => window.proof.imageRequests.length),
    0,
    'closed image entry loads no files',
  )
  await group
    .locator('summary')
    .filter({ hasText: /^Viewed 3 images$/ })
    .click()
  const gallery = group.getByRole('group', { name: 'Viewed images' })
  const image = gallery.getByRole('img')
  await image.waitFor()
  await image.evaluate((el) => el.decode())
  assert.equal(await image.getAttribute('alt'), 'image-one.png')
  assert.equal(await gallery.getByRole('button', { name: 'Previous image' }).isDisabled(), true)
  assert.ok((await image.boundingBox()).width <= (await conversation.boundingBox()).width)
  assert.equal(await gallery.locator('pre').count(), 0)
  await page.waitForFunction(() => {
    const history = document.querySelector('[aria-label="Conversation history"]')
    const image = document.querySelector('[aria-label="Viewed images"] img')
    return image && image.getBoundingClientRect().bottom <= history.getBoundingClientRect().bottom
  })
  await capture('thread-images-landscape')
  await gallery.getByRole('button', { name: 'Next image' }).click()
  await gallery.getByRole('img', { name: 'image-two.png' }).waitFor()
  await image.evaluate((el) => el.decode())
  assert.equal(await image.evaluate((el) => window.getComputedStyle(el).objectFit), 'contain')
  await gallery.getByText('2 / 3', { exact: true }).waitFor()
  await capture('thread-images-portrait')
  await gallery.getByRole('button', { name: 'Next image' }).click()
  await gallery.getByText('Image unavailable.', { exact: true }).waitFor()
  assert.equal(await gallery.getByRole('button', { name: 'Next image' }).isDisabled(), true)
  await gallery.getByRole('button', { name: 'Previous image' }).click()
  await gallery.getByRole('img', { name: 'image-two.png' }).waitFor()
  const requests = await page.evaluate(() => window.proof.imageRequests)
  assert.deepEqual(
    requests.map((r) => r.itemId),
    ['image-one', 'image-two', 'image-missing', 'image-two'],
  )
  assert.ok(
    requests.every((r) => r.threadId === requests[0].threadId && Object.keys(r).length === 2),
  )
  await image.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Image actions' }).waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Compose', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  await page.getByRole('menu', { name: 'Image actions' }).waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.proof.inspectFailure = true
  })
  await image.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Inspect image', exact: true }).click()
  await gallery
    .getByRole('alert')
    .filter({ hasText: 'The original image is unavailable.' })
    .waitFor()
  await page.evaluate(() => {
    window.proof.inspectFailure = false
  })
  await image.click({ button: 'right' })
  await capture('thread-image-inspect-menu')
  await page.getByRole('menuitem', { name: 'Inspect image', exact: true }).click()
  const inspected = page
    .getByRole('region', { name: 'Thread artifacts' })
    .getByRole('img', { name: 'image-two.png', exact: true })
  await inspected.waitFor()
  await inspected.evaluate((el) => el.decode())
  assert.equal(
    await inspected.getAttribute('src'),
    await page.evaluate(() => window.proof.imageSources['image-two']),
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Open artifact 2: image-two.png', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  const inspectedCalls = await page.evaluate(() => window.proof.inspectedImages)
  assert.ok(
    inspectedCalls.every((r) => r.itemId === 'image-two' && r.threadId === requests[0].threadId),
  )
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 700, height: 900 })
  await capture('thread-image-inspected-artifact')
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click()
  await page.setViewportSize(viewport)
  await conversation.waitFor()
}
