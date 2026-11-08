import { describe, expect, it } from 'vitest'
import { fitCanvas, squareOverlay, zoomAt } from '../src/shared/canvas'
import { handoffGraph } from '../src/shared/handoffs'
import { assignmentSchema, type CommunicationSnapshot } from '../src/shared/communication'
import type { MemorySnapshot } from '../src/shared/memory'
import type { SpaceIdea } from '../src/shared/spaces'

const memory = { tasks: [], folders: [], items: [] } as unknown as MemorySnapshot
describe('truthful handoff projection', () => {
  it('groups workflow instances and shows nested review evidence once', () => {
    const definition = {
      name: 'Checks',
      revision: 1,
      nodes: [
        { id: 'save', type: 'save' },
        { id: 'review', type: 'review' },
      ],
    }
    const communication = {
      workflows: [],
      assignments: [],
      questions: [],
      messages: [],
      processRuns: [
        {
          id: 'run',
          rootId: 'run',
          spaceId: 's',
          objective: 'Implementation',
          definition,
          status: 'running',
          reason: '',
          nodes: {
            save: { status: 'completed', output: { itemId: 'evidence' } },
            review: { status: 'waiting', output: { itemId: 'evidence' } },
          },
        },
        {
          id: 'foreign',
          rootId: 'foreign',
          spaceId: 'other',
          objective: 'Other',
          definition,
          status: 'running',
          nodes: {},
        },
      ],
    } as unknown as CommunicationSnapshot
    const graph = handoffGraph('s', memory, communication, [], [])
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({
      id: 'run',
      group: 'objective:run',
      groupTitle: 'Implementation',
      status: 'Awaiting review',
      attention: true,
      outputs: 1,
    })
    expect(graph.edges).toEqual([])
  })
  it('uses explicit objectives, dependencies and delivery evidence without cross-project edges', () => {
    const communication = {
      workflows: [],
      questions: [],
      messages: [{ id: 'm', spaceId: 's', deliveries: [{ phase: 'unknown' }] }],
      assignments: [
        {
          id: 'a',
          spaceId: 's',
          title: 'Same title',
          state: 'submitted',
          dependsOn: [],
          objective: { id: 'one', title: 'Onboarding' },
          outputs: [{}],
        },
        {
          id: 'b',
          spaceId: 's',
          title: 'Same title',
          state: 'active',
          messageId: 'm',
          dependsOn: ['a', 'foreign'],
          objective: { id: 'two', title: 'Chats' },
        },
        { id: 'c', spaceId: 's', title: 'Old work', state: 'accepted', dependsOn: [] },
        { id: 'foreign', spaceId: 'other', dependsOn: [] },
      ],
    } as unknown as CommunicationSnapshot
    const graph = handoffGraph('s', memory, communication, [], [])
    expect(graph.nodes.map((n) => [n.groupTitle, n.status])).toEqual([
      ['Onboarding', 'Submitted · review'],
      ['Chats', 'Delivery unknown'],
      ['Ungrouped', 'Result accepted'],
    ])
    expect(graph.edges).toEqual([{ from: 'a', to: 'b', kind: 'dependency' }])
    expect(graph.nodes[0]!.attention).toBe(true)
  })
  it('groups prepared task IDs only, and never treats delegation or finished turns as completion', () => {
    const data = {
      ...memory,
      tasks: [
        { id: 't', spaceId: 's', title: 'Chats', assignee: 'x', state: 'completed', outputs: [] },
        {
          id: 'child',
          spaceId: 's',
          title: 'Chats',
          assignee: 'x',
          state: 'accepted',
          outputs: [],
          originTaskId: 't',
        },
      ],
    } as unknown as MemorySnapshot
    const discussions = [
      { id: 'd', title: 'Objective', sharedSpaceId: 's', prepared: { taskIds: ['t'] } },
    ] as SpaceIdea[]
    const graph = handoffGraph('s', data, null, discussions, [])
    expect(graph.nodes.map((n) => [n.groupTitle, n.status])).toEqual([
      ['Objective', 'Turn finished'],
      ['Ungrouped', 'Delivery accepted'],
    ])
    expect(graph.edges[0]!.kind).toBe('delegation')
  })
  it('retains unknown delivery when the receipt is outside the current history page', () => {
    const data = {
      workflows: [],
      questions: [],
      messages: [],
      assignmentDeliveryPhases: { old: ['unknown'] },
      assignments: [
        { id: 'old', spaceId: 's', state: 'blocked', dependsOn: [], title: 'Old work' },
      ],
    } as unknown as CommunicationSnapshot
    expect(handoffGraph('s', memory, data, [], []).nodes[0]?.status).toBe('Delivery unknown')
  })
  it('retains old assignment records and optional explicit objective metadata', () => {
    expect(assignmentSchema.shape.objective.safeParse(undefined).success).toBe(true)
    expect(
      assignmentSchema.shape.objective.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Improve Chats',
      }).success,
    ).toBe(true)
  })
})
describe('canvas navigation geometry', () => {
  it('keeps the pointer world coordinate invariant and clamps zoom', () => {
    const v = { x: -90, y: 30, zoom: 0.8 },
      next = zoomAt(v, 1.5, 100, 70)
    expect((100 - next.x) / next.zoom).toBeCloseTo((100 - v.x) / v.zoom)
    expect((70 - next.y) / next.zoom).toBeCloseTo((70 - v.y) / v.zoom)
    expect(zoomAt(v, 100, 100, 70).zoom).toBe(2)
    expect(zoomAt(v, 0.0001, 100, 70).zoom).toBe(0.02)
    expect(fitCanvas(238, 350, 460, 400).zoom).toBeLessThan(0.5)
  })
  it('bounds square overlays on small and negative-coordinate work areas', () => {
    expect(squareOverlay({ x: -400, y: 20, width: 400, height: 260 }, { x: -10, y: 200 })).toEqual({
      x: -260,
      y: 20,
      width: 260,
      height: 260,
    })
  })
})
