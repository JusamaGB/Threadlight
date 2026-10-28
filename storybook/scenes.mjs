/* global window */
// The tour, scene by scene. Each scene sets the app up with the tools in run.mjs and returns
// the frames it photographed. `beat` is what the viewer should take from the shot and
// `seconds` is its share of the film (see docs/video/threadlight-tour-storyboard.md).
const agentConversation = [
  {
    kind: 'you',
    text: 'Tell the checkout thread to hold off, and have Codex re-run the e2e suite first.',
  },
  { kind: 'step', text: 'Read thread: Fix checkout race condition' },
  { kind: 'step', text: 'Read thread: Fix the flaky checkout e2e test' },
  {
    kind: 'agent',
    text: 'Two messages are ready. One tells the checkout thread to wait for the e2e run. One asks Codex to run the suite ten times. Hold both, or send?',
  },
]

export const SCENES = [
  {
    id: '01-dot',
    title: 'The dot',
    beat: 'A small swirl on the corner of the screen. It moves while any thread works.',
    seconds: 3,
    async run({ page, wait, base }) {
      const shots = []
      await page.setViewportSize({ width: 120, height: 120 })
      await page.goto(base + '?view=dot')
      await wait(900)
      const shoot = async (id) => {
        const box = await page.locator('#root > div').first().boundingBox()
        await page.screenshot({
          path: `${(await import('node:url')).fileURLToPath(new URL('./frames/', import.meta.url))}${id}.png`,
          clip: { x: 0, y: 0, width: 56, height: 56 },
        })
        shots.push({ file: `${id}.png`, width: 56 * 2, height: 56 * 2, box })
      }
      await shoot('01-dot-idle')
      await page.evaluate(() =>
        window.story.emit('onMotion', {
          mode: 'thinking',
          input: { level: 0, low: 0, mid: 0, high: 0 },
          output: { level: 0.3, low: 0.3, mid: 0.2, high: 0.1 },
        }),
      )
      await wait(900)
      await shoot('01-dot-working')
      await page.setViewportSize({ width: 640, height: 1000 })
      await page.goto(base + '?view=panel')
      await page.locator('[data-card]').waitFor()
      await wait(500)
      return shots
    },
  },
  {
    id: '02-active',
    title: 'Active: what needs you right now',
    beat: 'One compact list of the threads that are working or waiting, Claude and Codex together, each with its context ring.',
    seconds: 4,
    async run({ frame, chooseView, wait }) {
      await chooseView('Active')
      await wait(300)
      return [await frame('02-active')]
    },
  },
  {
    id: '03-hover',
    title: 'Hover for the detail',
    beat: 'Hovering a ring or badge explains it in the info strip at the bottom. Nothing pops up over the rows.',
    seconds: 3,
    async run({ row, wait, frame }) {
      await row('Fix checkout').locator('[data-workspace-anchor]').hover()
      await wait(1000)
      return [await frame('03-hover', { keep: true })]
    },
  },
  {
    id: '04-expand',
    title: 'Open a thread',
    beat: 'A click opens the thread in place: its plan, the step it is on and any background task.',
    seconds: 5,
    async run({ page, row, wait, frame }) {
      await page.mouse.move(2, 2)
      await row('Fix checkout').locator('button').first().click()
      await wait(700)
      return [await frame('04-expand')]
    },
  },
  {
    id: '05-needs-input',
    title: 'Answer from the panel',
    beat: 'A thread that asks you something shows its question here, so you can answer without switching apps.',
    seconds: 4,
    async run({ row, wait, frame }) {
      await row('Fix checkout').locator('button').first().click()
      await row('Redesign pricing').locator('button').first().click()
      await wait(800)
      const shot = await frame('05-needs-input')
      await row('Redesign pricing').locator('button').first().click()
      return [shot]
    },
  },
  {
    id: '06-menu',
    title: 'Right-click for more',
    beat: 'Compose a message, set a needs-input thread aside with Ignore, or switch to the dual layout.',
    seconds: 3,
    async run({ page, row, wait, frame }) {
      await row('Redesign pricing').click({ button: 'right' })
      await wait(500)
      const shot = await frame('06-menu')
      await page.keyboard.press('Escape')
      return [shot]
    },
  },
  {
    id: '07-recent',
    title: 'Recent: everything from today',
    beat: 'The same rows, newest first, with git branch, commits to push and linked pull requests.',
    seconds: 3,
    async run({ chooseView, frame, wait, page }) {
      await page.mouse.move(2, 2)
      await chooseView('Recent')
      await wait(500)
      return [await frame('07-recent')]
    },
  },
  {
    id: '08-wires',
    title: 'Wires link threads in the same repo',
    beat: 'In Workspace, a wire joins threads working in the same repository. Hover one and the rest of the list dims.',
    seconds: 5,
    async run({ chooseView, set, row, wait, frame }) {
      await set({ workspaceAllDrives: true })
      await chooseView('Workspace')
      await wait(700)
      await row('Fix checkout').locator('button').first().hover()
      await wait(500)
      return [await frame('08-wires', { keep: true })]
    },
  },
  {
    id: '09-dual',
    title: 'Dual view: Claude and Codex side by side',
    beat: 'The panel widens: Claude on the left, Codex on the right, in one scrolling list.',
    seconds: 4,
    async run({ chooseView, set, page, wait, frame }) {
      await set({ panelLayout: 'dual' })
      await page.mouse.move(2, 2)
      await chooseView('Recent')
      await wait(900)
      return [await frame('09-dual')]
    },
  },
  {
    id: '10-dual-wires',
    title: 'Wires run down the middle',
    beat: 'In dual view the wires run down the centre, joining a Claude thread to a Codex thread in the same repo.',
    seconds: 6,
    async run({ chooseView, row, wait, frame }) {
      await chooseView('Workspace')
      await wait(900)
      const shots = []
      await row('Fix checkout').locator('button').first().hover()
      await wait(500)
      shots.push(await frame('10-dual-wires-api', { keep: true }))
      await row('Redesign pricing').locator('button').first().hover()
      await wait(500)
      shots.push(await frame('10-dual-wires-web', { keep: true }))
      return shots
    },
  },
  {
    id: '11-agent',
    title: 'The Brainstorm agent',
    beat: 'Ask one assistant to work across threads. It reads them, drafts messages and waits for your go.',
    seconds: 5,
    async run({ page, set, wait, frame }) {
      await set({ panelLayout: 'single' })
      await page.mouse.move(2, 2)
      await page.evaluate(
        (items) =>
          window.story.agent({
            status: 'ready',
            provider: 'claude',
            model: 'haiku',
            conversationId: 'story',
            items,
          }),
        agentConversation,
      )
      await page
        .getByRole('button', { name: /^Agent/ })
        .first()
        .click()
      await wait(900)
      return [await frame('11-agent')]
    },
  },
  {
    id: '12-settings',
    title: 'Settings',
    beat: 'Choose which apps to list, how many threads, hover help, the agent and the voice.',
    seconds: 3,
    async run({ page, wait, frame }) {
      await page
        .getByRole('button', { name: 'Back to sessions', exact: true })
        .click()
        .catch(() => {})
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await wait(700)
      return [await frame('12-settings')]
    },
  },
]
