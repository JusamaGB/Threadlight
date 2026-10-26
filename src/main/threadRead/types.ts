import type {
  SourceReceipt,
  ThreadCandidate,
  ThreadProvider,
  ThreadStatus,
  ThreadVisibleItem,
} from '../../shared/threadRead'
export interface CatalogEntry extends Omit<
  ThreadCandidate,
  'threadRef' | 'workspaceRef' | 'matchReason' | 'host'
> {
  nativeId: string
  locator?: string
}
export interface CatalogPage {
  entries: CatalogEntry[]
  sources: SourceReceipt[]
  next?: string
  complete: boolean
}
export interface HistoryCursor {
  position: number
  identity: string
  boundary: number
  revision?: string
}
export interface AdapterRead {
  items: ThreadVisibleItem[]
  sources: SourceReceipt[]
  status: ThreadStatus
  coverage: string[]
  cursor?: HistoryCursor
  changedDuringRead: boolean
}
export interface ThreadAdapter {
  provider: ThreadProvider
  catalog(cursor?: string): Promise<CatalogPage>
  locate(nativeId: string): Promise<CatalogEntry | null>
  read(entry: CatalogEntry, cursor?: HistoryCursor, statusOnly?: boolean): Promise<AdapterRead>
}
export const unknownStatus = (): ThreadStatus => ({
  state: 'unknown',
  basis: 'unknown',
  at: null,
  turnId: null,
})
export const sourceFailure = (source: string, reason: string): SourceReceipt => ({
  source,
  checkedAt: null,
  health: 'unavailable',
  reason,
})
