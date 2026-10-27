import { describe, expect, it } from 'vitest'
import { summarizeCodex, codexStage } from '../src/main/codex/tracker'
import { codexUsage, parseCodexUsage } from '../src/main/codex/usage'
import { combinedSnapshot } from '../src/shared/providers'
import type { Snapshot } from '../src/shared/types'

const at = Date.parse('2026-10-25T12:00:00Z')
const reset = at / 1000 + 86400
const rate = {
  limit_id: 'codex',
  primary: { used_percent: 27, window_minutes: 10080, resets_at: reset },
  secondary: null,
}
const update = (plan: unknown) => ({
  type: 'function_call',
  name: 'functions.update_plan',
  arguments: JSON.stringify({ plan }),
})

describe('Codex plans and progress', () => {
  it('reads namespaced calls and desktop camel-case statuses, retaining only explicit progress', () => {
    const summary = summarizeCodex([
      update([{ step: 'Inspect the data', status: 'in_progress' }]),
      {
        method: 'turn/plan/updated',
        params: {
          plan: [
            { step: 'Inspect the data', status: 'completed' },
            { step: 'Build the display', status: 'inProgress' },
            { step: 'Verify the display', status: 'pending' },
          ],
        },
      },
      { type: 'agentMessage', text: 'All done.' },
    ])
    expect(summary.plan.map((p) => p.status)).toEqual(['completed', 'in_progress', 'pending'])
    expect(summary.planText).toBeNull()
    expect(
      codexStage('working', { index: 2, total: 3, content: 'Build the display' }, null, null, null),
    ).toBe('2/3 · Build the display')
    expect(codexStage('idle', null, 'old tool', 'Finished.\nChecked.', null)).toBe(
      'Finished. Checked.',
    )
  })
  it('keeps proposed plans separate from tracked steps and ignores ordinary prose/reasoning', () => {
    const proposed = '# Synthetic plan\n1. **Inspect** the data\n2. Build `view.tsx`'
    expect(summarizeCodex([{ type: 'plan', text: proposed }])).toMatchObject({
      plan: [],
      planText: proposed,
      hasPlan: true,
    })
    expect(
      summarizeCodex([
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `<proposed_plan>${proposed}</proposed_plan>` }],
          },
        },
      ]).planText,
    ).toBe(proposed)
    expect(
      summarizeCodex([
        { type: 'agentMessage', text: proposed },
        { type: 'reasoning', text: proposed },
      ]).hasPlan,
    ).toBe(false)
  })
  it('replaces plans, preserves the last valid one through malformed updates, and honours explicit clearing', () => {
    const records = [
      { type: 'plan', text: 'Old proposal' },
      update([{ step: 'Implement', status: 'in_progress' }]),
    ]
    expect(
      summarizeCodex([...records, update([{ step: 'Bad', status: 'invented' }])]),
    ).toMatchObject({ plan: [{ content: 'Implement', status: 'in_progress' }], planText: null })
    expect(summarizeCodex([...records, update([])])).toMatchObject({
      plan: [],
      planText: null,
      hasPlan: true,
    })
  })
})

describe('Codex weekly usage', () => {
  it('identifies a weekly primary window without inventing a five-hour quota', () => {
    expect(parseCodexUsage(rate, at)).toEqual({
      at,
      fiveHour: null,
      week: { used: 0.27, resetsAt: reset * 1000 },
    })
    expect(
      parseCodexUsage(
        {
          limitId: 'codex',
          primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: reset },
          secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: reset },
        },
        at,
      ),
    ).toMatchObject({ fiveHour: { used: 0.05 }, week: { used: 0.4 } })
  })
  it('chooses the Codex bucket and leaves missing or malformed windows unknown', () => {
    expect(
      parseCodexUsage(
        { rateLimitsByLimitId: { premium: { ...rate, limit_id: 'premium' } }, rateLimits: rate },
        at,
      ),
    ).toBeNull()
    expect(parseCodexUsage({ ...rate, limit_id: 'premium' }, at)).toBeNull()
    expect(
      parseCodexUsage({ ...rate, primary: { ...rate.primary, used_percent: NaN } }, at)?.week,
    ).toBeNull()
    expect(
      parseCodexUsage({ ...rate, primary: { ...rate.primary, used_percent: '27' } }, at)?.week,
    ).toBeNull()
    expect(parseCodexUsage(rate, NaN)).toBeNull()
    expect(parseCodexUsage({ primary: null, secondary: null }, at)).toEqual({
      at,
      fiveHour: null,
      week: null,
    })
  })
  it('uses report time, not file order or the time of the scan', () => {
    const entry = (timestamp: number, used: number) => ({
      timestamp: new Date(timestamp).toISOString(),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: { ...rate, primary: { ...rate.primary, used_percent: used } },
      },
    })
    expect(codexUsage([entry(at + 1000, 28), entry(at, 27)])).toMatchObject({
      at: at + 1000,
      week: { used: 0.28 },
    })
  })
  it('retains usage in the combined view and removes it when Codex is disabled', () => {
    const empty: Snapshot = {
      sessions: [],
      workspaces: [],
      allWorkspaces: [],
      currentWorkspace: null,
      currentThreadId: null,
    }
    const usage = parseCodexUsage(rate, at)
    const sources = { claude: empty, codex: { ...empty, codexUsage: usage } }
    expect(combinedSnapshot(['claude', 'codex'], sources, 10).codexUsage).toEqual(usage)
    expect(combinedSnapshot(['claude'], sources, 10).codexUsage).toBeUndefined()
    expect(combinedSnapshot([], sources, 10).codexUsage).toBeUndefined()
  })
})
