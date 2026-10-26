/* global window */
import assert from 'node:assert/strict'
import { readMotionFrame } from './motion-pixels.mjs'

export async function checkMicPill(page, capture) {
  await page.evaluate(() => window.proof.emit('onOpenMicLive', true))
  const pill = page.getByRole('group', { name: 'Microphone is open', exact: true })
  await pill.waitFor()
  const bounds = await pill.boundingBox()
  assert.equal(bounds.width, 92)
  assert.equal(bounds.height, 32)
  const opens = () =>
    page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'dotClick').length)
  const before = await opens()
  await pill.hover()
  assert.equal(await opens(), before)
  await page.evaluate(() => window.proof.emit('onOpenMicLevel', 0.7))
  assert.ok((await readMotionFrame(pill.getByRole('img'))).count > 0)
  await capture('open-mic-pill')
  await page.getByRole('button', { name: 'Close microphone', exact: true }).click()
  assert.equal(await opens(), before)
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'stopOpenMic').length),
    1,
  )
  await page
    .getByRole('button', { name: 'Show threads while microphone is open', exact: true })
    .click()
  assert.equal(await opens(), before + 1)
  await page.evaluate(() => window.proof.emit('onOpenMicLive', false))
  await pill.waitFor({ state: 'detached' })
  await page.getByRole('status', { name: /Chat monitoring is paused/ }).waitFor()
}
