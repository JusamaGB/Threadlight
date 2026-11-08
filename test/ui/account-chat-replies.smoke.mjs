/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { selectThreadView, selectConversationFilter } from './header-navigation.mjs'

export async function checkAccountChatReplies(page, capture) {
  await page.evaluate(() => {
    const ids = {
      chatgpt: '6aeaea26-2338-83ed-a05f-4a2bb9018ff3',
      perplexity: '6aeae6a2-64f0-83ed-ad71-d54499d93c06',
    }
    window.replyProof = {
      calls: [],
      active: true,
      text: 'First response',
      uncertain: false,
      fail: false,
      sent: {},
      rich: false,
    }
    window.threadlight.accountChats = async (command) => {
      const p = window.replyProof
      p.calls.push(command)
      if (command.action === 'list')
        return {
          ok: true,
          kind: 'list',
          chats: [
            {
              id: ids[command.source],
              title: `${command.source} live chat`,
              updatedAt: Date.now(),
              activity: p.active ? 'active' : 'idle',
            },
          ],
          hasMore: false,
          recentOnly: false,
        }
      if (command.action === 'send') {
        if (p.delaySend)
          await new Promise((resolve) => {
            p.releaseSend = resolve
          })
        if (p.fail) {
          p.uncertain = true
          return { ok: false, reason: 'Delivery uncertain' }
        }
        p.text = 'Reply to ' + command.message
        p.sent[command.source] = { id: command.operationId, text: command.message }
        return { ok: true, kind: 'sent', id: command.id, operationId: command.operationId }
      }
      if (command.action === 'confirm-delivery') {
        p.uncertain = false
        return { ok: true, kind: 'delivery-confirmed' }
      }
      if (command.action === 'read' && command.latest && p.holdLatest)
        await new Promise((resolve) => {
          p.releaseRead = resolve
        })
      return {
        ok: true,
        kind: 'read',
        page: {
          id: command.id,
          canSend: true,
          activity: p.active ? 'active' : 'idle',
          deliveryUncertain: p.uncertain,
          limited: false,
          hasMore: !command.older,
          messages: [
            ...(!command.older && p.sent[command.source]
              ? [
                  {
                    id: p.sent[command.source].id,
                    role: 'user',
                    text: p.sent[command.source].text,
                    truncated: false,
                  },
                ]
              : []),
            {
              id: command.older ? 'older' : 'latest',
              role: 'assistant',
              text: command.older ? 'Previous history' : p.text,
              truncated: false,
              ...(p.rich && command.source === 'perplexity'
                ? {
                    sources: [
                      {
                        title: 'A source with a long title that wraps within the narrow panel',
                        url: 'https://example.com/source',
                      },
                    ],
                    steps: [
                      { id: 'a', title: 'Check sources', status: 'Incomplete' },
                      { id: 'b', title: 'Compare results', status: 'Complete' },
                    ],
                    followUps: ['Compare the alternatives', 'Explain the assumptions'],
                  }
                : {}),
            },
          ],
        },
      }
    }
  })
  await selectConversationFilter(page, 'chat')
  await selectThreadView(page, 'active')
  const gpt = page.locator('[data-account-chat][data-provider=chatgpt]')
  const pplx = page.locator('[data-account-chat][data-provider=perplexity]')
  await gpt.waitFor()
  await pplx.waitFor()
  await gpt.getByRole('button', { name: /^chatgpt live chat/ }).click()
  const input = gpt.getByRole('textbox', { name: 'Message ChatGPT', exact: true })
  await input.fill('Retained draft')
  assert.equal(
    await input.evaluate(() =>
      localStorage.getItem('account-chat-draft:chatgpt:6aeaea26-2338-83ed-a05f-4a2bb9018ff3'),
    ),
    'Retained draft',
  )
  await gpt.getByRole('button', { name: '\u2191 Load earlier messages', exact: true }).click()
  await gpt.getByText('Previous history', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.replyProof.text = 'Updated while open'
  })
  await page.clock.runFor(2500)
  await gpt.getByText('Updated while open', { exact: true }).waitFor()
  assert.equal(await gpt.getByText('Previous history', { exact: true }).isVisible(), true)
  assert.equal(await input.inputValue(), 'Retained draft')
  await capture('account-chat-live-composer')
  await selectThreadView(page, 'recent')
  if (!(await input.isVisible()))
    await gpt.getByRole('button', { name: /^chatgpt live chat/ }).click()
  await input.waitFor()
  assert.equal(await input.inputValue(), 'Retained draft')
  await gpt.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click()
  await page.waitForFunction(() => window.replyProof.calls.some((c) => c.action === 'send'))
  assert.equal(await input.inputValue(), '')
  assert.equal(
    await input.evaluate(() =>
      localStorage.getItem('account-chat-draft:chatgpt:6aeaea26-2338-83ed-a05f-4a2bb9018ff3'),
    ),
    null,
  )
  await gpt.getByText('Reply to Retained draft', { exact: true }).waitFor()
  assert.equal(await gpt.locator('article').getByText('Retained draft', { exact: true }).count(), 1)
  await input.fill('Keep on failure')
  await page.evaluate(() => {
    window.replyProof.fail = true
  })
  await gpt.getByRole('button', { name: 'Send to ChatGPT', exact: true }).click()
  await gpt.getByRole('button', { name: 'I checked ChatGPT', exact: true }).waitFor()
  assert.equal(await input.inputValue(), 'Keep on failure')
  assert.equal(
    await gpt.getByRole('button', { name: 'Send to ChatGPT', exact: true }).isDisabled(),
    true,
  )
  const count = await page.evaluate(
    () => window.replyProof.calls.filter((c) => c.action === 'send').length,
  )
  await page.clock.runFor(2500)
  assert.equal(
    await page.evaluate(() => window.replyProof.calls.filter((c) => c.action === 'send').length),
    count,
  )
  await capture('account-chat-uncertain-delivery')
  await gpt.getByRole('button', { name: 'I checked ChatGPT', exact: true }).click()
  await page.evaluate(() => {
    window.replyProof.fail = false
  })
  await pplx.getByRole('button', { name: /^perplexity live chat/ }).click()
  const pplxInput = pplx.getByRole('textbox', { name: 'Message Perplexity', exact: true })
  await pplxInput.fill('Perplexity reply')
  await pplx.getByRole('button', { name: 'Send to Perplexity', exact: true }).click()
  await pplx.getByText('Reply to Perplexity reply', { exact: true }).waitFor()
  assert.equal(await pplxInput.inputValue(), '')
  await page.evaluate(() => {
    window.replyProof.rich = true
    window.replyProof.text =
      '**Formatted answer** with [a link](https://example.com/read).\n\n| Option | Detail |\n| --- | --- |\n| First | A_long_value_that_should_stay_inside_the_table_scroll_area |\n\n```js\nconst answer = 42;\n```\n\n[Unsafe](javascript:alert(1)) ![Preview](https://example.com/never-fetch.png)\n\n<script>window.untrustedRan = true</script>'
  })
  await page.clock.runFor(2500)
  await pplx.locator('strong').filter({ hasText: 'Formatted answer' }).waitFor()
  assert.equal(await pplx.locator('img, script, iframe').count(), 0)
  assert.equal(await pplx.locator('a[href^="javascript:"]').count(), 0)
  assert.equal(await page.evaluate(() => window.untrustedRan), undefined)
  assert.equal(await pplx.locator('summary').filter({ hasText: 'Sources · 1' }).count(), 1)
  const steps = pplx
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Steps · 2' }) })
  assert.equal(await steps.getAttribute('open'), null)
  await steps.locator('summary').focus()
  await page.keyboard.press('Enter')
  await steps.getByText('· Incomplete', { exact: true }).waitFor()
  const code = pplx
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /^JavaScript$/ }) })
  assert.equal(await code.getAttribute('open'), '')
  await code.locator('pre').waitFor()
  await code.locator('.hljs-keyword').first().waitFor()
  await code.locator('summary').click()
  const suggestions = pplx
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Follow-ups · 2' }) })
  await suggestions.locator('summary').click()
  const sendsBefore = await page.evaluate(
    () => window.replyProof.calls.filter((c) => c.action === 'send').length,
  )
  await suggestions.getByRole('button', { name: 'Compare the alternatives', exact: true }).click()
  assert.equal(await pplxInput.inputValue(), 'Compare the alternatives')
  assert.equal(await pplxInput.evaluate((el) => document.activeElement === el), true)
  assert.equal(
    await suggestions
      .getByRole('button', { name: 'Explain the assumptions', exact: true })
      .isDisabled(),
    true,
  )
  await page.clock.runFor(2500)
  assert.equal(await steps.getAttribute('open'), '')
  assert.equal(await code.getAttribute('open'), null)
  await code.locator('summary').click()
  assert.equal(await pplxInput.inputValue(), 'Compare the alternatives')
  assert.equal(
    await page.evaluate(() => window.replyProof.calls.filter((c) => c.action === 'send').length),
    sendsBefore,
  )
  const transcript = pplx.getByLabel('Perplexity messages', { exact: true })
  assert.equal(
    await transcript.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
    'rich content stays within narrow transcript',
  )
  await capture('account-chat-rich-content')
  const sources = pplx
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Sources · 1' }) })
  await sources.locator('summary').click()
  const sourceLink = sources.getByRole('link')
  assert.equal(await sourceLink.getAttribute('href'), 'https://example.com/source')
  assert.equal(await sourceLink.getAttribute('target'), '_blank')
  await capture('account-chat-sources')
  // The same formatting component serves ChatGPT; Perplexity-only details must not appear there.
  await gpt.getByRole('button', { name: /^chatgpt live chat/ }).click()
  await gpt.locator('strong').filter({ hasText: 'Formatted answer' }).waitFor()
  await gpt.locator('pre code .hljs-keyword').first().waitFor()
  assert.equal(
    await gpt
      .locator('summary')
      .filter({ hasText: /^Sources|^Steps|^Follow-ups/ })
      .count(),
    0,
  )
  await capture('account-chat-gpt-formatting')
  await pplx.getByRole('button', { name: /^perplexity live chat/ }).click()
  await pplxInput.waitFor()
  assert.equal(
    await pplx.getByRole('button', { name: 'Refresh conversation', exact: true }).count(),
    0,
  )
  const width = await pplx.evaluate((el) => ({
    row: el.getBoundingClientRect().width,
    composer: el.querySelector('[data-shared-composer]').getBoundingClientRect().width,
  }))
  assert.ok(
    width.row - width.composer <= 20,
    'composer uses the thread width without the transcript indent',
  )
  const boundary = pplx.locator('[data-history-boundary]')
  const stableStyle = await boundary.evaluate((el) => ({
    color: getComputedStyle(el).color,
    opacity: getComputedStyle(el).opacity,
  }))
  await page.evaluate(() => {
    window.replyProof.holdLatest = true
  })
  await page.clock.runFor(2500)
  await page.waitForFunction(() => !!window.replyProof.releaseRead)
  assert.equal(await boundary.isDisabled(), false, 'polling does not dim history controls')
  assert.deepEqual(
    await boundary.evaluate((el) => ({
      color: getComputedStyle(el).color,
      opacity: getComputedStyle(el).opacity,
    })),
    stableStyle,
  )
  await boundary.click()
  await pplx.getByRole('button', { name: 'Loading earlier messages…', exact: true }).waitFor()
  await page.evaluate(() => {
    window.replyProof.holdLatest = false
    window.replyProof.releaseRead()
    window.replyProof.releaseRead = null
  })
  await pplx.getByText('Previous history', { exact: true }).waitFor()
  await pplxInput.fill('Delayed delivery while closed')
  await page.evaluate(() => {
    window.replyProof.holdLatest = true
    window.replyProof.delaySend = true
  })
  await page.clock.runFor(2500)
  await page.waitForFunction(() => !!window.replyProof.releaseRead)
  assert.equal(
    await pplx.getByRole('button', { name: 'Send to Perplexity', exact: true }).isDisabled(),
    false,
    'polling does not disable Send',
  )
  const beforeDelayed = await page.evaluate(
    () => window.replyProof.calls.filter((c) => c.action === 'send').length,
  )
  await pplx.getByRole('button', { name: 'Send to Perplexity', exact: true }).click()
  await page.evaluate(() => {
    window.replyProof.holdLatest = false
    window.replyProof.releaseRead()
    window.replyProof.releaseRead = null
  })
  await page.waitForFunction(() => !!window.replyProof.releaseSend)
  await pplx.getByRole('button', { name: /^perplexity live chat/ }).click()
  await pplx.getByRole('button', { name: /^perplexity live chat/ }).click()
  await pplx.getByRole('status').filter({ hasText: 'Sending' }).waitFor()
  await page.evaluate(() => {
    window.replyProof.delaySend = false
    window.replyProof.releaseSend()
  })
  await pplxInput.waitFor()
  await pplx.getByText('Reply to Delayed delivery while closed', { exact: true }).waitFor()
  assert.equal(await pplxInput.inputValue(), '', 'accepted delivery clears a reopened composer')
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem('account-chat-draft:perplexity:6aeae6a2-64f0-83ed-ad71-d54499d93c06'),
    ),
    null,
  )
  assert.equal(
    await page.evaluate(() => window.replyProof.calls.filter((c) => c.action === 'send').length),
    beforeDelayed + 1,
  )
  await pplx.getByRole('button', { name: /^perplexity live chat/ }).click()
  await pplx.getByRole('button', { name: /^perplexity live chat/ }).click()
  await pplxInput.waitFor()
  assert.equal(await pplxInput.inputValue(), '', 'sent draft stays cleared on a later reopen')
  await capture('account-chat-full-width-composer')
  await page.evaluate(() => {
    window.replyProof.active = false
  })
  await page.clock.runFor(6000)
  await selectThreadView(page, 'active')
  assert.equal(await page.locator('[data-account-chat]:visible').count(), 0)
  console.log(
    'PASS: both chat providers in Active, updating open messages with older history/draft retained, shared composers, delivery acknowledgement, uncertain-send recovery and no automatic resend.',
  )
}
