import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  recalledAttempt,
  recalledDiscussion,
  recalledDraft,
  rememberAttempt,
  rememberDiscussion,
  rememberDraft,
  recalledProject,
  rememberProject,
} from '../src/renderer/spaces/brainstormStorage'

let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())
const discussion = '11111111-1111-4111-8111-111111111111'
it('remembers the last project without choosing a discussion or starting voice', () => {
  expect(recalledProject()).toBeNull()
  rememberProject(discussion)
  expect(recalledProject()).toBe(discussion)
  expect(recalledDiscussion(discussion)).toBeUndefined()
  values.set('threadlight.brainstorm.v1:global:last-project', '"not-a-project-id"')
  expect(recalledProject()).toBeNull()
})
it('keeps selected discussions and explicit new chats separate for each project', () => {
  expect(recalledDiscussion('a')).toBeUndefined()
  rememberDiscussion('a', discussion)
  rememberDiscussion('b', null)
  expect(recalledDiscussion('a')).toBe(discussion)
  expect(recalledDiscussion('b')).toBeNull()
})
it('preserves separate new and existing discussion drafts without sending or creating anything', () => {
  rememberDraft('a', null, 'New idea')
  rememberDraft('a', discussion, 'Follow-up')
  rememberDraft('b', discussion, 'Another project')
  expect(recalledDraft('a', null)).toBe('New idea')
  expect(recalledDraft('a', discussion)).toBe('Follow-up')
  expect(recalledDraft('b', discussion)).toBe('Another project')
  rememberDraft('a', discussion, '')
  expect(recalledDraft('a', null)).toBe('New idea')
})
it('retains the same discussion creation identity after an uncertain response', () => {
  rememberAttempt('a', { id: discussion, title: 'First idea' })
  expect(recalledAttempt('a')).toEqual({ id: discussion, title: 'First idea' })
  rememberAttempt('a', null)
  expect(recalledAttempt('a')).toBeNull()
  values.set('threadlight.brainstorm.v1:a:attempt', '{"id":"bad","title":"bad"}')
  expect(recalledAttempt('a')).toBeNull()
})
it('handles unavailable or damaged browser storage without losing the in-memory fallback', () => {
  values.set('threadlight.brainstorm.v1:a:selection', 'broken JSON')
  expect(recalledDiscussion('a')).toBeUndefined()
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('unavailable')
    },
    setItem: () => {
      throw new Error('full')
    },
  })
  expect(recalledDraft('a', null)).toBe('')
  expect(rememberDraft('a', null, 'Kept in memory by the composer')).toBe(false)
})
