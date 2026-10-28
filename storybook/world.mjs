// A made-up working day for the storybook: two providers, four projects, a few threads asking
// for you. Everything here is invented; nothing is read from a real machine.
const MIN = 60_000

/** Four projects. `Z:` and `C:` drives both appear so "All drives" has something to join. */
export const PROJECTS = {
  api: 'C:/Projects/atlas-api',
  web: 'C:/Projects/atlas-web',
  docs: 'C:/Projects/docs-site',
  mobile: 'Z:/Apps/atlas-mobile',
}

const git = (cwd, branch, ahead = 0, behind = 0, added = 0, removed = 0, files = 0) => ({
  root: cwd,
  files,
  newFiles: 0,
  branch,
  ahead,
  behind,
  worktrees: [cwd],
  added,
  removed,
})

const diff = (added, removed, files) => ({
  added,
  removed,
  files,
  revision: `${added}-${removed}`,
  complete: true,
})

/** [provider, key, title, project, minutesAgo, state, extras] */
const threads = [
  [
    'claude',
    'c1',
    'Fix checkout race condition',
    'api',
    1,
    'working',
    {
      stage: 'Running the test suite',
      contextUsed: 0.62,
      git: git(PROJECTS.api, 'fix/checkout-race', 2, 0, 41, 9, 4),
      threadDiff: diff(41, 9, 4),
      plan: [
        { content: 'Reproduce the double charge in a test', status: 'completed' },
        { content: 'Lock the order row while charging', status: 'completed' },
        { content: 'Make the retry idempotent', status: 'in_progress' },
        { content: 'Run the full payment suite', status: 'pending' },
      ],
      currentStep: { index: 3, total: 4, content: 'Make the retry idempotent' },
      backgroundTasks: [{ id: 't1', label: 'npm run test:payments', startedAt: -40_000 }],
      lastPrompt: 'Customers are occasionally charged twice at checkout. Find out why and fix it.',
      recap: 'Found the cause: two retries can pass the paid check before either writes.',
      thinking: true,
    },
  ],
  [
    'claude',
    'c2',
    'Redesign pricing page',
    'web',
    4,
    'waiting',
    {
      stage: 'Waiting for you',
      contextUsed: 0.34,
      git: git(PROJECTS.web, 'feat/pricing', 3, 1, 188, 62, 7),
      threadDiff: diff(188, 62, 7),
      attention: {
        kind: 'question',
        questions: [
          {
            header: 'Layout',
            question: 'Which pricing layout should I build?',
            multiSelect: false,
            options: [
              {
                label: 'Three cards',
                description: 'Starter, Team and Scale side by side',
                recommended: true,
              },
              {
                label: 'Comparison table',
                description: 'One table, every feature in a row',
                recommended: false,
              },
            ],
          },
        ],
        answerableUntil: null,
      },
      plan: [
        { content: 'Audit the current pricing page', status: 'completed' },
        { content: 'Pick a layout', status: 'in_progress' },
        { content: 'Build the page', status: 'pending' },
      ],
      currentStep: { index: 2, total: 3, content: 'Pick a layout' },
      lastPrompt: 'Redesign the pricing page so Team is the obvious choice.',
    },
  ],
  [
    'claude',
    'c3',
    'Write migration for invoices',
    'api',
    9,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.48,
      git: git(PROJECTS.api, 'feat/invoices', 1, 0, 76, 3, 3),
      threadDiff: diff(76, 3, 3),
      pullRequests: [{ number: 212, state: 'open' }],
      lastReply: 'The migration adds invoice_lines and backfills 14k rows. Rollback tested.',
    },
  ],
  [
    'claude',
    'c4',
    'Add dark mode toggle',
    'web',
    14,
    'waiting',
    {
      stage: 'Waiting for approval',
      contextUsed: 0.27,
      git: git(PROJECTS.web, 'feat/dark-mode', 0, 3, 54, 11, 5),
      threadDiff: diff(54, 11, 5),
      attention: {
        kind: 'approval',
        action: 'git push origin feat/dark-mode',
        tool: 'Bash',
        answerableUntil: null,
      },
    },
  ],
  [
    'claude',
    'c5',
    'Audit npm dependencies',
    'docs',
    38,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.19,
      git: git(PROJECTS.docs, 'main', 0, 0, 0, 0, 0),
      lastReply:
        'Nine packages are out of date; two have known advisories. Patch notes are in the thread.',
    },
  ],
  [
    'claude',
    'c6',
    'Refactor auth middleware',
    'api',
    52,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.71,
      git: git(PROJECTS.api, 'refactor/auth', 0, 2, 120, 140, 6),
      threadDiff: diff(120, 140, 6),
      pullRequests: [{ number: 208, state: 'merged' }],
    },
  ],
  [
    'claude',
    'c7',
    'Draft the 2.4 release notes',
    'docs',
    95,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.12,
      git: git(PROJECTS.docs, 'main', 0, 0, 0, 0, 0),
    },
  ],
  [
    'codex',
    'x1',
    'Optimise the image pipeline',
    'web',
    2,
    'working',
    {
      stage: 'Compressing assets',
      contextUsed: 0.44,
      git: git(PROJECTS.web, 'perf/images', 1, 0, 33, 12, 3),
      threadDiff: diff(33, 12, 3),
      backgroundTasks: [{ id: 'tx1', label: 'node scripts/compress.mjs', startedAt: -70_000 }],
    },
  ],
  [
    'codex',
    'x2',
    'Fix the flaky checkout e2e test',
    'api',
    6,
    'waiting',
    {
      stage: 'Waiting for you',
      contextUsed: 0.58,
      git: git(PROJECTS.api, 'fix/e2e-flake', 1, 0, 18, 6, 2),
      threadDiff: diff(18, 6, 2),
      attention: {
        kind: 'next-step',
        recap: 'The flake was a missing await on the payment webhook.',
        ask: 'Run the e2e suite ten times to confirm?',
        actions: [
          { label: 'Run it', message: 'Yes, run it ten times.', appAction: null },
          { label: 'Not now', message: 'No, leave it.', appAction: null },
        ],
        answerableUntil: null,
      },
    },
  ],
  [
    'codex',
    'x3',
    'Add rate limiting to the public API',
    'api',
    18,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.39,
      git: git(PROJECTS.api, 'feat/rate-limit', 2, 0, 97, 8, 5),
      threadDiff: diff(97, 8, 5),
      pullRequests: [{ number: 215, state: 'draft' }],
    },
  ],
  [
    'codex',
    'x4',
    'Upgrade to React 19',
    'web',
    27,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.66,
      git: git(PROJECTS.web, 'chore/react-19', 4, 0, 211, 187, 19),
      threadDiff: diff(211, 187, 19),
    },
  ],
  [
    'codex',
    'x5',
    'Push notifications for the mobile app',
    'mobile',
    11,
    'working',
    {
      stage: 'Wiring the device tokens',
      contextUsed: 0.31,
      git: git(PROJECTS.mobile, 'feat/push', 0, 0, 64, 4, 4),
      threadDiff: diff(64, 4, 4),
    },
  ],
  [
    'codex',
    'x6',
    'Seed demo data for sales',
    'api',
    63,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.22,
      git: git(PROJECTS.api, 'chore/demo-seed', 0, 0, 0, 0, 0),
    },
  ],
  [
    'codex',
    'x7',
    'Write the API reference',
    'docs',
    130,
    'idle',
    {
      stage: 'Done',
      contextUsed: 0.52,
      git: git(PROJECTS.docs, 'main', 0, 0, 0, 0, 0),
    },
  ],
]

