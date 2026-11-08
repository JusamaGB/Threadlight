// Renderer preferences and unsent drafts, scoped to one project and discussion.
// These never create discussions or invoke a provider.
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const key = (space: string, kind: string) => `threadlight.brainstorm.v1:${space}:${kind}`
function read(space: string, kind: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key(space, kind)) ?? 'null')
  } catch {
    return null
  }
}
function write(space: string, kind: string, value: unknown): boolean {
  try {
    localStorage.setItem(key(space, kind), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
export function recalledDiscussion(space: string): string | null | undefined {
  const value = read(space, 'selection') as { id?: unknown } | null
  return value?.id === null
    ? null
    : typeof value?.id === 'string' && uuid.test(value.id)
      ? value.id
      : undefined
}
export const rememberDiscussion = (space: string, id: string | null) =>
  write(space, 'selection', { id })
export function recalledProject(): string | null {
  const id = read('global', 'last-project')
  return typeof id === 'string' && uuid.test(id) ? id : null
}
export const rememberProject = (id: string) => write('global', 'last-project', id)
export function recalledDraft(space: string, discussion: string | null): string {
  const value = read(space, `draft:${discussion ?? 'new'}`)
  return typeof value === 'string' && value.length <= 8000 ? value : ''
}
export const rememberDraft = (space: string, discussion: string | null, text: string) =>
  write(space, `draft:${discussion ?? 'new'}`, text)
export interface DiscussionAttempt {
  id: string
  title: string
}
export function recalledAttempt(space: string): DiscussionAttempt | null {
  const value = read(space, 'attempt') as Partial<DiscussionAttempt> | null
  return value &&
    typeof value.id === 'string' &&
    uuid.test(value.id) &&
    typeof value.title === 'string' &&
    !!value.title.trim() &&
    value.title.length <= 80
    ? (value as DiscussionAttempt)
    : null
}
export const rememberAttempt = (space: string, attempt: DiscussionAttempt | null) =>
  write(space, 'attempt', attempt)
