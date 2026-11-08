/** Public local comparison contracts. Source content is never needed to render coverage. */
export type ChangeLens = 'git-current' | 'git-staged' | 'git-unstaged' | 'folder-baseline'
export type CoverageReason =
  | 'evidence-scope'
  | 'mixed-lenses'
  | 'history-gap'
  | 'ambiguous-mapping'
  | 'unattributed-write'
  | 'concurrent-write'
  | 'root-unavailable'
  | 'git-read-failed'
  | 'unsupported-conversion'
  | 'unsupported-encoding'
  | 'content-limit'
  | 'inventory-limit'
  | 'storage-limit'
  | 'content-evicted'
  | 'baseline-incomplete'
  | 'recording-disabled'
  | 'excluded'
  | 'unreadable'
export interface ChangeCoverage {
  state: 'complete' | 'partial' | 'unavailable'
  reasons: CoverageReason[]
  stale: boolean
}
export interface MetricCoverage {
  files: ChangeCoverage
  added: ChangeCoverage
  removed: ChangeCoverage
}
export interface TrackingState {
  rootId: string
  root: string
  recording: boolean
  baseline: string | null
  policyRevision: number
  bytes: number
  limit: number
  reasons: CoverageReason[]
}
export interface ReconciledEdit {
  path: string
  state: 'current' | 'recorded' | 'committed' | 'separate-branch' | 'unresolved'
  explanation: string
  commit?: string
  branches?: string[]
  added: number
  removed: number
}
export interface ChangeRootGroup {
  /** Provider evidence remains separate from the current comparison counts. */
  recorded?: ReconciledEdit[]
  reasons?: CoverageReason[]
  recoveredFrom?: string
  rootId: string
  root: string
  lens: ChangeLens
  files: number
  added: number
  removed: number
  complete: boolean
  available: boolean
}
export type TrackingAction = 'enable' | 'pause' | 'forget' | 'baseline'
export const lensLabel: Record<ChangeLens, string> = {
  'git-current': 'Current · HEAD → working files',
  'git-staged': 'Staged · HEAD → index',
  'git-unstaged': 'Unstaged · index → working files',
  'folder-baseline': 'Folder · saved baseline → current files',
}
