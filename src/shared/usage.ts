// The plan's usage limits, as Claude Code reports them: a rolling 5-hour window and a weekly one.

export interface UsageWindow {
  /** How much of the window is used, 0 to 1. */
  used: number
  /** When it resets, in ms since the epoch. */
  resetsAt: number
}

export interface Usage {
  fiveHour: UsageWindow | null
  week: UsageWindow | null
  /** When these numbers were read, in ms since the epoch. */
  at: number
}
