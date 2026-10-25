import { z } from 'zod'

const id = z.string().uuid()
const title = z.string().trim().min(1).max(80)
const text = z.string().max(100_000)
export const memoryInput = z
  .object({
    action: z.enum([
      'snapshot',
      'read',
      'search',
      'changes',
      'create_space',
      'update_space',
      'ensure_folder',
      'update_folder',
      'merge_folder',
      'create_item',
      'import_attachment',
      'revise_item',
      'accept_item',
      'archive_item',
      'purge_item',
      'create_grant',
      'revoke_grant',
      'create_task',
      'authorize_task',
      'pause_task',
      'cancel_task',
      'submit_result',
      'resolve_task',
      'post_message',
      'save_draft',
      'mark_seen',
      'subscribe',
      'unsubscribe',
      'reconcile_task',
    ]),
    spaceId: id.optional(),
    id: id.optional(),
    parentId: id.nullable().optional(),
    folderId: id.optional(),
    targetId: id.optional(),
    operationId: id.optional(),
    title: title.optional(),
    description: z.string().trim().max(300).optional(),
    reason: z.string().trim().max(300).optional(),
    body: text.optional(),
    data: z.string().max(14_000_000).optional(),
    filename: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\]+$/)
      .optional(),
    expectedRevision: z.number().int().positive().optional(),
    revision: z.number().int().positive().optional(),
    cursor: z.number().int().nonnegative().optional(),
    query: z.string().max(300).optional(),
    kind: z.enum(['note', 'document', 'image', 'decision', 'scratchpad', 'reference']).optional(),
    archived: z.boolean().optional(),
    assignee: z.string().min(1).max(512).optional(),
    originTaskId: id.optional(),
    inputs: z
      .array(z.object({ itemId: id, revision: z.number().int().positive() }).strict())
      .max(30)
      .optional(),
    outputIds: z.array(id).max(30).optional(),
    readOnly: z.boolean().optional(),
    createFolders: z.boolean().optional(),
    delegate: z.boolean().optional(),
    mode: z.enum(['manual', 'assisted', 'automatic']).optional(),
    paused: z.boolean().optional(),
    maxDispatches: z.number().int().min(1).max(100).optional(),
    durationMinutes: z.number().int().min(1).max(240).optional(),
    resetBudget: z.boolean().optional(),
    delivered: z.boolean().optional(),
    draftKey: z.string().min(1).max(300).optional(),
  })
  .strict()
export type MemoryInput = z.infer<typeof memoryInput>
export interface MemoryBase {
  id: string
  spaceId: string
  createdAt: number
  author: string
}
export interface MemorySpace extends MemoryBase {
  title: string
  description: string
  mode: 'manual' | 'assisted' | 'automatic'
  paused: boolean
  maxDispatches: number
  dispatches: number
  expiresAt: number
}
export interface MemoryFolder extends MemoryBase {
  title: string
  description: string
  reason: string
  parentId: string | null
  revision: number
  archived: boolean
  redirectId?: string
}
export interface MemoryItem extends MemoryBase {
  title: string
  folderId: string
  kind: 'note' | 'document' | 'image' | 'decision' | 'scratchpad' | 'reference'
  revision: number
  acceptedRevision: number | null
  archived: boolean
}
export interface MemoryRevision extends MemoryBase {
  itemId: string
  revision: number
  body: string
  hash: string
  source: string
  blobId?: string
  mime?: string
  filename?: string
}
export interface MemoryGrant extends MemoryBase {
  label: string
  folderId: string | null
  readOnly: boolean
  createFolders: boolean
  delegate: boolean
  revoked: boolean
  tokenHash: string
  assignee?: string
  taskId?: string
  parentGrantId?: string
  expiresAt?: number
}
export type MemoryTaskState =
  | 'draft'
  | 'queued'
  | 'dispatching'
  | 'accepted'
  | 'completed'
  | 'unknown'
  | 'blocked'
  | 'submitted'
  | 'resolved'
  | 'cancelled'
  | 'paused'
export interface MemoryTask extends MemoryBase {
  deliveryState?: 'none' | 'dispatching' | 'completed' | 'unknown'
  nativeReply?: string
  outputs: { itemId: string; revision: number }[]
  title: string
  body: string
  assignee: string
  folderId: string
  inputs: { itemId: string; revision: number }[]
  inputHeads?: { itemId: string; revision: number }[]
  outputIds: string[]
  state: MemoryTaskState
  reason: string
  updatedAt: number
  reply: string
  originTaskId?: string
  subscriptionId?: string
}
export interface MemoryMessage extends MemoryBase {
  taskId: string | null
  body: string
  itemId: string | null
}
export interface MemorySubscription extends MemoryBase {
  folderId: string
  assignee: string
  title: string
  body: string
  active: boolean
}
export interface MemoryEvent {
  seq: number
  spaceId: string
  entityId: string
  action: string
  author: string
  at: number
}
export interface MemorySnapshot {
  subscriptions: MemorySubscription[]
  participants: { label: string; assignee: string; folderId: string | null; spaceId: string }[]
  spaces: MemorySpace[]
  folders: MemoryFolder[]
  items: MemoryItem[]
  tasks: MemoryTask[]
  messages: MemoryMessage[]
  grants: Omit<MemoryGrant, 'tokenHash'>[]
  events: MemoryEvent[]
  cursor: number
  seen: number
  drafts: Record<string, string>
  endpoint: string | null
}
export type MemoryReply =
  | { ok: true; snapshot?: MemorySnapshot; value?: unknown }
  | { ok: false; reason: string; code: string }
export interface MemoryRead {
  item: MemoryItem
  revision: MemoryRevision
  dataUrl?: string
}
export const MEMORY_ATTACHMENT_LIMIT = 10 * 1024 * 1024
export interface MemoryDeliveryContext {
  attemptId: string
  url: string
  token: string
}
