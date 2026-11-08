/* global window, document, getComputedStyle */
import assert from 'node:assert/strict'
import { selectThreadView, selectConversationFilter } from './header-navigation.mjs'

export async function checkAccountChats(page, capture) {
  const install = () => {
    const caller = '01a18a38-bbc1-7e70-9374-10f945d6a372'
    const ids = {
      chatgpt: '6aeaea26-2338-83ed-a05f-4a2bb9018ff3',
      perplexity: '6aeae6a2-64f0-83ed-ad71-d54499d93c06',
    }
    window.chatProof = { calls: [], empty: false, fail: false, wait: false, release: null }
    window.threadlight.accountChats = async (command) => {
      const p = window.chatProof
      p.calls.push(command)
      if (p.wait)
        await new Promise((resolve) => {
          p.release = resolve
        })
      if (p.fail) return { ok: false, reason: 'Desktop connection interrupted. Refresh to retry.' }
      if (command.action === 'contexts')
        return {
          ok: true,
          kind: 'contexts',
          contexts: [{ id: caller, title: 'Existing Codex context' }],
        }
      if (command.action === 'disconnect') return { ok: true, kind: 'disconnected' }
      if (command.action === 'list')
        return {
          ok: true,
          kind: 'list',
          chats:
            p.empty || command.more
              ? []
              : [
                  {
                    id: ids[command.source],
                    title: `${command.source} conversation ` + 'long title '.repeat(30),
                    updatedAt: Date.now() - (command.source === 'perplexity' ? 7200000 : 0),
                    ...(p.active && command.source === 'chatgpt' ? { activity: 'active' } : {}),
                  },
                ],
          hasMore: command.source === 'chatgpt' && !command.more && !p.empty,
          recentOnly: command.source === 'perplexity',
        }
      return {
        ok: true,
        kind: 'read',
        page: {
          id: command.id,
          hasMore: !command.older,
          limited: true,
          messages: [
            {
              id: command.older ? 'old-u' : 'new-u',
              role: 'user',
              text: command.older ? 'Earlier question' : 'Latest question',
              truncated: false,
            },
            {
              id: command.older ? 'old-a' : 'new-a',
              role: 'assistant',
              text: command.older
                ? 'Earlier reply'
                : '<script>window.chatExecuted=true</script>\n' + 'Long reply text '.repeat(180),
              truncated: !command.older,
            },
          ],
        },
      }
    }
  }
  await page.addInitScript(install)
  await page.reload()
  await page.evaluate(() =>
    window.threadlight.updateSettings({ enabledProviders: ['claude', 'codex'] }),
  )
  const filter = page.locator('header [data-thread-filter]')
  await selectConversationFilter(page, 'all')
  await page.waitForFunction(
    () => window.chatProof.calls.filter((c) => c.action === 'list').length === 2,
  )
  const rows = page.locator('[data-account-chat]')
  assert.equal(await rows.count(), 0, 'unknown activity does not appear as active')
  assert.equal(await page.locator('[data-chat-source]').count(), 0, 'no provider cards')
  assert.equal(await page.locator('[data-account-chats] summary').count(), 0)
  await capture('account-chats-active-empty')
  await selectThreadView(page, 'workspace')
  assert.equal(await rows.count(), 0, 'unscoped account chats do not appear in a workspace')
  await capture('account-chats-workspace-empty')
  await selectThreadView(page, 'recent')
  await rows.nth(1).waitFor()
  const gpt = page.locator('[data-account-chat][data-provider=chatgpt]')
  const pplx = page.locator('[data-account-chat][data-provider=perplexity]')
  assert.equal(await rows.count(), 2)
  const feedRows = page.locator(
    '[data-merged-recent] > [data-account-chat]:visible, [data-merged-recent] > [data-session-id]:visible',
  )
  assert.deepEqual(
    await feedRows.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute('data-provider')),
    ),
    ['chatgpt', 'codex', 'claude', 'perplexity'],
  )
  assert.match(await gpt.innerText(), /ChatGPT ·/)
  await page.evaluate(() => window.threadlight.updateSettings({ maxSessions: 3 }))
  await pplx.waitFor({ state: 'hidden' })
  assert.equal(await feedRows.count(), 3, 'one limit across coding and account chats')
  await page.evaluate(() => window.threadlight.updateSettings({ maxSessions: 10 }))
  await pplx.waitFor()
  assert.equal(await rows.locator('[data-git-tracker], [data-diff-coverage], textarea').count(), 0)
  assert.equal(await page.getByRole('combobox', { name: 'Codex context for ChatGPT' }).count(), 0)
  await capture('account-chats-compact-rows')
  await page.evaluate(() => {
    window.chatProof.fail = true
  })
  await page.clock.fastForward(66000)
  await page.locator('[data-provider-errors]').waitFor()
  assert.equal(await gpt.isVisible(), true, 'failed discovery keeps the last known chat')
  await page.evaluate(() => {
    window.chatProof.fail = false
  })
  await page.clock.fastForward(66000)
  await page.locator('[data-provider-errors]').waitFor({ state: 'detached' })
  const row = gpt.getByRole('button', { name: /^chatgpt conversation/ })
  await row.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menu', { name: 'ChatGPT chat menu', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await row.evaluate((el) => el === document.activeElement), true)
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Load older chats', exact: true }).click()
  await page.waitForFunction(() =>
    window.chatProof.calls.some((c) => c.action === 'list' && c.more),
  )
  await row.click({ button: 'right' })
  assert.equal(
    await page.getByRole('menuitem', { name: 'Load older chats', exact: true }).count(),
    0,
  )
  await page.keyboard.press('Escape')
  await row.focus()
  await page.keyboard.press('Enter')
  await gpt.getByText('Latest question', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.chatExecuted), undefined)
  await gpt.getByRole('button', { name: '\u2191 Load earlier messages', exact: true }).click()
  await gpt.getByText('Earlier question', { exact: true }).waitFor()
  assert.deepEqual((await gpt.locator('article p').allTextContents()).slice(0, 3), [
    'Earlier question',
    'Earlier reply',
    'Latest question',
  ])
  await capture('account-chats-history')
  await selectConversationFilter(page, 'code-computer')
  await gpt.waitFor({ state: 'hidden' })
  assert.equal(await gpt.isVisible(), false)
  await selectConversationFilter(page, 'all')
  await gpt.waitFor({ state: 'visible' })
  assert.equal(await gpt.getByText('Earlier question', { exact: true }).isVisible(), true)
  const perplexityRow = pplx.getByRole('button', { name: /^perplexity conversation/ })
  const callsBeforeMenu = await page.evaluate(() => window.chatProof.calls.length)
  await perplexityRow.click({ button: 'right' })
  const chatMenu = page.getByRole('menu', { name: 'Perplexity chat menu', exact: true })
  await chatMenu.waitFor()
  assert.deepEqual(await chatMenu.getByRole('menuitem').allTextContents(), [
    'Read conversation',
    'Refresh conversation',
    'Dual view',
  ])
  assert.equal(
    await page.evaluate(() => window.chatProof.calls.length),
    callsBeforeMenu,
    'opening a context menu does not read or send',
  )
  await capture('account-chat-context-menu')
  await page.keyboard.press('Escape')
  assert.equal(await perplexityRow.evaluate((el) => el === document.activeElement), true)
  await page.keyboard.press('Shift+F10')
  await chatMenu.getByRole('menuitem', { name: 'Read conversation', exact: true }).click()
  await pplx.getByText('Latest question', { exact: true }).waitFor()
  await perplexityRow.click({ button: 'right' })
  await chatMenu.getByRole('menuitem', { name: 'Close conversation', exact: true }).click()
  await pplx.getByRole('region', { name: 'Perplexity conversation' }).waitFor({ state: 'hidden' })
  await perplexityRow.click({ button: 'right' })
  await chatMenu.getByRole('menuitem', { name: 'Refresh conversation', exact: true }).click()
  await pplx.getByText('Latest question', { exact: true }).waitFor()
  const dimensions = await pplx.evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    background: getComputedStyle(el).backgroundColor,
    tint: getComputedStyle(el).getPropertyValue('--provider-tint').trim(),
  }))
  assert.ok(dimensions.width < 300)
  assert.ok(dimensions.content <= dimensions.width + 1)
  assert.notEqual(dimensions.background, 'rgb(255, 255, 255)')
  assert.equal(dimensions.tint, '#80bdc8')
  await capture('account-chats-conversation')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const readCount = () =>
    page.evaluate(() => window.chatProof.calls.filter((c) => c.action === 'read').length)
  const beforeHidden = await readCount()
  await page.clock.fastForward(10000)
  assert.equal(await readCount(), beforeHidden, 'a retained reader does not poll behind Settings')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await pplx.getByText('Latest question', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.chatProof.wait = true
  })
  await perplexityRow.click({ button: 'right' })
  await chatMenu.getByRole('menuitem', { name: 'Refresh conversation', exact: true }).click()
  await pplx.getByRole('status').filter({ hasText: 'Reading' }).waitFor()
  assert.equal(await pplx.getByRole('button', { name: 'Refresh conversation' }).count(), 0)
  await capture('account-chats-busy')
  await page.evaluate(() => {
    window.chatProof.wait = false
    window.chatProof.release()
  })
  await pplx.getByText('Latest question', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.chatProof.fail = true
  })
  await perplexityRow.click({ button: 'right' })
  await chatMenu.getByRole('menuitem', { name: 'Refresh conversation', exact: true }).click()
  await pplx.getByRole('alert').waitFor()
  assert.equal(await pplx.locator('article').count(), 0)
  await capture('account-chats-error')
  await page.evaluate(() => {
    window.chatProof.fail = false
  })
  await perplexityRow.click({ button: 'right' })
  await chatMenu.getByRole('menuitem', { name: 'Refresh conversation', exact: true }).click()
  await pplx.getByText('Latest question', { exact: true }).waitFor()
  await pplx.getByRole('button', { name: /^perplexity conversation/ }).click()
  // Explicitly reported activity appears; unknown activity remains hidden.
  await page.evaluate(() => {
    window.chatProof.active = true
  })
  await page.clock.fastForward(66000)
  await selectThreadView(page, 'active')
  await gpt.waitFor()
  assert.equal(await rows.count(), 1)
  await capture('account-chats-reported-active')
  await page.evaluate(() => {
    window.chatProof.empty = true
    window.chatProof.active = false
  })
  await page.clock.fastForward(66000)
  await selectThreadView(page, 'recent')
  await rows.first().waitFor({ state: 'hidden' })
  assert.equal(await rows.count(), 0)
  assert.equal(await page.locator('[data-account-chats] summary').count(), 0)
  await capture('account-chats-empty')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  assert.equal(await page.locator('[data-account-chat-settings]').count(), 0)
  assert.equal(await page.locator('[data-chat-connection-error]').count(), 0)
  await capture('account-chats-settings')
  await page.evaluate(() => {
    window.chatProof.empty = false
    window.chatProof.fail = true
  })
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.clock.fastForward(66000)
  await page.locator('[data-provider-errors]').waitFor()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Retry ChatGPT connection', exact: true }).waitFor()
  await capture('account-chats-settings-error')
  await page.evaluate(() => {
    window.chatProof.fail = false
  })
  await page.getByRole('button', { name: 'Retry ChatGPT connection', exact: true }).click()
  await page.getByRole('button', { name: 'Retry Perplexity connection', exact: true }).click()
  await page.locator('[data-chat-connection-error]').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await selectConversationFilter(page, 'chat')
  await page.getByRole('button', { name: 'Filter applications: Chat apps' }).click()
  await page.getByRole('menuitem', { name: 'Perplexity', exact: true }).click()
  await gpt.waitFor({ state: 'hidden' })
  await pplx.waitFor()
  assert.equal(await gpt.count(), 0)
  await page.reload()
  await filter.waitFor()
  assert.equal(await filter.getAttribute('data-thread-filter'), 'chat')
  await selectThreadView(page, 'recent')
  await pplx.waitFor()
  assert.equal(await gpt.count(), 0)
  await capture('account-chats-saved-filter')
  assert.ok(
    (await page.evaluate(() => window.chatProof.calls)).every((c) =>
      ['contexts', 'disconnect', 'list', 'read'].includes(c.action),
    ),
  )
  console.log(
    'PASS: compact account rows, filters, provider colours, read-only history, contextual older-chat loading, keyboard, retained navigation, busy/error/retry and error-only Settings recovery (synthetic IPC).',
  )
}
