import { createHash } from 'node:crypto'
import type { SourcePin } from '../../shared/spaces'
import { isSourceFile, sourceLines } from '../../shared/sourceReview'
import type { MemoryStore } from '../memory/store'

/** Resolve only a managed attachment in the selected Space. Never open its original path. */
export function reviewSource(
  memory: MemoryStore,
  spaceId: string,
  itemId: string,
  revision: number,
  expectedHash?: string,
) {
  const item = memory
    .snapshot()
    .items.find(
      (entry) =>
        entry.id === itemId &&
        entry.spaceId === spaceId &&
        !entry.archived &&
        entry.kind === 'document',
    )
  if (!item) throw Error('The shared source is unavailable in this Space.')
  const read = memory.read({}, item.id, revision).revision
  if (
    !read.blobId ||
    read.mime !== 'text/plain' ||
    !read.filename ||
    !isSourceFile(read.filename) ||
    (expectedHash && read.hash !== expectedHash) ||
    createHash('sha256').update(read.body, 'utf8').digest('hex') !== read.hash
  )
    throw Error('This revision is not the selected source snapshot.')
  const lines = sourceLines(read.body)
  const pin: SourcePin = {
    itemId,
    revision,
    filename: read.filename,
    hash: read.hash,
    totalLines: lines.length,
  }
  return { pin, lines }
}
