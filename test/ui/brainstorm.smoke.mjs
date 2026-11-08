/* global document */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { build } from 'vite'
const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url)
const { _electron } = require(process.env.THREADLIGHT_PLAYWRIGHT || 'playwright')
await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    ssr: true,
    target: 'node22',
    outDir: join(root, 'out/main'),
    emptyOutDir: false,
    lib: {
      entry: join(root, 'test/ui/brainstorm.fixture.ts'),
      formats: ['cjs'],
      fileName: () => 'brainstorm.fixture.js',
    },
    rollupOptions: { external: ['electron'] },
  },
})
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: require('electron'),
  args: [join(root, 'out/main/brainstorm.fixture.js')],
  env,
})
try {
  const page = await app.firstWindow(),
    errors = []
  page.setDefaultTimeout(10000)
  console.log('Native Brainstorm fixture: renderer opened')
  page.on('pageerror', (error) => errors.push(error.message))
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await app.evaluate(() => {
      const p = globalThis.brainstormProof
      return p.control.call(p.caller, 'threadlight_get_app_state', {})
    })
    if (state.data?.renderer === 'available') break
    await page.waitForTimeout(100)
  }
  const opened = await app.evaluate((_e, operationId) => {
    const p = globalThis.brainstormProof
    return p.control.call(p.caller, 'threadlight_navigate', {
      operationId,
      route: { page: 'spaces', area: 'space', spaceId: p.spaceId },
    })
  }, randomUUID())
  if (opened.outcome !== 'ok') console.log(JSON.stringify({ opened, errors }))
  assert.equal(opened.outcome, 'ok')
  console.log('Native Brainstorm fixture: project opened')
  await page.getByRole('tab', { name: 'Brainstorm', exact: true }).click()
  const message = page.getByRole('textbox', { name: 'Message to Agent', exact: true })
  await message.waitFor()
  assert.equal(
    await app.evaluate(() => globalThis.brainstormProof.spaces.store.discussions().length),
    0,
  )
  assert.equal(await app.evaluate(() => globalThis.brainstormProof.calls.length), 0)
  await message.fill('Explore a first idea')
  await message.press('Enter')
  console.log('Native Brainstorm fixture: first message submitted')
  await page
    .locator('[data-agent-conversation]')
    .getByText('Explore a first idea', { exact: true })
    .waitFor()
  await message.fill('Unsent discussion draft')
  await message.evaluate((input) => input.setSelectionRange(2, 8))
  await page.getByRole('tab', { name: 'Notes', exact: true }).click()
  await page.getByRole('textbox', { name: 'New note' }).fill('Preserve drafts before restart')
  await page.getByRole('button', { name: 'Save note', exact: true }).click()
  await page.getByRole('button', { name: 'Discuss in Brainstorm', exact: true }).click()
  await message.fill('Find the restart decision')
  await message.press('Enter')
  await page.getByText('Proposed plan based on', { exact: false }).waitFor()
  const source = page.locator('[data-agent-conversation] button').filter({ hasText: /^note:/ })
  await source.click()
  await page.waitForFunction(() =>
    document
      .querySelector('[data-agent-conversation]')
      ?.textContent?.includes('Preserve drafts before restart'),
  )
  await page.getByText('Plan and assignments', { exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Mini plan', exact: true })
    .fill('Keep drafts and restore the cursor after navigation.')
  await page.getByRole('button', { name: 'Save plan and choices', exact: true }).click()
  await page.getByRole('button', { name: 'Save plan and choices', exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Notes', exact: true }).click()
  assert.equal(
    await page.getByRole('button').filter({ hasText: 'Preserve drafts before restart' }).count(),
    1,
  )
  await page.getByRole('tab', { name: 'Brainstorm', exact: true }).click()
  await page.getByRole('button', { name: /^Earlier/ }).click()
  await page
    .getByRole('button')
    .filter({ hasText: /Codex · Explore a first idea/ })
    .click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  assert.equal(await message.inputValue(), 'Unsent discussion draft')
  assert.deepEqual(
    await message.evaluate((input) => [input.selectionStart, input.selectionEnd]),
    [2, 8],
  )
  await message.fill('Compare our plans')
  await page.getByText('Compare with another space for this request', { exact: true }).click()
  await page.getByRole('checkbox', { name: 'Design', exact: true }).check()
  await message.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Message to Agent"]')?.value === '',
  )
  const proof = await app.evaluate(() => {
    const p = globalThis.brainstormProof
    return {
      notes: p.spaces.store.all().length,
      discussions: p.spaces.store.discussions().length,
      messages: p.memory.communications.list('message').length,
      tasks: p.memory.tasks().length,
      calls: p.calls,
      plans: p.spaces.store.discussions().map((discussion) => discussion.plan),
    }
  })
  assert.equal(proof.notes, 1)
  assert.equal(proof.discussions, 2)
  assert.equal(proof.messages, 0)
  assert.equal(proof.tasks, 0)
  assert.ok(proof.plans.includes('Keep drafts and restore the cursor after navigation.'))
  assert.ok(proof.calls.at(-1).includes('Design'))
  assert.equal(proof.calls.length, 3)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: real Panel/preload/Spaces service; empty-space discussion, Notes retained, source inspection, separate drafts, explicit comparison, no dispatch.',
  )
} finally {
  await app.close()
}
