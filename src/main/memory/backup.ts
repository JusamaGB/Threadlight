import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, basename, join, relative, sep, isAbsolute } from 'node:path'
import { z } from 'zod'

export async function exportDestination(file: string, privateDirectory: string) {
  const root = await realpath(privateDirectory)
  const destination = await realpath(file).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return join(await realpath(dirname(file)), basename(file))
  })
  const rel = relative(root, destination)
  if (!rel || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)))
    throw new Error('Export outside the application data folder.')
  return destination
}

const id = z.string().uuid(),
  number = z.number().int().nonnegative(),
  text = z.string().max(100_000),
  title = z.string().min(1).max(80)
const base = z.object({ id, spaceId: id, createdAt: number, author: z.string().max(300) })
const schemas = {
  space: base.extend({
    title,
    description: z.string().max(300),
    mode: z.enum(['manual', 'assisted', 'automatic']),
    paused: z.boolean(),
    maxDispatches: z.number().int().min(1).max(100),
    dispatches: number,
    expiresAt: number,
  }),
  folder: base.extend({
    title,
    description: z.string().max(300),
    reason: z.string().max(300),
    parentId: id.nullable(),
    revision: number.positive(),
    archived: z.boolean(),
    redirectId: id.optional(),
  }),
  item: base.extend({
    title,
    folderId: id,
    kind: z.enum(['note', 'document', 'image', 'decision', 'scratchpad', 'reference']),
    revision: number.positive(),
    acceptedRevision: number.positive().nullable(),
    archived: z.boolean(),
  }),
  revision: base.extend({
    itemId: id,
    revision: number.positive(),
    body: z.string().max(10 * 1024 * 1024),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().max(300),
    blobId: id.optional(),
    mime: z
      .enum([
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/markdown',
      ])
      .optional(),
    filename: z.string().max(255).optional(),
  }),
  grant: base.extend({
    label: title,
    folderId: id.nullable(),
    readOnly: z.boolean(),
    createFolders: z.boolean(),
    delegate: z.boolean(),
    revoked: z.boolean(),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    assignee: z.string().max(512).optional(),
    taskId: id.optional(),
    parentGrantId: id.optional(),
    expiresAt: number.optional(),
  }),
  task: base.extend({
    deliveryState: z.enum(['none', 'dispatching', 'completed', 'unknown']).optional(),
    nativeReply: text.optional(),
    title,
    body: text,
    assignee: z.string().max(512),
    folderId: id,
    inputs: z.array(z.object({ itemId: id, revision: number.positive() })).max(30),
    inputHeads: z
      .array(z.object({ itemId: id, revision: number.positive() }))
      .max(30)
      .optional(),
    outputs: z.array(z.object({ itemId: id, revision: number.positive() })).max(30),
    outputIds: z.array(id).max(30),
    state: z.enum([
      'draft',
      'queued',
      'dispatching',
      'accepted',
      'completed',
      'unknown',
      'blocked',
      'submitted',
      'resolved',
      'cancelled',
      'paused',
    ]),
    reason: text,
    updatedAt: number,
    reply: text,
    originTaskId: id.optional(),
    subscriptionId: id.optional(),
  }),
  message: base.extend({ taskId: id.nullable(), itemId: id.nullable(), body: text }),
  subscription: base.extend({
    folderId: id,
    assignee: z.string().max(512),
    title,
    body: text,
    active: z.boolean(),
  }),
}
export function readBackup(file: string) {
  if (statSync(file).size > 200 * 1024 * 1024) throw new Error('Backups are limited to 200 MiB.')
  const source = new DatabaseSync(file, { readOnly: true })
  try {
    if (
      source.prepare('PRAGMA user_version').get()?.user_version !== 1 ||
      source.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok'
    )
      throw new Error('This is not a valid Threadlight memory backup.')
    const rows = source.prepare('SELECT kind,data FROM records LIMIT 200001').all()
    if (rows.length > 200000) throw new Error('This backup exceeds the record limit.')
    const records = rows.map((row) => {
      const kind = z
        .enum(['space', 'folder', 'item', 'revision', 'grant', 'task', 'message', 'subscription'])
        .parse(row.kind)
      return { kind, value: schemas[kind].strict().parse(JSON.parse(String(row.data))) }
    })
    if (new Set(records.map((r) => r.value.id)).size !== records.length)
      throw new Error('This backup contains duplicate record IDs.')
    const blobs = source
      .prepare('SELECT id,mime,data FROM blobs')
      .all()
      .map((row) => ({
        id: id.parse(row.id),
        mime: z.string().max(100).parse(row.mime),
        data: Buffer.from(row.data as Uint8Array),
      }))
    if (blobs.some((b) => b.data.length > 10 * 1024 * 1024))
      throw new Error('An attachment exceeds the size limit.')
    const events = source
      .prepare('SELECT seq,space,entity,action,author,at FROM events ORDER BY seq DESC LIMIT 10000')
      .all()
      .map((row) =>
        z
          .object({
            seq: number,
            space: id,
            entity: id,
            action: z.string().max(500),
            author: z.string().max(300),
            at: number,
          })
          .parse(row),
      )
    return { records, blobs, events }
  } finally {
    source.close()
  }
}
