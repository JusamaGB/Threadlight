import type { ThreadVisibleItem } from './threadRead'

export interface TimelineFileChange {
  path: string
  added: number | null
  removed: number | null
  diff?: string
  previewTruncated?: boolean
}

export interface TimelineItem extends ThreadVisibleItem {
  detail?: string
  fileChanges?: TimelineFileChange[]
  fileCount?: number
  activity?:
    'command' | 'files' | 'tool' | 'loaded-tool' | 'search' | 'status' | 'compaction' | 'image'
  failed?: boolean
}

export interface ThreadTimeline {
  threadId: string
  revision: number
  connection: 'connecting' | 'live' | 'history' | 'reconnecting' | 'unavailable'
  items: TimelineItem[]
  hasMore: boolean
  loadingOlder: boolean
  notice?: string
}

export type TimelineRequest = {
  threadId: string
  subscriptionId: string
  action: 'open' | 'close' | 'older'
}
export type TimelineReply = { ok: true; timeline: ThreadTimeline } | { ok: false; reason: string }

/** Older pages precede the current window. Native IDs replace, rather than duplicate, items. */
export function mergeTimeline(older: TimelineItem[], latest: TimelineItem[]): TimelineItem[] {
  const current = new Set(latest.map((item) => item.id))
  return [...older.filter((item) => !current.has(item.id)), ...latest]
}

export type TimelineImageRequest = { threadId: string; itemId: string; action?: 'inspect' }
export type TimelineImageReply =
  { ok: true; dataUrl: string; artifactId?: string } | { ok: false; reason: string }
