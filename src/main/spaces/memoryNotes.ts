import type { MemoryStore } from '../memory/store'
import type { SpaceIdea } from '../../shared/spaces'

/** A view over the original item/revisions, never a second persisted note. */
export function memoryNote(
  memory: MemoryStore,
  id: string,
  workspaceId: string,
  revision?: number,
): SpaceIdea {
  const read = memory.read({}, id, revision)
  if (read.item.purpose !== 'note' || read.item.archived) throw Error('This note is unavailable.')
  return {
    memoryItem: true,
    recordKind: 'note',
    id,
    sharedSpaceId: read.item.spaceId,
    workspaceId,
    revision: read.revision.revision,
    title: read.revision.title ?? read.item.title,
    text: read.revision.body,
    stage: 'idea',
    plan: '',
    assignments: [],
    conversationId: null,
    prepared: null,
    at: read.revision.createdAt,
    saver: read.revision.saver,
  }
}
