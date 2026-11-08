import type { DiffLine } from '../../shared/types'

/** In-memory examples only. No task enrollment, provider transport or filesystem access. */
export const previewPhases = [
  'empty',
  'blocked',
  'working',
  'permission',
  'stop-requested',
  'stopped',
  'uncertain',
  'completed',
  'failed',
  'restored',
] as const
export type PreviewPhase = (typeof previewPhases)[number]
export type PreviewState = {
  phase: PreviewPhase
  frame: number
  approved: boolean
  decision: 'approved' | 'denied' | null
  continued: boolean
}
export type PreviewAction =
  | { type: 'example'; phase: PreviewPhase }
  | { type: 'tick' | 'approve' | 'deny' | 'stop' | 'settle' | 'uncertain' | 'continue' }

export const phaseLabels: Record<PreviewPhase, string> = {
  empty: 'Empty',
  blocked: 'Connection blocked',
  working: 'Working',
  permission: 'Awaiting permission',
  'stop-requested': 'Stop requested',
  stopped: 'Stopped · settled',
  uncertain: 'Outcome uncertain',
  completed: 'Completed',
  failed: 'Failed',
  restored: 'Restored history · paused',
}
export function previewExample(phase: PreviewPhase): PreviewState {
  return {
    phase,
    frame: phase === 'working' || phase === 'empty' ? 0 : 3,
    approved: phase === 'completed' || phase === 'restored',
    decision: phase === 'completed' || phase === 'restored' ? 'approved' : null,
    continued: false,
  }
}
export function previewTransition(state: PreviewState, action: PreviewAction): PreviewState {
  if (action.type === 'example') return previewExample(action.phase)
  if (action.type === 'tick' && state.phase === 'working') {
    const frame = state.frame + 1
    return {
      ...state,
      frame,
      phase: frame >= 3 ? (state.approved ? 'completed' : 'permission') : 'working',
    }
  }
  if (state.phase === 'permission') {
    if (action.type === 'approve')
      return { ...state, phase: 'working', frame: 0, approved: true, decision: 'approved' }
    if (action.type === 'deny')
      return { ...state, phase: 'completed', approved: false, decision: 'denied' }
  }
  if (action.type === 'stop' && (state.phase === 'working' || state.phase === 'permission'))
    return { ...state, phase: 'stop-requested' }
  if (state.phase === 'stop-requested') {
    if (action.type === 'settle') return { ...state, phase: 'stopped' }
    if (action.type === 'uncertain') return { ...state, phase: 'uncertain' }
  }
  if (action.type === 'continue' && (state.phase === 'stopped' || state.phase === 'restored'))
    return { ...state, phase: 'working', frame: 0, continued: true }
  return state
}

export const exampleFiles = [
  {
    path: 'src/greeting.ts',
    before: "export const greeting = 'Hello, user!'\n",
    after: "export const greeting = 'Hello, Ada!'\n",
  },
  {
    path: 'test/greeting.test.ts',
    before: "expect(greeting).toBe('Hello, Ada!')\n",
    after: "expect(greeting).toBe('Hello, Ada!')\n",
  },
] as const
export const exampleDiff: DiffLine[] = [
  { type: 'hunk', text: '@@ -1 +1 @@' },
  { type: 'remove', text: exampleFiles[0].before.trimEnd(), oldLine: 1 },
  { type: 'add', text: exampleFiles[0].after.trimEnd(), newLine: 1 },
]
