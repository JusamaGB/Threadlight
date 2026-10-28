/* global window, getComputedStyle */
import assert from 'node:assert/strict'
export async function checkCodexQueue(page, compose, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      listMode: 'recent',
    })
    await window.proof.patch({ live: true, state: 'working', attention: null })
    window.proof.queue = [
      { id: 'existing', text: 'Already queued in Codex', images: 0, editable: true },
    ]
    window.proof.queueCalls = []
    window.threadlight.codexQueue = async (_id, cmd) => {
      window.proof.queueCalls.push(cmd)
      if (cmd.action === 'list' && window.proof.pauseQueueRead) {
        const items = structuredClone(window.proof.queue)
        window.proof.pauseQueueRead = false
        return new Promise((resolve) => {
          window.proof.releaseQueueRead = () => resolve({ ok: true, items })
        })
      }
      if (cmd.action === 'edit') window.proof.queue.find((e) => e.id === cmd.id).text = cmd.text
      if (cmd.action === 'remove' || cmd.action === 'steer')
        window.proof.queue = window.proof.queue.filter((e) => e.id !== cmd.id)
      return { ok: true, items: structuredClone(window.proof.queue) }
    }
    window.threadlight.sendMessage = async (...args) => {
      window.proof.queueCalls.push({ action: 'send', args })
      if (args[3] === 'queue')
        window.proof.queue.push({ id: 'new', text: args[1], images: 1, editable: true })
      return { ok: true }
    }
  })
  await compose('Codex')
  const composer = page.getByRole('group', { name: 'Codex message composer' })
  const queue = composer.getByRole('region', { name: 'Queued messages' })
  await queue.getByText('Already queued in Codex').waitFor()
  const box = composer.getByRole('textbox')
  await box.fill('Please do this next')
  await box.press('Enter')
  await queue.getByText('Please do this next').waitFor()
  assert.equal(await box.inputValue(), '')
  await queue.getByRole('button', { name: 'Edit', exact: true }).last().click()
  await queue.getByRole('textbox', { name: 'Edit queued message' }).fill('Edited follow-up')
  await queue.getByRole('button', { name: 'Save', exact: true }).click()
  await queue.getByText('Edited follow-up').waitFor()
  await queue.getByText('1 image', { exact: true }).waitFor()
  await capture('codex-queue-edited')
  // A refresh already in flight must not restore the removed card or Steer.
  await page.evaluate(() => {
    window.proof.pauseQueueRead = true
  })
  await queue.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.waitForFunction(() => !!window.proof.releaseQueueRead)
  await queue.getByRole('button', { name: 'Remove', exact: true }).last().click()
  await queue.getByText('Edited follow-up').waitFor({ state: 'detached' })
  await page.evaluate(async () => {
    window.proof.releaseQueueRead()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  assert.equal(await queue.getByText('Edited follow-up').count(), 0)
  await queue.getByText('Already queued in Codex').waitFor()
  assert.equal(await queue.getByRole('button', { name: 'Steer', exact: true }).count(), 1)
  await capture('codex-queue-removal-stale-refresh')
  assert.equal(await composer.getByRole('combobox', { name: 'Message timing' }).count(), 0)
  await page.mouse.move(0, 0)
  await box.focus()
  const steer = queue.getByRole('button', { name: 'Steer', exact: true })
  assert.equal(await steer.evaluate((e) => getComputedStyle(e).opacity), '0')
  await queue.getByText('Already queued in Codex').hover()
  assert.equal(await steer.evaluate((e) => getComputedStyle(e).opacity), '1')
  await capture('codex-queue-hover-steer')
  await page.mouse.move(0, 0)
  await steer.focus()
  assert.equal(await steer.evaluate((e) => getComputedStyle(e).opacity), '1')
  assert.deepEqual(
    await page.evaluate(() =>
      window.proof.queueCalls.filter((c) => c.action === 'send').map((c) => c.args[3]),
    ),
    ['queue'],
  )
  const queueBounds = await queue.boundingBox(),
    boxBounds = await box.boundingBox()
  assert.ok(queueBounds.y + queueBounds.height <= boxBounds.y)
  await page.setViewportSize({ width: 320, height: 760 })
  await capture('codex-queue-narrow')
  await steer.click()
  await queue.waitFor({ state: 'detached' })
  assert.equal(await composer.getByRole('button', { name: 'Steer', exact: true }).count(), 0)
  assert.deepEqual(
    await page.evaluate(() => window.proof.queueCalls.filter((c) => c.action === 'steer')),
    [{ action: 'steer', id: 'existing' }],
  )
}
