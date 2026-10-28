/* global window, document */
import assert from 'node:assert/strict'

export async function checkMessageArtifacts(page, conversation, capture) {
  await page.evaluate(async () => {
    const threadId = window.proof.timeline.threadId
    const original = window.threadlight.artifacts
    const old = await original(threadId, 'list')
    const base = old.ok ? old.items : []
    window.proof.messageArtifactOriginal = original
    window.proof.messageArtifactReads = []
    window.proof.messageArtifactReady = false
    const preview = {
      id: 'message-preview',
      title: 'narrow-diff-preview.html',
      path: 'C:\\previews\\narrow-diff-preview.html',
      kind: 'html',
      mime: 'text/html',
      createdAt: 2,
      source: 'reference',
    }
    const other = { ...preview, id: 'other-preview', path: 'C:/other/narrow-diff-preview.html' }
    window.proof.messageArtifactItems = [...base, preview, other]
    window.threadlight.artifacts = async (thread, action, id) => {
      if (thread !== threadId) return original(thread, action, id)
      if (action === 'read' && ['message-preview', 'other-preview'].includes(id)) {
        window.proof.messageArtifactReads.push({ thread, id })
        return {
          ok: true,
          items: window.proof.messageArtifactItems,
          content: `<h1>${id === 'message-preview' ? 'Linked preview' : 'Wrong preview'}</h1>`,
        }
      }
      if (action === 'list')
        return {
          ok: true,
          items: window.proof.messageArtifactReady ? window.proof.messageArtifactItems : base,
        }
      return original(thread, action, id)
    }
    const event = window.proof.timeline.items.find((item) => item.role === 'assistant')
    const marker = '\uE200visualize\uE202{"path":"c:/PREVIEWS/narrow-diff-preview.html"}\uE201'
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items,
        {
          ...event,
          id: 'message-artifact-proof',
          role: 'assistant',
          kind: 'message',
          activity: undefined,
          text: `Preview ready.\n\n${marker}\n\nThe draft is unchanged.`,
          complete: true,
          phase: 'final',
        },
      ],
    })
  })
  const message = conversation.locator('[data-message-id="message-artifact-proof"]')
  const link = message.getByRole('link', { name: 'narrow-diff-preview.html', exact: true })
  await link.waitFor()
  assert.equal(await link.isDisabled(), true, 'undiscovered files are not opened by raw path')
  assert.doesNotMatch(await message.innerText(), /visualize|PREVIEWS|"path"/)
  await page.evaluate(() =>
    window.proof.emit('onArtifactsChanged', {
      threadId: 'synthetic-claude',
      items: [window.proof.messageArtifactItems.at(-1)],
    }),
  )
  assert.equal(await link.isDisabled(), true, 'another chat cannot supply this message’s artifact')
  await page.evaluate(() => {
    window.proof.messageArtifactReady = true
    window.proof.emit('onArtifactsChanged', {
      threadId: window.proof.timeline.threadId,
      items: window.proof.messageArtifactItems,
    })
  })
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-message-id="message-artifact-proof"] [role="link"]').disabled,
  )
  await link.focus()
  await capture('smart-thread-artifact-link')
  await link.press('Enter')
  await page
    .frameLocator('iframe')
    .getByRole('heading', { name: 'Linked preview', exact: true })
    .waitFor()
  const reads = await page.evaluate(() => window.proof.messageArtifactReads)
  assert.ok(reads.length > 0)
  assert.ok(reads.every((read) => read.id === 'message-preview'))
  assert.ok(reads.every((read) => read.thread === 'codex:11111111-1111-4111-8111-111111111111'))
  await capture('smart-thread-linked-artifact')
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click()
  await conversation.waitFor()
  await link.waitFor()
  const jump = conversation.getByRole('button', { name: /(?:Jump to live|new · Live)/ })
  if (await jump.count()) await jump.click()
  console.log(
    'PASS: named preview links, delayed discovery, exact artifact/chat isolation, keyboard opening and return to the smart thread.',
  )
}