const blank = {
  tracked: true,
  focusedAt: 0,
  thinking: false,
  lastPrompt: null,
  plan: [],
  currentStep: null,
  recap: null,
  lastReply: null,
  lastAction: null,
  turnStartedAt: null,
  backgroundTasks: [],
  live: false,
  git: null,
  contextUsed: 0.3,
  attention: null,
  permissionMode: null,
  model: null,
  pullRequests: [],
}

/** Sessions with times counted from "now", so the list always reads as a live day. */
export function makeSessions(now = Date.now()) {
  return threads.map(([provider, key, title, project, ago, state, extras]) => {
    const id =
      provider === 'codex'
        ? `codex:${key}-0000-4000-8000-000000000000`
        : `${key}-0000-4000-8000-000000000000`
    return {
      ...blank,
      provider,
      id,
      appId: provider === 'codex' ? id : `local_${key}`,
      title,
      state,
      cwd: PROJECTS[project],
      lastActiveAt: now - ago * MIN,
      stage: state === 'idle' ? 'Done' : 'Working',
      turnStartedAt: state === 'working' ? now - 95_000 : null,
      ...extras,
      backgroundTasks: (extras.backgroundTasks ?? []).map((t) => ({
        ...t,
        startedAt: now + t.startedAt,
      })),
      // The hooks are set up, so Threadlight holds the turn's end and a card can be answered
      // from the panel: a hold id and a deadline, as the main process reports them.
      ...(extras.attention
        ? {
            live: true,
            attention: {
              ...extras.attention,
              holdId: `hold-${key}`,
              answerableUntil: now + 5 * MIN,
            },
          }
        : {}),
    }
  })
}

export const projectName = (cwd) => cwd.split('/').pop()
