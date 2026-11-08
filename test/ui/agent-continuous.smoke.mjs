/* global window, document, getComputedStyle, requestAnimationFrame */
import assert from 'node:assert/strict'
import { openHeaderPage } from './header-navigation.mjs'

async function checkReaderFade(reader) {
  await reader.evaluate(async (el) => {
    const prior = el.scrollTop
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const check = async (top, faded) => {
      for (let i = 0; i < 30; i++) {
        el.scrollTop = top
        await frame()
        await frame()
        if (
          el.scrollTop === top &&
          getComputedStyle(el).maskImage.includes('linear-gradient') === faded
        )
          return
      }
      throw Error(
        'Reader fade at ' +
          el.scrollTop +
          ' of ' +
          el.scrollHeight +
          ' px: ' +
          getComputedStyle(el).maskImage,
      )
    }
    await check(0, false)
    const height = el.scrollHeight
    await check(12, true)
    if (height !== el.scrollHeight) throw Error('The edge fade consumed transcript space')
    el.scrollTop = prior
    await frame()
  })
}

export async function checkAgentContinuous(page, capture) {
  await page.evaluate(async () => {
    // The main Agent API has no project draft adapters. The generic test proxy
    // otherwise synthesizes functions for these optional properties.
    for (const key of [
      'readDraft',
      'writeDraft',
      'readDraftSelection',
      'writeDraftSelection',
      'historyCurrentId',
    ])
      window.threadlight[key] = undefined
    await window.threadlight.updateSettings({ agentProvider: 'codex', panelLayout: 'single' })
    window.proof.groupedCards = []
    window.proof.groupedItems = [
      { id: 'q1', kind: 'you', text: 'First request' },
      { id: 'a1', kind: 'agent', text: 'The first result is ready.' },
      {
        id: 'live:original',
        kind: 'you',
        text: 'Review the proposal',
        liveComplete: true,
        liveAfter: 'a1',
      },
      {
        id: 'q2',
        backingTurnId: 'voice-turn',
        kind: 'you',
        text: '<threadlight-app-state>{"private":"orientation"}</threadlight-app-state>\n<realtime_delegation><input>Review the proposal</input><transcript_delta>user: Earlier question</transcript_delta></realtime_delegation>',
      },
      { id: 'step1', kind: 'step', text: 'Read the proposal' },
      ...['repeat-1', 'repeat-2'].map((id) => ({
        id,
        kind: 'you',
        backingTurnId: 'voice-turn',
        text: '<realtime_delegation><input>Review the proposal</input><transcript_delta>user: Review the proposal</transcript_delta></realtime_delegation>',
      })),
      { id: 'step2', kind: 'step', text: 'Compared three approaches' },
      {
        id: 'a2',
        kind: 'agent',
        text: '### Recommendation\n\nThe last confirmed code is `def main():`. A **readable** reply 🙂 with a [safe link](https://example.com/docs) and an [unsafe link](javascript:alert(1)).\n\n```python\ndef main():\n    print("hello")\n```\n\n| Approach | Result |\n| --- | --- |\n| A long unbroken column value | Kept inside the panel |\n\n![Example](https://example.com/image.png)\n\n<script>window.bad=true</script>',
      },
    ]
    const lead =
      'I can see this file: you said the server was restarted and the editor reconnected, and I confirmed the connection.'
    const heard =
      'In this file, I see you said the server was restarted and the editor was reconnected, and then I confirmed the connection.'
    const readout = lead + '\n\nIf you open the example again, I can continue from there.'
    window.proof.groupedItems.push(
      { id: 'written-example', kind: 'agent', text: readout, backingTurnId: 'example-turn' },
      {
        id: 'live:example-lead',
        kind: 'agent',
        text: heard,
        liveComplete: true,
        narrationOf: {
          sessionId: 'example-session',
          turnId: 'example-turn',
          itemId: 'written-example',
          excerpt: lead,
        },
      },
      {
        id: 'live:example-caption',
        kind: 'agent',
        text: 'If you open the example again, I’ll continue from there.',
        liveComplete: true,
        narrationOf: {
          sessionId: 'example-session',
          turnId: 'example-turn',
          itemId: 'written-example',
          tailAfter: lead,
        },
      },
      {
        id: 'live:separate-refusal',
        kind: 'agent',
        text: 'I cannot approve that change.',
        liveComplete: true,
      },
    )
    const original = window.threadlight.communicationRequest
    window.threadlight.communicationRequest = async (input) => {
      if (input.action === 'conversation_feed')
        return {
          ok: true,
          value: { owner: input.arguments.owner, cards: window.proof.groupedCards, cursor: 1 },
        }
      if (input.action === 'conversation_answer') {
        window.proof.calls.push(['group-answer', input.arguments])
        window.proof.groupedCards = window.proof.groupedCards.map((c) =>
          c.id === input.arguments.cardId
            ? { ...c, state: 'answered-here', recordedAnswer: 'Allowed' }
            : c,
        )
        window.proof.emit('onCommunication')
        return { ok: true }
      }
      if (input.action === 'conversation_open') {
        window.proof.calls.push(['group-open', input.arguments])
        return { ok: true, value: 'local_source' }
      }
      return original(input)
    }
    window.threadlight.agentHistory = async () => [
      {
        id: 'codex:group-history',
        provider: 'codex',
        title: 'Older grouped conversation',
        at: Date.now(),
      },
    ]
    window.threadlight.agentReadPage = async (_id, cursor) =>
      cursor
        ? {
            items: [
              { id: 'previous', kind: 'you', text: 'Older historical request' },
              ...[1, 2, 3].map((n) => ({
                id: 'settings-' + n,
                kind: 'step',
                text: 'Update settings ' + n,
              })),
            ],
            cursor: null,
          }
        : {
            items: [
              { id: 'q1', kind: 'you', text: 'First request' },
              { id: 'a1', kind: 'agent', text: 'Saved earlier answer.' },
              ...window.proof.groupedItems
                .slice(2)
                .map((item) =>
                  item.id === 'live:example-lead'
                    ? { ...item, text: item.text.slice(0, 14), liveComplete: false }
                    : item,
                ),
              { id: 'q3', kind: 'you', text: 'Third historical request' },
              {
                id: 'history-code',
                kind: 'agent',
                text:
                  '```python\n' +
                  Array.from({ length: 80 }, (_, i) => `value_${i} = ${i}`).join('\n') +
                  '\n```',
              },
            ],
            cursor: 'previous-page',
          }
    window.proof.agent({
      provider: 'codex',
      model: 'future-fast',
      status: 'ready',
      ended: false,
      conversationId: 'codex:group-ui',
      recent: {
        id: 'codex:group-ui',
        provider: 'codex',
        at: Date.now(),
        waiting: true,
        summary: 'Which approach should we try?',
      },
      sessionId: 'group-native',
      requests: [],
      items: window.proof.groupedItems,
    })
  })
  const diamond = page.getByRole('button', { name: 'Agent is waiting for your answer' })
  await diamond.waitFor()
  assert.equal(await diamond.count(), 1)
  assert.equal(await diamond.getAttribute('data-awaiting'), 'true')
  assert.equal(
    await diamond.evaluate((el) => el.nextElementSibling?.getAttribute('aria-label')),
    'Settings',
  )
  const recentMark = diamond.locator('svg')
  assert.ok(await recentMark.evaluate((el) => getComputedStyle(el).filter.includes('drop-shadow')))
  assert.equal(await recentMark.locator('path').getAttribute('fill-rule'), 'evenodd')
  assert.match(await recentMark.locator('path').getAttribute('d'), /^M8 .5C/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await recentMark.evaluate((el) => getComputedStyle(el).animationName), 'none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await capture('agent-question-diamond')
  await diamond.click()
  const chat = page.locator('[data-agent-conversation]')
  const first = chat,
    second = chat
  assert.equal(await chat.locator('[data-agent-turn]').count(), 0)
  await chat.getByText('The first result is ready.', { exact: true }).waitFor()
  async function checkSpokenDetails() {
    const answer = chat.locator('[data-message-id="written-example"]')
    await answer.locator('summary').press('Enter')
    assert.ok(
      await answer
        .getByText('If you open the example again, I’ll continue from there.', { exact: true })
        .isVisible(),
    )
    assert.equal(await chat.locator('[data-message-id="live:example-caption"]').count(), 0)
    assert.equal(await chat.locator('[data-message-id="live:separate-refusal"]').count(), 1)
    await answer.locator('summary').press('Enter')
  }
  const prefixRows = await page.evaluate(async () => {
    const original = window.proof.groupedItems
    const caption = original.find((i) => i.id === 'live:example-lead')
    let extra = 0
    for (let i = 1; i <= caption.text.length; i++) {
      const text = caption.text.slice(0, i)
      window.proof.agent({
        items: original.map((item) =>
          item === caption ? { ...item, text, liveComplete: false } : item,
        ),
      })
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      if (
        document.querySelector('[data-message-id="live:example-lead"]') ||
        document.querySelector('[data-message-id="written-example"] details p')?.textContent !==
          text
      )
        extra++
    }
    window.proof.agent({ items: original })
    return extra
  })
  assert.equal(
    prefixRows,
    0,
    'every plausible streamed prefix stays inspectable under its written answer',
  )
  await checkSpokenDetails()
  const audio = chat.getByText('Audio received', { exact: true })
  const records = chat.locator('[data-message-id="live:original"] pre')
  assert.equal(await records.count(), 3)
  assert.equal(await chat.getByText('Review the proposal', { exact: true }).count(), 1)
  const raw = records.first()
  assert.equal(await raw.isVisible(), false)
  await audio.press('Enter')
  assert.ok((await raw.innerText()).includes('transcript_delta'))
  await raw.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
  })
  await audio.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'copy').at(-1)[1]),
    await raw.innerText(),
  )
  await audio.press('Enter')
  assert.equal(await raw.isVisible(), false)
  assert.equal(await chat.getByText(/private.*orientation/).count(), 0)
  await second.getByRole('heading', { name: 'Recommendation', exact: true }).waitFor()
  assert.equal(
    await second
      .locator('strong')
      .filter({ hasText: /^readable$/ })
      .count(),
    1,
  )
  assert.equal(
    await second.getByRole('link', { name: /safe link/ }).getAttribute('href'),
    'https://example.com/docs',
  )
  assert.equal(await second.locator('a[href^="javascript:"]').count(), 0)
  assert.equal(await second.locator('img,script').count(), 0)
  await second
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Compared three approaches' }) })
    .locator('summary')
    .click()
  await second.getByText('Read the proposal', { exact: true }).waitFor()
  await second
    .locator('summary')
    .filter({ hasText: /^Python$/ })
    .waitFor()
  const inline = second.locator('p > code').filter({ hasText: 'def main():' })
  assert.equal(await inline.textContent(), 'def main():')
  assert.notEqual(
    await inline.evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)',
  )
  await second.locator('pre code .hljs-keyword').first().waitFor()
  const copyCode = second.getByRole('button', { name: 'Copy code', exact: true })
  assert.equal(await copyCode.innerText(), '')
  assert.equal(await copyCode.locator('svg rect').count(), 1)
  const copyBox = await copyCode.boundingBox()
  assert.ok(copyBox.width >= 22 && copyBox.height >= 20)
  await copyCode.press('Enter')
  await second.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'copy').at(-1)[1]),
    'def main():\n    print("hello")\n',
  )
  // Older Agent replies can omit a provider message ID. Keep identical fences at distinct positions.
  await page.evaluate(() => {
    const reply = { kind: 'agent', text: '```python filename="sample.py"\nprint(1)\n```' }
    window.proof.agent({ items: [...window.proof.groupedItems, reply, reply] })
  })
  const twins = second.locator('summary').filter({ hasText: 'sample.py' })
  for (const i of [0, 1]) {
    await twins.nth(i).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  }
  const pins = page.getByRole('region', { name: 'Pinned code' })
  assert.equal(await pins.locator('summary').count(), 2)
  const sources = await pins
    .locator('summary')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-description')))
  assert.notEqual(sources[0], sources[1])
  const grip = chat.getByRole('separator', { name: 'Resize Agent reading area' })
  const reader = chat.locator('[class*="agentLog"]')
  const width = (await chat.boundingBox()).width
  async function checkCompactTail(historical = false) {
    const boxes = await grip.evaluate((el) => {
      const agent = el.closest('[data-agent-conversation]')
      const log = agent.querySelector('[class*="agentLog"]')
      const last =
        agent.querySelector('[class*="readerUpdates"]') ||
        agent.querySelector('[id="foreground-agent-composer"]') ||
        log
      const rect = (node) => node.getBoundingClientRect()
      return {
        width: rect(agent).width,
        grip: rect(el).height,
        below: rect(agent).bottom - rect(last).bottom,
        tail: rect(agent).bottom - rect(el).bottom,
      }
    })
    assert.ok(boxes.width <= 238 && boxes.grip >= 12 && boxes.tail <= 5, JSON.stringify(boxes))
    assert.ok(boxes.below <= (historical ? 26 : 18), JSON.stringify(boxes))
    console.log('Agent reader geometry', JSON.stringify(boxes))
  }
  const proseStyle = await second
    .locator('[data-kind="agent"] p')
    .first()
    .evaluate(async (el) => {
      const css = getComputedStyle(el)
      return [
        css.fontFamily,
        css.fontWeight,
        css.fontSize,
        css.lineHeight,
        css.letterSpacing,
        css.color,
      ]
    })
  assert.deepEqual(proseStyle, [
    '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    '400',
    '12px',
    '17.4px',
    'normal',
    'rgb(250, 250, 250)',
  ])
  await checkCompactTail()
  await grip.press('Home')
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('[aria-label="Resize Agent reading area"]')
          .getAttribute('aria-valuenow'),
      ) === 72,
  )
  await checkReaderFade(reader)
  const joint = await grip.boundingBox()
  assert.equal(await chat.getByRole('group', { name: 'Agent settings' }).count(), 0)
  assert.equal(await chat.getByRole('button', { name: /^Earlier/ }).count(), 0)
  assert.ok(joint.width >= 14)
  await page.mouse.move(joint.x + joint.width / 2, joint.y + joint.height / 2)
  await page.mouse.down()
  await page.mouse.move(joint.x + joint.width / 2, joint.y + joint.height / 2 + 36, { steps: 3 })
  await page.mouse.up()
  assert.ok((await reader.boundingBox()).height > 92, 'drag expands just the reader')
  await grip.press('End')
  await grip.press('ArrowDown')
  const chosen = await page.evaluate(() =>
    Number(localStorage.getItem('threadlight.agent-reading-height')),
  )
  assert.ok(chosen >= 72 && chosen <= Number(await grip.getAttribute('aria-valuemax')))
  assert.equal((await chat.boundingBox()).width, width)
  assert.equal(await pins.locator('summary').count(), 2)
  await page.evaluate(() =>
    window.proof.emit('onPanelOpened', { fresh: false, opensDown: false, maxHeight: 820 }),
  )
  await grip.locator('xpath=self::*[@data-upward]').waitFor()
  await grip.press('Home')
  await page.waitForTimeout(150)
  const beforeUp = await reader.boundingBox()
  const bottomGrip = await grip.boundingBox()
  await page.mouse.move(bottomGrip.x + bottomGrip.width / 2, bottomGrip.y + bottomGrip.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    bottomGrip.x + bottomGrip.width / 2,
    bottomGrip.y + bottomGrip.height / 2 - 30,
    { steps: 3 },
  )
  await page.mouse.up()
  const maxUp = Number(await grip.getAttribute('aria-valuemax'))
  const afterUp = (await reader.boundingBox()).height
  assert.ok(
    Math.abs(afterUp - Math.min(maxUp, beforeUp.height + 30)) <= 2,
    JSON.stringify({
      maxUp,
      before: beforeUp.height,
      afterUp,
      saved: await reader.evaluate((el) => el.style.height),
      bottomGrip,
    }),
  )
  await grip.press('End')
  await page.evaluate(() =>
    window.proof.emit('onPanelOpened', { fresh: false, opensDown: false, maxHeight: 410 }),
  )
  await page.waitForFunction(() => document.querySelector('[data-card]').offsetHeight <= 410)
  const layout = await grip.evaluate((el) => {
    const box = (n) => [n.className, n.offsetHeight, Math.round(n.getBoundingClientRect().top)]
    const agent = el.closest('[data-agent-conversation]')
    const rect = el.getBoundingClientRect()
    return {
      grip: box(el),
      siblings: [...agent.children].map(box),
      agent: box(agent),
      pin: box(document.querySelector('[aria-label="Pinned code"]')),
      hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === el,
    }
  })
  assert.ok(layout.hit, JSON.stringify(layout))
  await capture('agent-reader-grip')
  const cardBox = await page.locator('[data-card]').first().boundingBox()
  assert.ok(cardBox.height <= 411)
  assert.ok(
    (await grip.boundingBox()).y + (await grip.boundingBox()).height <=
      cardBox.y + cardBox.height + 1,
  )
  await grip.press('Home')
  for (const i of [1, 0]) await pins.getByRole('button', { name: 'Unpin code' }).nth(i).click()
  await page.evaluate(() => window.proof.agent({ items: window.proof.groupedItems }))
  const input = chat.getByRole('textbox', { name: 'Message to Agent', exact: true })
  assert.equal(await input.count(), 0, 'no empty follow-up strip')
  const bar = chat.getByRole('group', { name: 'Agent conversation controls' })
  const reply = bar.getByRole('button', { name: 'Reply to Agent' })
  const edges = await bar
    .locator('button:visible')
    .evaluateAll((nodes) => [
      nodes[0].getBoundingClientRect().left,
      nodes.at(-1).getBoundingClientRect().right,
    ])
  const row = await bar.boundingBox()
  assert.ok(Math.abs((edges[0] + edges[1]) / 2 - (row.x + row.width / 2)) <= 1)
  assert.equal((await reply.innerText()).trim(), '')
  assert.equal(await reply.locator('svg').count(), 1)
  assert.equal(await bar.getByRole('button', { name: 'Start Agent voice' }).count(), 1)
  assert.ok((await bar.boundingBox()).y < (await reader.boundingBox()).y)
  await reply.press('Enter')
  assert.equal(
    await input.evaluate(
      (el) => el === document.activeElement && !!el.closest('[data-composer-input]'),
    ),
    true,
  )
  assert.ok(
    (await input.boundingBox()).y >=
      (await reader.boundingBox()).y + (await reader.boundingBox()).height - 1,
  )
  await checkCompactTail()
  await input.press('Escape')
  assert.equal(await input.count(), 0)
  assert.equal(await reply.evaluate((el) => el === document.activeElement), true)
  await reply.press('Space')
  await input.fill('Preserved draft')
  await reply.click()
  assert.equal(await input.count(), 0)
  assert.equal(await reply.getAttribute('aria-expanded'), 'false')
  await reply.press('Enter')
  assert.equal(await input.inputValue(), 'Preserved draft')
  await reader.evaluate((el) => {
    el.scrollTop = 10
  })
  const scroll = await reader.evaluate((el) => el.scrollTop)
  await grip.press('ArrowUp')
  assert.equal(await reader.evaluate((el) => el.scrollTop), scroll)
  assert.equal(await input.inputValue(), 'Preserved draft')
  const sample = await reader.evaluate((el) => {
    const code = el.querySelector('[data-message-id="a2"] pre code')
    el.scrollTop += code.getBoundingClientRect().top - el.getBoundingClientRect().top - 6
    el.dispatchEvent(new Event('scroll'))
    return code.getBoundingClientRect().top - el.getBoundingClientRect().top
  })
  await page.evaluate(() => {
    window.proof.groupedCards = [
      {
        id: 'group-decision',
        revision: 1,
        kind: 'native',
        source: 'codex:group-native',
        state: 'pending',
        title: 'Start Perplexity chat',
        body: 'Opening message',
        anchor: 'pending-approval-on-earlier-page',
        afterLiveItem: 'live:original',
        request: {
          id: 'request',
          generation: 'one',
          target: 'codex:group-native',
          kind: 'approval',
          nativeKind: 'approval',
          title: 'Start Perplexity chat',
          detail:
            'Space: Design review\nRole: Research\n\nOpening message:\nCompare the approaches.',
          startedAt: Date.now(),
          expiresAt: Date.now() + 60000,
          canAllow: true,
        },
      },
    ]
    for (const n of [1, 2, 3]) {
      const card = window.proof.groupedCards[0]
      window.proof.groupedCards.push({
        ...card,
        id: 'old-settings-' + n,
        anchor: 'settings-' + n,
        afterLiveItem: n === 1 ? 'live:original' : undefined,
        state: 'answered-here',
        recordedAnswer: 'Allowed',
        request: { ...card.request, id: 'old-request-' + n, title: 'Update settings ' + n },
      })
    }
    window.proof.emit('onCommunication')
  })
  await first.getByRole('button', { name: 'Allow once', exact: true }).waitFor()
  const follows = async (before, after) =>
    chat.evaluate(
      (el, [a, b]) =>
        !!(
          el.querySelector(a).compareDocumentPosition(el.querySelector(b)) &
          window.Node.DOCUMENT_POSITION_FOLLOWING
        ),
      [before, after],
    )
  assert.ok(await follows('[data-message-id="a2"]', '[data-card-id="group-decision"]'))
  assert.ok(await follows('[data-card-id="old-settings-1"]', '[data-message-id="a2"]'))
  assert.equal(await first.getByText('Saved cards (2)', { exact: true }).count(), 1)
  await page.evaluate(() => window.proof.emit('onCommunication'))
  assert.equal(await first.locator('[data-card-id^="old-settings-"]').count(), 3)
  assert.equal(
    await first
      .locator('[data-card-id^="old-settings-"] button')
      .filter({ hasText: 'Allow once' })
      .count(),
    0,
  )
  const linePosition = () =>
    reader.evaluate(
      (el) =>
        el.querySelector('[data-message-id="a2"] pre code').getBoundingClientRect().top -
        el.getBoundingClientRect().top,
    )
  assert.ok(Math.abs((await linePosition()) - sample) < 2, 'pending card preserves the source line')
  await chat.getByRole('button', { name: 'Needs input', exact: true }).click()
  assert.equal(
    await first.getByRole('button', { name: 'Answer through Agent', exact: true }).count(),
    0,
  )
  assert.equal(await input.inputValue(), 'Preserved draft')
  await capture('agent-continuous-pending')
  await first.getByRole('button', { name: 'Allow once', exact: true }).click()
  assert.deepEqual(
    await page.evaluate(
      () => window.proof.calls.filter((c) => c[0] === 'group-answer').at(-1)[1].response,
    ),
    { action: 'allow' },
  )
  await first
    .locator('[data-card-id="group-decision"][data-card-state="answered-here"]')
    .waitFor({ state: 'attached' })
  assert.ok(await follows('[data-card-id="group-decision"]', '[data-message-id="a2"]'))
  // New turns and partial replies leave the preceding messages accessible.
  await page.evaluate(() =>
    window.proof.agent({
      items: [
        ...window.proof.groupedItems,
        { id: 'q3', kind: 'you', text: 'A follow-up request' },
        { id: 'a3', kind: 'agent', text: 'A follow-up result.' },
      ],
    }),
  )
  await second.getByText('A follow-up result.', { exact: true }).waitFor()
  await chat.getByText('The first result is ready.', { exact: true }).waitFor()
  await page.evaluate(() =>
    window.proof.agent({
      items: [
        ...window.proof.groupedItems,
        { id: 'q3', kind: 'you', text: 'A follow-up request' },
        { id: 'a3', kind: 'agent', text: 'An updated follow-up result.' },
      ],
    }),
  )
  assert.equal(await chat.locator('[data-agent-turn]').count(), 0)
  assert.equal(await input.inputValue(), 'Preserved draft')
  const code = second.locator('[data-message-id="a2"] pre code')
  await reader.evaluate((el) => {
    const node = el.querySelector('[data-message-id="a2"] code')
    el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - 5
    el.dispatchEvent(new Event('scroll'))
  })
  const held = await linePosition()
  await page.evaluate(() => {
    const items = [
      ...window.proof.groupedItems,
      { id: 'late-input', kind: 'you', text: 'Next spoken question' },
      { id: 'live:direct', kind: 'agent', text: 'A direct partial reply' },
      { id: 'tool-active', kind: 'step', text: 'Editor context · completed' },
    ]
    window.proof.agent({
      status: 'working',
      progress: 'Editor context received · Agent working',
      items,
      requests: [],
      approval: null,
    })
  })
  await chat
    .getByRole('status', { name: 'Current Agent work' })
    .getByText('Editor context received · Agent working')
    .waitFor()
  await chat
    .getByText('Editor context · completed', { exact: true })
    .first()
    .waitFor({ state: 'attached' })
  const mark = chat.getByRole('img', { name: 'Agent working' })
  await mark.waitFor()
  assert.ok(
    await mark.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return (
        r.top >= 0 &&
        r.bottom <= window.innerHeight &&
        !el.closest('[aria-label="Conversation messages"]')
      )
    }),
  )
  assert.equal(
    await chat
      .getByRole('status', { name: 'Current Agent work' })
      .getByRole('img', { name: 'Agent working' })
      .count(),
    1,
  )
  assert.ok(
    Math.abs((await linePosition()) - held) <= 2,
    'work and a new voice request preserve the visible code',
  )
  await chat.getByRole('button', { name: /New updates/ }).click()
  assert.ok(await reader.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 2))
  await page.evaluate(() =>
    window.proof.agent({ status: 'ready', items: window.proof.groupedItems }),
  )
  await mark.waitFor({ state: 'detached' })
  await code.scrollIntoViewIfNeeded()
  await second.locator('[data-message-id="a2"] pre').focus()
  await code.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const s = window.getSelection()
    s.removeAllRanges()
    s.addRange(range)
  })
  const selectedCode = await page.evaluate(() => window.getSelection().toString())
  assert.ok(selectedCode.includes('def main():\n    print("hello")'))
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: 'Text actions', exact: true })
  await menu.waitFor()
  await page.evaluate(() => window.getSelection().removeAllRanges())
  await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'copy').at(-1)[1]),
    selectedCode,
  )
  await capture('agent-continuous-reply')
  // Historical pending cards remain readable but cannot answer an old request.
  await page.evaluate(() => {
    window.proof.groupedCards = window.proof.groupedCards.map((c) =>
      c.id === 'group-decision' ? { ...c, state: 'pending', recordedAnswer: undefined } : c,
    )
    window.proof.emit('onCommunication')
  })
  await page.getByRole('button', { name: 'Agent settings', exact: true }).click()
  await page.getByRole('button', { name: /^Earlier ·/ }).click()
  await page.getByRole('button', { name: /Older grouped conversation/ }).click()
  await chat.getByText('Saved earlier answer.', { exact: true }).waitFor()
  await checkCompactTail(true)
  await grip.press('Home')
  await checkReaderFade(reader)
  assert.equal(await chat.getByRole('button', { name: 'Allow once', exact: true }).count(), 0)
  await chat.locator('[data-message-id="history-code"] code').waitFor()
  await chat.getByText('Audio received', { exact: true }).press('Enter')
  await checkSpokenDetails()
  assert.equal(
    await chat.locator('[data-message-id="live:example-lead"]').count(),
    0,
    'a partial caption keeps its original row in Earlier',
  )
  const historicalRecords = chat.locator('[data-message-id="live:original"] pre')
  assert.equal(await historicalRecords.count(), 3)
  assert.ok(await historicalRecords.first().isVisible())
  await chat.getByRole('button', { name: 'Load earlier messages' }).click()
  await chat.getByText('Older historical request', { exact: true }).waitFor()
  assert.equal(await chat.getByText('Saved cards (2)', { exact: true }).count(), 0)
  assert.equal(await chat.locator('[data-card-id^="old-settings-"]').count(), 3)
  for (const n of [1, 2, 3]) {
    const card = chat.locator(`[data-card-id="old-settings-${n}"]`)
    assert.equal(await card.getByText('Allowed', { exact: true }).count(), 1)
    assert.ok(
      await card.evaluate(
        (el, n) => el.previousElementSibling?.textContent.includes('Update settings ' + n),
        n,
      ),
    )
  }
  assert.ok(await follows('[data-card-id="old-settings-3"]', '[data-message-id="a1"]'))
  assert.ok(await historicalRecords.first().isVisible())
  assert.equal(await chat.locator('[data-agent-turn]').count(), 0)
  await chat.getByRole('button', { name: 'Back', exact: true }).click()
  assert.equal(await input.inputValue(), 'Preserved draft')
  const card = first.locator('[data-card-id="group-decision"]')
  await card.locator(':scope > details > summary').click()
  await card.getByRole('button', { name: 'Open source chat', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.proof.calls.filter((c) => c[0] === 'group-open').at(-1)[1].cardId,
    ),
    'group-decision',
  )
  assert.equal(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'agentSend').length),
    0,
  )
  assert.ok(
    await chat.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    await chat.evaluate((el) =>
      JSON.stringify({
        width: el.clientWidth,
        overflow: el.scrollWidth,
        nodes: [...el.querySelectorAll('*')]
          .filter((n) => n.getBoundingClientRect().right > el.getBoundingClientRect().right)
          .slice(-12)
          .map((n) => [n.tagName, n.className, n.textContent.slice(0, 28)]),
      }),
    ),
  )
  await page.evaluate(() => {
    window.threadlight.finishCallChat = async (id, choice) => {
      window.proof.calls.push(['fresh-control', id, choice])
      window.proof.agent({ conversationId: null, sessionId: null, items: [], status: 'idle' })
      return { ok: true }
    }
  })
  await chat.getByRole('button', { name: 'Start fresh', exact: true }).click()
  assert.equal(await input.count(), 0)
  await reply.press('Enter')
  assert.equal(await input.inputValue(), 'Preserved draft')
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'fresh-control')),
    [['fresh-control', 'codex:group-ui', 'fresh']],
  )
  assert.equal(await chat.locator('[data-agent-turn]').count(), 0)
  await page.evaluate(() => {
    window.threadlight.agentResume = async (id) => {
      window.proof.calls.push(['resume-recent', id])
      window.proof.agent({
        status: 'ready',
        ended: false,
        conversationId: id,
        items: [{ kind: 'agent', text: 'Which approach should we try?' }],
      })
      return { ok: true }
    }
  })
  await page
    .locator('header[aria-label="Panel header"]')
    .getByRole('button', { name: 'Back to sessions' })
    .click()
  await diamond.click()
  await chat.getByText('Which approach should we try?', { exact: true }).last().waitFor()
  assert.deepEqual(
    await page.evaluate(() => window.proof.calls.filter((c) => c[0] === 'resume-recent')),
    [['resume-recent', 'codex:group-ui']],
  )
  const saved = await page.evaluate(() =>
    Number(localStorage.getItem('threadlight.agent-reading-height')),
  )
  await page.reload()
  await openHeaderPage(page, 'Agent')
  await page.getByRole('separator', { name: 'Resize Agent reading area' }).waitFor()
  assert.equal(
    await chat.locator('[class*="agentLog"]').evaluate((n) => n.style.height),
    saved + 'px',
  )
  console.log(
    'PASS: persistent footer sizing, continuous messages, three answered cards in history, off-page pending approval, older-page placement, source line and draft retention, historical safety and source routing; no live provider sends.',
  )
}
