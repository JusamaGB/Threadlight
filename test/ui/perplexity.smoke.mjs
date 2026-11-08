/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'

export async function checkPerplexity(page, capture) {
  await page.evaluate(() => {
    const state = {
      desktop: { state: 'unchecked', checkedAt: null, chats: [], hasMore: false },
      computer: { state: 'disconnected', tools: [] },
      computerThreads: [],
      thread: null,
      busy: false,
      uncertainSend: false,
    }
    window.perplexityProof = { state, calls: [], result: 'credits' }
    window.threadlight.perplexity = async (command) => {
      const proof = window.perplexityProof
      proof.calls.push(command)
      let reason
      if (command.action === 'discover')
        state.desktop = {
          state: 'ready',
          checkedAt: Date.now(),
          hasMore: true,
          chats: [
            {
              id: 'a'.repeat(32),
              title: 'Research: ' + 'a long chat title '.repeat(15),
              preview: 'Full preview ' + 'readable details '.repeat(250),
              status: 'idle',
              archived: false,
            },
            { id: 'b'.repeat(32), title: '', preview: '', status: 'unknown', archived: true },
          ],
        }
      if (command.action === 'connect')
        state.computer = {
          state: 'connected',
          tools: ['read_thread', 'call_perplexity_computer', 'cancel_task'],
        }
      if (command.action === 'disconnect') state.computer = { state: 'disconnected', tools: [] }
      if (command.action === 'send') {
        if (proof.result === 'credits')
          reason = 'Perplexity Computer needs account credits. No message was sent.'
        else if (proof.result === 'uncertain') {
          reason = 'Delivery could not be confirmed.'
          state.uncertainSend = true
        } else {
          state.thread = {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            text: 'Synthetic reply',
            status: 'working',
            event: 'timeout',
            truncated: false,
            needsInput: false,
          }
          state.computerThreads = [{ id: state.thread.id, title: command.message }]
        }
      }
      if (command.action === 'read')
        state.thread = {
          ...state.thread,
          text: 'Synthetic transcript',
          status: 'completed',
          event: 'transcript',
        }
      if (command.action === 'reconcile') state.uncertainSend = false
      if (command.action === 'cancel') state.thread = { ...state.thread, status: 'cancelled' }
      return { ok: !reason, reason, snapshot: structuredClone(state) }
    }
  })
  assert.equal(await page.locator('[data-perplexity-threads]').count(), 0)
  assert.equal(await page.locator('summary:visible').filter({ hasText: 'Perplexity' }).count(), 0)
  await capture('perplexity-threads-clean')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const section = page.locator('[data-perplexity-settings]')
  const summary = section.locator(':scope > summary')
  await summary.waitFor()
  assert.equal(await section.getAttribute('open'), null)
  assert.deepEqual(await page.evaluate(() => window.perplexityProof.calls), [])
  await capture('perplexity-settings-collapsed')
  await summary.focus()
  await page.keyboard.press('Enter')
  await section.getByRole('button', { name: 'Refresh chats' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.perplexityProof.calls.map((c) => c.action)), [
    'status',
  ])
  await capture('perplexity-empty')
  await section.getByRole('button', { name: 'Refresh chats' }).click()
  const chat = section.locator('details').first()
  await chat.locator('summary').focus()
  await page.keyboard.press('Enter')
  await chat.getByRole('button', { name: 'Open chat in Perplexity' }).waitFor()
  assert.ok((await chat.innerText()).includes('Full preview'))
  await capture('perplexity-desktop')
  await chat.locator('summary').click()
  assert.equal(
    await page.evaluate(() => window.perplexityProof.calls.some((c) => c.action === 'send')),
    false,
  )
  await section.getByRole('button', { name: 'Connect Computer' }).click()
  const composer = section.getByRole('textbox', { name: 'Message Perplexity Computer' })
  await composer.fill('Keep this draft')
  await composer.press('Shift+Enter')
  assert.equal(
    await page.evaluate(
      () => window.perplexityProof.calls.filter((c) => c.action === 'send').length,
    ),
    0,
  )
  await composer.press('Enter')
  await section.getByRole('alert').filter({ hasText: 'No message was sent' }).waitFor()
  assert.match(await composer.inputValue(), /Keep this draft/)
  await capture('perplexity-credit-error')
  await summary.click()
  await summary.click()
  await composer.waitFor()
  assert.match(await composer.inputValue(), /Keep this draft/)
  await page.evaluate(() => {
    window.perplexityProof.result = 'success'
  })
  await composer.press('Enter')
  await section.getByText('Synthetic reply', { exact: true }).waitFor()
  assert.equal(await composer.inputValue(), '')
  await section.getByRole('button', { name: 'Stop task', exact: true }).waitFor()
  const sent = await page.evaluate(
    () => window.perplexityProof.calls.filter((c) => c.action === 'send').length,
  )
  await section.getByRole('button', { name: 'Read task', exact: true }).click()
  await section.getByText('Synthetic transcript', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.perplexityProof.calls.filter((c) => c.action === 'send').length,
    ),
    sent,
  )
  await capture('perplexity-computer')
  await page.evaluate(() => {
    window.perplexityProof.result = 'uncertain'
  })
  await composer.fill('Retain follow-up')
  await composer.press('Enter')
  await section.getByRole('button', { name: 'I checked Perplexity' }).waitFor()
  assert.equal(await composer.isDisabled(), true)
  await section.getByRole('button', { name: 'I checked Perplexity' }).click()
  assert.equal(await composer.isEnabled(), true)
  assert.equal(await composer.inputValue(), 'Retain follow-up')
  await page.evaluate(() => {
    window.perplexityProof.state.busy = true
    window.proof.emit('onPerplexity')
  })
  await page.waitForFunction(
    () => document.querySelector('[data-perplexity-settings] textarea')?.disabled,
  )
  assert.equal(
    await section.getByRole('button', { name: 'Disconnect', exact: true }).isDisabled(),
    true,
  )
  await capture('perplexity-busy')
  const dimensions = await section.evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    background: getComputedStyle(el).backgroundColor,
  }))
  assert.ok(dimensions.width < 500, 'checked compact single-column panel')
  assert.ok(
    dimensions.content <= dimensions.width + 1,
    'long content does not overflow horizontally',
  )
  assert.equal(dimensions.background, 'rgba(0, 0, 0, 0)')
  console.log(
    'PASS: Perplexity settings-only disclosure, read-only discovery, keyboard, drafts, credits, uncertain delivery, busy state and compact theme (synthetic IPC).',
  )
}
