// Every user-facing string, in one place, so wording stays consistent and can be translated later.

export const en = {
  dot: {
    working: 'A Claude session is working',
    idle: 'No Claude session is working',
  },
  panel: {
    active: 'Active',
    recent: 'Recent',
    working: (n: number) => `${n} working`,
    waiting: (n: number) => `${n} waiting`,
    recentCount: (n: number) => `${n} recent`,
    nothingWorking: 'Nothing working right now',
    noSessions: (hours: number) => `No sessions in the last ${hours} h`,
    showAll: (n: number) => `Show all recent (${n})`,
    toggleView: 'Switch between active and recent sessions',
  },
  state: {
    working: 'Working',
    waiting: 'Waiting for approval',
    idle: 'Idle',
    guessed: 'state guessed',
  },
  detail: {
    asked: 'Asked',
    plan: (done: number, total: number) => `Plan  ${done}/${total}`,
    now: 'Now',
    result: 'Result',
    lastReply: 'Last reply',
    open: 'Open ↗',
  },
  menu: {
    openInClaude: 'Open in Claude',
  },
  age: {
    now: 'now',
    minutes: (n: number) => `${n}m`,
    hours: (n: number) => `${n}h`,
    days: (n: number) => `${n}d`,
  },
}
