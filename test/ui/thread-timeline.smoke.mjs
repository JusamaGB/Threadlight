import { checkComposerAttachments } from './composer-attachments.smoke.mjs'
import { checkThreadImages } from './thread-images.smoke.mjs'
/* global window, document */
import assert from 'node:assert/strict'
import { setupVoiceInput } from './voice-input.fixture.mjs'
import { checkSmartThreadFooter } from './smart-thread-footer.smoke.mjs'
import { checkUserMessagePreview } from './user-message-preview.smoke.mjs'
import { checkStackedDiff } from './stacked-diff.smoke.mjs'
import { checkMessageArtifacts } from './message-artifacts.smoke.mjs'
import { checkSmartThreadScroll } from './smart-thread-scroll.smoke.mjs'
import { openHeaderPage } from './header-navigation.mjs'

export async function checkThreadTimeline(page, capture) {
  await page.evaluate(async () => {
    await window.threadlight.updateSettings({
      enabledProviders: ['claude', 'codex'],
      panelLayout: 'dual',
      listMode: 'recent',
    })
    await window.proof.patch({
      state: 'working',
      attention: null,
      plan: [],
      planText: null,
      lastAction: 'Checking the refresh flow',
    })
    const items = Array.from({ length: 24 }, (_, i) => ({
      id: `native-${i}`,
      role: i % 3 === 0 ? 'user' : 'assistant',
      kind: 'message',
      text:
        i % 3 === 0
          ? `Request ${i}: keep the loaded result visible during refresh.`
          : `Update ${i}: the previous result stays visible while the next refresh is in progress.`,
      phase: i % 3 === 0 ? 'request' : 'progress',
      at: 1793196000000 + i * 60_000,
      turnId: `turn-${Math.floor(i / 3)}`,
      complete: true,
      source: 'codex_stream',
    }))
    items.push({
      id: 'tool',
      role: 'activity',
      kind: 'tool',
      text: 'Ran npm test',
      activity: 'command',
      detail: 'npm test\nExit code: 0',
      phase: 'progress',
      at: null,
      turnId: 'turn-current',
      complete: true,
      source: 'codex_stream',
    })
    items.push({
      ...items.at(-1),
      id: 'tool-second',
      text: 'Ran npm run typecheck',
      detail: 'npm run typecheck\nExit code: 0',
    })
    items.push({
      id: 'streaming',
      role: 'assistant',
      kind: 'message',
      text: 'Checking',
      phase: 'progress',
      at: null,
      turnId: 'turn-current',
      complete: false,
      source: 'codex_stream',
    })
    window.proof.timeline = {
      revision: 1,
      threadId: '',
      connection: 'live',
      items,
      hasMore: true,
      loadingOlder: false,
    }
    window.proof.timelineUpdate = (patch) => {
      window.proof.timeline = {
        ...window.proof.timeline,
        ...patch,
        revision: window.proof.timeline.revision + 1,
      }
      window.proof.emit('onThreadTimeline', window.proof.timeline)
    }
    window.threadlight.threadTimeline = async (input) => {
      window.proof.calls.push(['timeline', input])
      window.proof.timeline.threadId = input.threadId
      if (input.action === 'older') {
        window.proof.timelineUpdate({
          items: [
            { ...items[0], id: 'earlier', text: 'An earlier request from native history.' },
            ...window.proof.timeline.items,
          ],
          hasMore: false,
        })
      }
      return { ok: true, timeline: structuredClone(window.proof.timeline) }
    }
  })
  const row = page.locator('[data-session-id^="codex:"]').first()
  const toggle = row.getByRole('button', { name: /Synthetic Codex/ }).first()
  const stage = row.locator('[class*="_stage_"]').first()
  await page.evaluate(() => window.proof.patch({ state: 'working' }))
  await stage.getByText('Checking', { exact: true }).waitFor()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  await page.evaluate(() =>
    window.proof.timelineUpdate({
      items: window.proof.timeline.items.map((item) =>
        item.id === 'streaming'
          ? {
              ...item,
              role: 'activity',
              kind: 'tool',
              activity: 'status',
              text: 'Updating smoke tests',
            }
          : item,
      ),
    }),
  )
  await stage.getByText('Updating smoke tests', { exact: true }).waitFor()
  await page.evaluate(
    (id) =>
      window.proof.emit('onRelays', [
        {
          sessionId: id,
          state: 'sent',
          detail: '',
          at: Date.now(),
        },
      ]),
    await row.getAttribute('data-session-id'),
  )
  await stage.getByText('Updating smoke tests', { exact: true }).waitFor()
  await page.evaluate(() => window.proof.patch({ compacting: true, stage: 'Compacting context' }))
  await stage.getByText('Compacting context', { exact: true }).waitFor()
  await page.evaluate(() => window.proof.patch({ compacting: false, stage: 'Older saved summary' }))
  await stage.getByText('Updating smoke tests', { exact: true }).waitFor()
  await capture('thread-row-live-tool')
  await page.evaluate(() =>
    window.proof.timelineUpdate({
      items: window.proof.timeline.items.map((item) =>
        item.id === 'streaming'
          ? { ...item, role: 'assistant', kind: 'message', activity: undefined, text: 'Checking' }
          : item,
      ),
    }),
  )
  await stage.getByText('Checking', { exact: true }).waitFor()
  assert.equal(
    await row.getByRole('region', { name: 'Codex conversation', exact: true }).count(),
    0,
  )
  await page.evaluate(() => window.proof.emit('onPanelPeek', true))
  const peek = page.getByRole('region', { name: 'Temporary Active threads' })
  await peek.waitFor()
  assert.equal(await peek.getByText('✓ Sent · waiting for a reply', { exact: true }).count(), 0)
  await page.evaluate(() => window.proof.emit('onPanelPeek', false))
  await peek.waitFor({ state: 'detached' })
  await toggle.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compose', exact: true }).click()
  const dock = page.getByRole('group', { name: 'Codex message composer' })
  const originalInputClass = await dock.getByRole('textbox').getAttribute('class')
  const originalPill = await dock.locator('[class*="_pill_"]').boundingBox()
  const originalComposerWidth = (await dock.boundingBox()).width
  await toggle.click()
  const conversation = row.getByRole('region', { name: 'Codex conversation', exact: true })
  assert.equal(
    await conversation.getByText('Codex · Local', { exact: true }).count(),
    0,
    'smart threads do not repeat provider/workspace metadata above their history',
  )
  const history = conversation.getByRole('region', { name: 'Conversation history', exact: true })
  const composer = conversation.getByRole('group', { name: 'Codex message composer' })
  const input = composer.getByRole('textbox')
  await input.waitFor()
  const compactPill = await composer.locator('[class*="_pill_"]').boundingBox()
  assert.ok(compactPill.height < originalPill.height, 'the smart thread composer is thinner')
  assert.ok(
    (await composer.boundingBox()).width - compactPill.width <
      originalComposerWidth - originalPill.width,
    'the smart thread composer uses more of its column width',
  )
  assert.ok(compactPill.height >= 28 && compactPill.height < 30, 'the default pill is thinner')
  assert.ok(
    (await row.boundingBox()).width - compactPill.width <= 6,
    'the pill uses nearly the full thread column',
  )
  const plusBox = await composer
    .getByRole('button', { name: 'Attach files', exact: true })
    .boundingBox()
  const micBox = await composer.getByRole('button', { name: 'Talk', exact: true }).boundingBox()
  const textBox = await input.boundingBox()
  const centerY = (box) => box.y + box.height / 2
  assert.ok(Math.abs(centerY(plusBox) - centerY(micBox)) < 1, 'plus and microphone controls align')
  assert.ok(Math.abs(centerY(plusBox) - centerY(textBox)) < 1, 'plus aligns with the input line')
  await capture('smart-thread-compact-composer')
  await checkUserMessagePreview(page, conversation, composer, capture)
  await checkSmartThreadFooter(page, conversation, history, composer, capture)
  await checkSmartThreadScroll(page, conversation, history, composer)
  for (const state of ['sending', 'sent', 'replied']) {
    await page.evaluate(
      ({ state, id }) =>
        window.proof.emit('onRelays', [
          {
            sessionId: id,
            state,
            detail: 'Synthetic reply received',
            at: Date.now(),
          },
        ]),
      { state, id: await row.getAttribute('data-session-id') },
    )
    await stage.getByText('Checking', { exact: true }).waitFor()
    assert.equal(
      await conversation.locator('[class*="_pending_"]').count(),
      0,
      `${state} needs no duplicate delivery line in the live conversation`,
    )
    assert.equal(
      await conversation.getByText('✓ Sent · waiting for a reply', { exact: true }).count(),
      0,
    )
  }
  await page.evaluate(
    (id) =>
      window.proof.emit('onRelays', [
        {
          sessionId: id,
          state: 'failed',
          detail: 'Synthetic delivery failed.',
          at: Date.now(),
        },
      ]),
    await row.getAttribute('data-session-id'),
  )
  await conversation.getByRole('alert').filter({ hasText: 'Synthetic delivery failed.' }).waitFor()
  await stage.getByText('Synthetic delivery failed.', { exact: true }).waitFor()
  await page.evaluate(() => window.proof.emit('onRelays', []))
  await conversation.getByRole('alert').waitFor({ state: 'detached' })
  await stage.getByText('Checking', { exact: true }).waitFor()
  assert.equal(
    await conversation.getByText('Live', { exact: true }).count(),
    0,
    'no duplicate live status row',
  )
  assert.equal(
    await conversation.getByText('Checking', { exact: true }).count(),
    1,
    'activity appears once in the conversation',
  )
  assert.equal(await input.getAttribute('class'), originalInputClass)
  assert.equal(await composer.getByText('Synthetic Codex', { exact: true }).count(), 0)
  assert.equal(
    await composer.getByRole('button', { name: 'Close composer', exact: true }).count(),
    0,
  )
  assert.equal(await composer.evaluate((el) => window.getComputedStyle(el).backgroundImage), 'none')
  assert.equal(await composer.getByRole('button', { name: 'Talk', exact: true }).count(), 1)
  await page.waitForFunction(
    () => document.querySelectorAll('[aria-label="Codex message composer"]').length === 1,
  )
  await toggle.click({ button: 'right' })
  await page.getByRole('menu').waitFor()
  assert.equal(await page.getByRole('menuitem', { name: 'Compose', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  const liveHeight = (await conversation.boundingBox()).height
  const liveHistoryHeight = (await history.boundingBox()).height
  const liveComposerHeight = (await composer.boundingBox()).height
  await input.fill('Retained inline draft')
  await page.waitForTimeout(100)
  assert.ok(await history.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 25))
  await history.evaluate((el) => {
    el.scrollTop = 100
    el.dispatchEvent(new Event('scroll'))
  })
  await conversation.getByText('Reading history', { exact: true }).waitFor()
  assert.equal(await composer.isVisible(), false)
  assert.ok(
    Math.abs((await conversation.boundingBox()).height - liveHeight) < 1,
    'history keeps the card height',
  )
  const readingBarHeight = (await conversation.locator('[class*="_follow_"]').boundingBox()).height
  assert.ok(
    Math.abs(
      (await history.boundingBox()).height -
        liveHistoryHeight -
        (liveComposerHeight - readingBarHeight),
    ) < 1,
    'history fills the space freed by hiding the composer',
  )
  const initialTop = await history.evaluate((el) => el.scrollTop)
  await page.evaluate(() => {
    window.proof.messageNode = document.querySelector('[data-message-id="streaming"]')
    window.proof.timelineUpdate({
      items: window.proof.timeline.items.map((item) =>
        item.id === 'streaming'
          ? { ...item, text: 'Checking the cursor and the repeated refresh.' }
          : item,
      ),
    })
  })
  await conversation.getByRole('button', { name: '↓ 1 new · Live', exact: true }).waitFor()
  assert.equal(await history.evaluate((el) => el.scrollTop), initialTop)
  assert.equal(
    await page.evaluate(
      () => window.proof.messageNode === document.querySelector('[data-message-id="streaming"]'),
    ),
    true,
  )
  assert.equal(await conversation.locator('[data-message-id="streaming"]').count(), 1)
  await capture('thread-timeline-reading')
  await conversation.getByRole('button', { name: '↓ 1 new · Live', exact: true }).click()
  await input.waitFor()
  assert.equal(await input.inputValue(), 'Retained inline draft')
  assert.ok(await history.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 25))
  const group = conversation.locator('details[data-message-id="tool"]')
  await group.locator(':scope > summary').filter({ hasText: 'Ran commands' }).click()
  await group
    .locator('summary')
    .filter({ hasText: /^Ran npm test$/ })
    .click()
  await conversation.locator('pre').filter({ hasText: 'npm test' }).waitFor()
  const retained = await history.textContent()
  await page.evaluate(() =>
    window.proof.timelineUpdate({
      connection: 'reconnecting',
      notice: 'Connection lost. Showing last received messages.',
    }),
  )
  await conversation
    .getByRole('status')
    .filter({ hasText: 'Connection lost. Showing last received messages.' })
    .waitFor()
  assert.equal(await history.textContent(), retained)
  await page.evaluate(() => window.proof.timelineUpdate({ connection: 'live', notice: undefined }))
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Codex conversation"]')
        ?.getAttribute('data-connection') === 'live',
  )
  await history.evaluate((el) => {
    el.scrollTop = 140
    el.dispatchEvent(new Event('scroll'))
  })
  const topBefore = await history.evaluate((el) => el.scrollTop)
  await toggle.click()
  await toggle.click()
  await conversation.waitFor()
  await page.waitForTimeout(100)
  assert.equal(await history.evaluate((el) => el.scrollTop), topBefore)
  await history.evaluate((el) => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  await conversation.getByRole('button', { name: '↑ Load earlier messages', exact: true }).click()
  await conversation.getByText('An earlier request from native history.', { exact: true }).waitFor()
  assert.equal(await conversation.getByRole('button', { name: /new · Live/ }).count(), 0)
  await conversation.getByRole('button', { name: '↓ Jump to live', exact: true }).click()
  if ((await group.getAttribute('open')) !== null) await group.locator(':scope > summary').click()
  await page.evaluate(() => {
    const base = window.proof.timeline.items.find((i) => i.id === 'tool')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items,
        {
          ...base,
          id: 'compact',
          activity: 'compaction',
          text: 'Context automatically compacted',
          detail: undefined,
        },
        {
          ...base,
          id: 'active-heading',
          activity: 'status',
          text: 'Updating caret visibility',
          detail: undefined,
          complete: false,
        },
      ],
    })
  })
  const active = conversation.locator('details[data-message-id="active-heading"]')
  await active
    .locator(':scope > summary')
    .filter({ hasText: 'Updating caret visibility' })
    .waitFor()
  await active.locator(':scope > summary').click()
  await page.evaluate(() => {
    const base = window.proof.timeline.items.find((i) => i.id === 'tool')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items.map((i) =>
          i.id === 'active-heading' ? { ...i, complete: true } : i,
        ),
        {
          ...base,
          id: 'inspect',
          activity: 'tool',
          text: 'Inspect Threadlight activity',
          detail: 'node_repl · js\ninProgress',
          complete: false,
        },
      ],
    })
  })
  await active
    .locator(':scope > summary')
    .filter({ hasText: 'Inspect Threadlight activity' })
    .waitFor()
  assert.equal(await active.getAttribute('open'), '')
  await active
    .locator('summary')
    .filter({ hasText: /^Inspect Threadlight activity$/ })
    .last()
    .click()
  await conversation.getByText('node_repl · js', { exact: false }).waitFor()
  await capture('thread-timeline-expanded-activity')
  await active.locator(':scope > summary').click()
  await capture('thread-timeline-live')
  await page.evaluate(() => {
    const base = window.proof.timeline.items.find((i) => i.id === 'tool')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items.map((i) => ({ ...i, complete: true })),
        {
          ...base,
          id: 'long-command',
          complete: false,
          text: 'Running powershell.exe -NoProfile -Command Get-Content src/renderer/panel/ThreadConversation.tsx',
          detail: 'Current command output',
        },
      ],
    })
  })
  const commandSummary = active.locator(':scope > summary')
  await commandSummary.filter({ hasText: /^Running command/ }).waitFor()
  assert.ok((await commandSummary.boundingBox()).height < 25, 'active command stays on one line')
  const shimmer = commandSummary.locator('span').first()
  assert.notEqual(await shimmer.evaluate((el) => window.getComputedStyle(el).animationName), 'none')
  await capture('thread-command-compact')
  await commandSummary.click()
  await active
    .getByText(
      'Running powershell.exe -NoProfile -Command Get-Content src/renderer/panel/ThreadConversation.tsx',
      { exact: true },
    )
    .waitFor()
  await capture('thread-command-expanded')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await shimmer.evaluate((el) => window.getComputedStyle(el).animationName), 'none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() =>
    window.proof.timelineUpdate({
      items: window.proof.timeline.items.map((i) => ({ ...i, complete: true })),
    }),
  )
  await page.waitForFunction(
    () => document.querySelector('[data-message-id="active-heading"]').dataset.active === 'false',
  )
  assert.equal(await shimmer.evaluate((el) => window.getComputedStyle(el).animationName), 'none')
  await commandSummary.click()
  await page.evaluate(() => {
    const base = window.proof.timeline.items.find((i) => i.id === 'tool')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items,
        {
          ...base,
          id: 'edit-event',
          activity: 'files',
          text: 'Edited 2 files',
          fileCount: 2,
          detail: undefined,
          fileChanges: [
            {
              path: 'src/renderer/panel/AgentView.tsx',
              added: 0,
              removed: 3,
              diff: '@@ -1,3 +1,0 @@\n-one\n-two\n-three\n',
            },
            {
              path: 'src/renderer/panel/Panel.module.css',
              added: 1,
              removed: 12,
              diff: '@@ -1,12 +1,1 @@\n-old\n+new\n',
            },
          ],
        },
      ],
    })
  })
  const edits = conversation.locator('[data-message-id="edit-event"]')
  await edits.getByText('Edited 2 files', { exact: true }).waitFor()
  assert.equal(
    await edits.getByText('src/renderer/panel/AgentView.tsx', { exact: true }).count(),
    0,
  )
  assert.equal(await edits.locator('ul, pre').count(), 0, 'edit cards show their header only')
  assert.equal(await edits.locator('header').getByText('+1', { exact: true }).count(), 1)
  assert.equal(await edits.locator('header').getByText('−15', { exact: true }).count(), 1)
  await capture('thread-file-changes')
  await page.evaluate(() => {
    window.proof.savedCardDiffReaders = {}
    window.proof.cardDiffReads = []
    for (const method of [
      'getChanges',
      'getWorktreeChanges',
      'getFileDiff',
      'getWorktreeFileDiff',
    ]) {
      window.proof.savedCardDiffReaders[method] = window.threadlight[method]
      window.threadlight[method] = async (...args) => {
        window.proof.cardDiffReads.push([method, ...args])
        throw Error('Card changes must use recorded event evidence')
      }
    }
  })
  await edits.getByRole('button', { name: 'View changes', exact: true }).click()
  const cardChanges = page.getByRole('region', { name: 'Card changes', exact: true })
  await cardChanges.waitFor()
  await page.locator('header').getByText('Card changes · 2 files', { exact: true }).waitFor()
  await cardChanges.getByRole('button', { name: /AgentView/ }).click()
  await cardChanges.getByText('one', { exact: true }).waitFor()
  assert.equal(await cardChanges.getByText('new', { exact: true }).count(), 0)
  await cardChanges.getByRole('button', { name: /Panel.module.css/ }).click()
  await cardChanges.getByText('new', { exact: true }).waitFor()
  await capture('thread-file-changes-expanded')
  await page.evaluate(async () => {
    // In-place changes in the feed cannot rewrite the already-opened card snapshot.
    const file = window.proof.timeline.items.find((item) => item.id === 'edit-event').fileChanges[1]
    file.added = 2
    file.diff = '@@ -1 +1 @@\n-new\n+later update to the same card\n'
    window.proof.timelineUpdate({
      items: [...window.proof.timeline.items],
    })
    await window.proof.patch({})
  })
  await cardChanges.getByText('new', { exact: true }).waitFor()
  assert.equal(
    await cardChanges.getByText('later update to the same card', { exact: true }).count(),
    0,
  )
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await conversation.waitFor()
  await edits.locator('header').getByText('+2', { exact: true }).waitFor()
  assert.equal(await edits.locator('pre').count(), 0)
  assert.equal(await conversation.locator('[data-message-id="edit-event"]').count(), 1)
  await page.evaluate(() => {
    const event = window.proof.timeline.items.find((i) => i.id === 'edit-event')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items,
        {
          ...event,
          id: 'edit-event-next',
          text: 'Edited 1 file',
          fileCount: 1,
          fileChanges: [
            {
              ...event.fileChanges[0],
              added: 4,
              removed: 1,
              diff: '@@ -1 +1 @@\n-one\n+later card edit only\n',
            },
          ],
        },
      ],
    })
  })
  await conversation
    .locator('[data-message-id="edit-event-next"]')
    .getByText('Edited 1 file', { exact: true })
    .waitFor()
  assert.equal(await edits.locator('header').getByText('+2', { exact: true }).count(), 1)
  await conversation
    .locator('[data-message-id="edit-event-next"]')
    .getByRole('button', { name: 'View changes', exact: true })
    .click()
  await page.locator('header').getByText('Card changes · 1 file', { exact: true }).waitFor()
  assert.equal(
    await cardChanges.getByRole('button', { name: /Panel.module.css/ }).count(),
    0,
    'a later card must not include files from earlier cards',
  )
  await cardChanges.getByRole('button', { name: /AgentView/ }).click()
  await cardChanges.getByText('later card edit only', { exact: true }).waitFor()
  assert.equal(
    await cardChanges.getByText('two', { exact: true }).count(),
    0,
    "the same filename uses only this card's patch",
  )
  await capture('card-changes-later-edit')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.evaluate(() => {
    const event = window.proof.timeline.items.find((item) => item.id === 'edit-event-next')
    window.proof.timelineUpdate({
      items: [
        ...window.proof.timeline.items,
        {
          ...event,
          id: 'missing-card-patch',
          fileChanges: [{ path: 'missing.txt', added: null, removed: null }],
        },
      ],
    })
  })
  await conversation
    .locator('[data-message-id="missing-card-patch"]')
    .getByRole('button', { name: 'View changes', exact: true })
    .click()
  await cardChanges.getByRole('button', { name: /missing.txt/ }).click()
  await cardChanges.getByText('Diff unavailable for this edit.', { exact: true }).waitFor()
  assert.deepEqual(
    await page.evaluate(() => window.proof.cardDiffReads),
    [],
    'card diffs never read thread totals, worktree diffs or current file contents',
  )
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.evaluate(() => {
    Object.assign(window.threadlight, window.proof.savedCardDiffReaders)
  })
  await checkStackedDiff(page, conversation, capture)

  await input.waitFor()
  assert.equal(await input.inputValue(), 'Retained inline draft')
  await page.evaluate(() => {
    window.threadlight.sendMessage = async (...args) => {
      window.proof.calls.push(['inline-send', ...args])
      return new Promise((resolve) => {
        window.proof.finishInlineSend = resolve
      })
    }
  })
  await input.fill('First line')
  await input.press('End')
  await input.press('Shift+Enter')
  await input.press('x')
  assert.equal(await input.inputValue(), 'First line\nx')
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
  })
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'inline-send').length),
    0,
  )
  await input.press('Enter')
  await page.waitForFunction(() => typeof window.proof.finishInlineSend === 'function')
  await input.press('Enter')
  assert.equal(
    await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).isDisabled(),
    true,
  )
  const sent = await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'inline-send'))
  assert.equal(sent.length, 1)
  assert.equal(sent[0][1], await row.getAttribute('data-session-id'))
  assert.equal(sent[0][2], 'First line\nx')
  await page.evaluate(() => {
    window.proof.finishInlineSend({ ok: false, reason: 'Provider unavailable. Draft retained.' })
    delete window.proof.finishInlineSend
  })
  await composer.getByText('Provider unavailable. Draft retained.', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), 'First line\nx')
  await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).click()
  await page.waitForFunction(() => typeof window.proof.finishInlineSend === 'function')
  await input.fill('A new draft while sending')
  await page.evaluate(() => {
    window.proof.finishInlineSend({ ok: true })
    delete window.proof.finishInlineSend
  })
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[aria-label="Codex message composer"] button:is([aria-label="Send"], [aria-label="Queue message"])',
      )?.disabled,
  )
  assert.equal(await input.inputValue(), 'A new draft while sending')
  await capture('thread-composer-live')
  await history.evaluate((el) => {
    el.scrollTop = 100
    el.dispatchEvent(new Event('scroll'))
  })
  await conversation.getByText('Reading history', { exact: true }).waitFor()
  assert.equal(await composer.isVisible(), false)
  await toggle.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compose', exact: true }).waitFor()
  await capture('thread-composer-history')
  await page.getByRole('menuitem', { name: 'Compose', exact: true }).click()
  await input.waitFor()
  assert.equal(await input.inputValue(), 'A new draft while sending')
  await page.waitForFunction(
    () => document.activeElement === document.querySelector('[data-embedded] textarea'),
  )
  assert.ok(await history.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 25))
  assert.equal(await page.getByRole('group', { name: 'Codex message composer' }).count(), 1)
  await input.press('Enter')
  await page.waitForFunction(() => typeof window.proof.finishInlineSend === 'function')
  await page.evaluate(() => {
    window.proof.finishInlineSend({ ok: true })
    delete window.proof.finishInlineSend
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Codex message composer"] textarea')?.value === '',
  )
  assert.equal(await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).count(), 0)
  await setupVoiceInput(page)
  await page.evaluate(() =>
    window.threadlight.updateSettings({ voiceTarget: 'agent', talkMode: 'hold' }),
  )
  await composer.getByRole('button', { name: 'Talk', exact: true }).click()
  await composer.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor()
  await composer.getByRole('img', { name: 'Listening...', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Voice waveform', exact: true }).count(), 0)
  assert.equal(await page.getByRole('region', { name: 'Voice activity', exact: true }).count(), 0)
  await capture('thread-composer-local-listening')
  await composer.getByRole('button', { name: 'Stop and transcribe', exact: true }).click()
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  assert.equal(await page.getByRole('region', { name: 'Voice activity', exact: true }).count(), 0)
  await page.evaluate(() => window.proof.finishTranscript('Dictated into this thread'))
  await page.waitForFunction(
    () => document.querySelector('[data-embedded] textarea')?.value === 'Dictated into this thread',
  )
  const beforeDictation = await page.evaluate(
    () => window.proof.calls.filter((call) => call[0] === 'inline-send').length,
  )
  await page.evaluate(() => {
    delete window.proof.finishTranscript
  })
  await composer.getByRole('button', { name: 'Talk', exact: true }).click()
  await composer.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor()
  await openHeaderPage(page, 'Agent')
  const agentPresence = page.getByRole('region', { name: 'Voice activity', exact: true })
  await agentPresence.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
  assert.doesNotMatch(await agentPresence.innerText(), /Dictated into this thread/)
  await capture('agent-idle-during-thread-dictation')
  await page.waitForFunction(() => window.proof.motion.mode === 'listening')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await composer.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Voice waveform', exact: true }).count(), 0)
  assert.equal(await page.getByRole('region', { name: 'Voice activity', exact: true }).count(), 0)
  assert.equal(await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).count(), 0)
  await input.press('Enter')
  assert.equal(
    await page.evaluate(
      () => window.proof.calls.filter((call) => call[0] === 'inline-send').length,
    ),
    beforeDictation,
  )
  await composer.getByRole('button', { name: 'Stop and transcribe', exact: true }).click()
  await page.waitForFunction(() => typeof window.proof.finishTranscript === 'function')
  assert.equal(await composer.getByRole('button', { name: /^(Send|Queue message)$/ }).count(), 0)
  await input.press('Enter')
  assert.equal(
    await page.evaluate(
      () => window.proof.calls.filter((call) => call[0] === 'inline-send').length,
    ),
    beforeDictation,
  )
  await page.evaluate(() => window.proof.finishTranscript('Ready for review.'))
  const reviewedTranscript = 'Dictated into this thread Ready for review.'
  await page.waitForFunction(
    (text) => document.querySelector('[data-embedded] textarea')?.value === text,
    reviewedTranscript,
  )
  const reviewedSend = composer.getByRole('button', { name: /^(Send|Queue message)$/ })
  await reviewedSend.waitFor()
  assert.equal(await reviewedSend.isDisabled(), false)
  await page.clock.fastForward(6000)
  assert.equal(
    await page.evaluate(
      () => window.proof.calls.filter((call) => call[0] === 'inline-send').length,
    ),
    beforeDictation,
    'completed dictation stays available for review without sending automatically',
  )
  await reviewedSend.click()
  await page.waitForFunction(() => typeof window.proof.finishInlineSend === 'function')
  const dictatedSend = await page.evaluate(() =>
    window.proof.calls.filter((call) => call[0] === 'inline-send').at(-1),
  )
  assert.equal(dictatedSend[2], reviewedTranscript)
  await page.evaluate(() => {
    window.proof.finishInlineSend({ ok: true })
    delete window.proof.finishInlineSend
  })
  await page.waitForFunction(() => document.querySelector('[data-embedded] textarea')?.value === '')
  await input.fill(reviewedTranscript)
  console.log(
    'PASS: full-width thin composer, aligned plus/mic, recording/transcription send lock, and explicit reviewed dictation send.',
  )
  await capture('thread-composer-shared-style')
  await history.evaluate((el) => {
    el.scrollTop = 100
    el.dispatchEvent(new Event('scroll'))
  })
  await conversation.getByText('Reading history', { exact: true }).waitFor()
  await toggle.click()
  await toggle.click()
  await conversation.getByText('Reading history', { exact: true }).waitFor()
  assert.equal(await composer.isVisible(), false)
  await toggle.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compose', exact: true }).click()
  await input.waitFor()
  assert.equal(await input.inputValue(), reviewedTranscript)

  await toggle.click()
  await toggle.click()
  assert.equal(
    await page.evaluate(
      () =>
        window.proof.calls.filter((call) => call[0] === 'timeline' && call[1].action === 'open')
          .length,
    ),
    1,
    'working row and expanded card share one feed before page navigation',
  )
  await checkThreadImages(page, conversation, capture)
  await checkMessageArtifacts(page, conversation, capture)
  await checkComposerAttachments(page, conversation, toggle, capture)
  await toggle.click()
  await page.evaluate(() => window.proof.patch({ state: 'idle', stage: 'Completed reply' }))
  await row.locator('svg[data-unread]').waitFor()
  const calls = await page.evaluate(() =>
    window.proof.calls.filter((call) => call[0] === 'timeline').map((call) => call[1]),
  )
  const opens = calls.filter((call) => call.action === 'open')
  const closes = calls.filter((call) => call.action === 'close')
  assert.equal(
    closes.length,
    opens.length,
    'every feed opened across artifact navigation closes when work finishes',
  )
  assert.deepEqual(
    closes.map((call) => call.subscriptionId).sort(),
    opens.map((call) => call.subscriptionId).sort(),
  )
  assert.equal(new Set(opens.map((call) => call.subscriptionId)).size, opens.length)
}
