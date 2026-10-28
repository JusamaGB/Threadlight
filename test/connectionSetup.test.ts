import { expect, it } from 'vitest'
import { connectionWorkflow } from '../src/shared/connectionSetup'
import { workflowSchema } from '../src/shared/communication'

const space = '11111111-1111-4111-8111-111111111111'
const target = 'codex:22222222-2222-4222-8222-222222222222'
const ids = {
  workflow: '33333333-3333-4333-8333-333333333333',
  participant: '44444444-4444-4444-8444-444444444444',
}
it('starts with communication only and leaves automatic work paused', () => {
  const w = connectionWorkflow(undefined, space, target, 'test-model', ids, 1000)
  expect(workflowSchema.safeParse(w).success).toBe(true)
  expect(w).toMatchObject({
    mode: 'manual',
    paused: true,
    recover: false,
    acceptBy: 'human',
    revision: 1,
  })
  expect(w.participants[0]).toMatchObject({ target, communicate: true, requestWork: false })
  expect(w.coordinator).toBeUndefined()
})
it('preserves existing policy, participant identity, roles, models and other permissions', () => {
  const previous = connectionWorkflow(undefined, space, target, 'old-model', ids, 1000)
  previous.mode = 'automatic'
  previous.paused = false
  previous.coordinator = target
  previous.participants[0]!.communicate = false
  previous.participants[0]!.requestWork = true
  previous.participants[0]!.role = 'Reviewer'
  const before = structuredClone(previous)
  const next = connectionWorkflow(previous, space, target, 'different-model', ids, 9999)
  expect(next).toEqual({
    ...previous,
    revision: 2,
    participants: [{ ...previous.participants[0], communicate: true }],
  })
  expect(previous).toEqual(before)
  previous.eventCursor = 12
  const other = 'codex:55555555-5555-4555-8555-555555555555'
  const added = connectionWorkflow(
    previous,
    space,
    other,
    'new-model',
    { ...ids, participant: '66666666-6666-4666-8666-666666666666' },
    9999,
  )
  expect(added.participants[0]).toEqual(previous.participants[0])
  expect(added.participants[1]).toMatchObject({
    target: other,
    communicate: true,
    requestWork: false,
  })
  expect(added.expiresAt).toBe(previous.expiresAt)
  expect(workflowSchema.safeParse(added).success).toBe(true)
  expect(added.eventCursor).toBeUndefined()
})
