import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { CommunicationStore } from '../src/main/communication/store'
import { ProcessEngine, runScript } from '../src/main/workflows/engine'
import {
  validateGraph,
  cronSlot,
  type ProcessDefinition,
  type ProcessRun,
  type ProcessStep,
} from '../src/shared/workflowGraph'
import { newProcessStep } from '../src/shared/workflowDefaults'
import type { Assignment, CommunicationActor, Workflow } from '../src/shared/communication'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((f) => f()))
const human: CommunicationActor = { id: 'human', kind: 'human' }
function fixture() {
  const db = new DatabaseSync(':memory:'),
    store = new CommunicationStore(db)
  let now = Date.UTC(2026, 9, 29, 12, 0),
    revoked = false
  const spaceId = randomUUID(),
    roleId = randomUUID(),
    folderId = randomUUID()
  const policy: Workflow = {
    id: randomUUID(),
    spaceId,
    revision: 1,
    mode: 'automatic',
    paused: false,
    participants: [
      {
        id: roleId,
        target: randomUUID(),
        role: 'Build',
        model: 'test',
        communicate: true,
        requestWork: true,
      },
    ],
    maxConcurrent: 2,
    maxDispatches: 50,
    expiresAt: now + 86400000,
    recover: false,
    acceptBy: 'human',
  }
  const assignments = new Map<string, Assignment>()
  const script = vi.fn<typeof runScript>(async () => ({
    success: true,
    exitCode: 0,
    stdout: 'checked',
    stderr: '',
  }))
  const save = vi.fn(() => ({ itemId: randomUUID(), revision: 1 }))
  const reviewed = vi.fn(() => false)
  const assign = vi.fn(
    async (
      run: ProcessRun,
      node: Extract<ProcessStep, { type: 'ai' }>,
      _inputs: unknown,
      id: string,
    ) => {
      const a: Assignment = {
        id,
        spaceId,
        title: node.title,
        brief: node.brief,
        roleId,
        acceptance: node.acceptance,
        dependsOn: [],
        resources: [],
        inputs: [],
        folderId,
        workflowRevision: 1,
        state: 'active',
        reason: '',
        objective: { id: run.rootId, title: run.objective },
      }
      assignments.set(id, a)
      return a
    },
  )
  const adapters = {
    check: (actor: CommunicationActor, id: string) => {
      if (revoked || id !== spaceId || (actor.spaceId && actor.spaceId !== id))
        throw Error('Scope denied')
    },
    policy: () => policy,
    project: () => ({ root: tmpdir(), paused: false, expiresAt: policy.expiresAt }),
    context: () => [{ body: 'untrusted context' }],
    save,
    reviewed,
    assign,
    assignment: (id: string) => {
      const a = assignments.get(id)
      if (!a) throw Error('Unknown assignment')
      return a
    },
    script,
  }
  let engine = new ProcessEngine(store, adapters, () => now)
  cleanup.push(() => {
    engine.close()
    db.close()
  })
  const graph = (
    nodes: ProcessStep[],
    edges: ProcessDefinition['edges'] = [],
  ): ProcessDefinition => ({
    schemaVersion: 1,
    id: randomUUID(),
    spaceId,
    revision: 1,
    name: 'Fixture',
    nodes,
    edges,
    trigger: { type: 'manual' },
    maxConcurrent: 2,
    maxOperations: 50,
  })
  const saveGraph = (d: ProcessDefinition) =>
    engine.execute(
      'save_process',
      { operationId: randomUUID(), expectedRevision: d.revision - 1, definition: d },
      human,
    )
  const authorize = (d: ProcessDefinition, triggers = false) =>
    engine.execute(
      'authorize_process',
      { operationId: randomUUID(), spaceId, definitionId: d.id, revision: d.revision, triggers },
      human,
    )
  const invoke = (d: ProcessDefinition, operationId = randomUUID(), actor = human) =>
    engine.execute(
      'invoke_process',
      {
        operationId,
        spaceId,
        definitionId: d.id,
        revision: d.revision,
        objective: 'Check implementation',
      },
      actor,
    ) as Promise<ProcessRun>
  const ticks = async (n = 6) => {
    for (let i = 0; i < n; i++) {
      await engine.tick()
      await Promise.resolve()
    }
  }
  return {
    db,
    store,
    spaceId,
    roleId,
    folderId,
    policy,
    graph,
    script,
    assign,
    save,
    reviewed,
    assignments,
    saveGraph,
    authorize,
    invoke,
    ticks,
    get engine() {
      return engine
    },
    get now() {
      return now
    },
    setTime: (time: number) => {
      now = time
    },
    revoke: () => {
      revoked = true
    },
    restart: () => {
      engine.close()
      engine = new ProcessEngine(store, adapters, () => now)
    },
  }
}
const step = (type: ProcessStep['type'], id: string = type) => newProcessStep(type, id)
const edge = (from: string, to: string, route: 'always' | 'success' | 'failure' = 'always') => ({
  from,
  to,
  route,
})

it('waits for acceptance of the exact saved revision and retains a separate execution outcome', async () => {
  const f = fixture(),
    d = f.graph(
      [
        { ...step('save'), type: 'save', folderId: f.folderId, body: 'Evidence' } as ProcessStep,
        {
          ...step('review'),
          type: 'review',
          inputs: {
            itemId: { node: 'save', field: 'itemId' },
            revision: { node: 'save', field: 'revision' },
          },
        } as ProcessStep,
        step('finish'),
      ],
      [edge('save', 'review'), edge('review', 'finish')],
    )
  await f.saveGraph(d)
  await f.authorize(d)
  await f.invoke(d)
  await f.ticks()
  expect(f.engine.runs()[0]!.nodes.review!.status).toBe('waiting')
  expect(f.engine.runs()[0]!.status).toBe('running')
  f.reviewed.mockReturnValue(true)
  await f.ticks()
  expect(f.engine.runs()[0]!.status).toBe('completed')
  expect(f.save).toHaveBeenCalledTimes(1)
})

it('cancels an active script without advancing into the next side effect', async () => {
  const f = fixture()
  let signal: AbortSignal | undefined
  f.script.mockImplementation(async (_node, _input, _root, s) => {
    signal = s
    return new Promise(() => {})
  })
  const d = f.graph(
    [
      {
        ...step('script'),
        type: 'script',
        executable: process.execPath,
        cwd: tmpdir(),
        args: [],
        environment: {},
        timeoutMs: 1000,
        access: 'local-user',
      } as ProcessStep,
      { ...step('save'), type: 'save', folderId: f.folderId, body: 'Must not save' } as ProcessStep,
      step('finish'),
    ],
    [edge('script', 'save'), edge('save', 'finish')],
  )
  await f.saveGraph(d)
  await f.authorize(d)
  const r = await f.invoke(d)
  await f.ticks(1)
  await f.engine.execute(
    'control_process',
    { operationId: randomUUID(), spaceId: f.spaceId, runId: r.id, action: 'cancel' },
    human,
  )
  await f.ticks()
  expect(signal?.aborted).toBe(true)
  expect(f.save).not.toHaveBeenCalled()
  expect(f.engine.runs()[0]!.status).toBe('cancelled')
})

it('deduplicates a repeated DST slot even after intervening schedule slots', async () => {
  const f = fixture()
  f.setTime(Date.UTC(2026, 9, 25, 0, 29))
  const d = {
    ...f.graph([step('finish')]),
    trigger: {
      type: 'cron',
      expression: '* * * * *',
      timezone: 'Europe/London',
      missed: 'skip',
      overlap: 'skip',
    } as const,
  }
  await f.saveGraph(d)
  await f.authorize(d, true)
  f.setTime(Date.UTC(2026, 9, 25, 0, 30))
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(1)
  f.setTime(Date.UTC(2026, 9, 25, 0, 31))
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(2)
  f.setTime(Date.UTC(2026, 9, 25, 1, 30))
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(2)
})

it('caps concurrent script adapters and joins actual finished paths', async () => {
  const f = fixture(),
    resolves: Array<
      (v: { success: boolean; exitCode: number; stdout: string; stderr: string }) => void
    > = []
  f.script.mockImplementation(() => new Promise((resolve) => resolves.push(resolve)))
  const scripts = ['a', 'b', 'c'].map(
    (id) =>
      ({
        ...step('script', id),
        type: 'script',
        executable: process.execPath,
        cwd: tmpdir(),
        args: [],
        environment: {},
        timeoutMs: 1000,
        access: 'local-user',
      }) as ProcessStep,
  )
  const d = f.graph(
    [...scripts, step('join'), step('finish')],
    [...scripts.map((n) => edge(n.id, 'join')), edge('join', 'finish')],
  )
  await f.saveGraph(d)
  await f.authorize(d)
  await f.invoke(d)
  await f.ticks(1)
  expect(f.script).toHaveBeenCalledTimes(2)
  resolves[0]!({ success: true, exitCode: 0, stdout: 'first', stderr: '' })
  await Promise.resolve()
  await f.ticks(1)
  expect(f.script).toHaveBeenCalledTimes(3)
  expect(f.engine.runs()[0]!.nodes.join!.status).toBe('pending')
  resolves
    .slice(1)
    .forEach((resolve) => resolve({ success: true, exitCode: 0, stdout: 'done', stderr: '' }))
  await Promise.resolve()
  await f.ticks()
  expect(f.engine.runs()[0]!.status).toBe('completed')
})

it('triggers once on a scoped submission milestone and does not backfill existing submissions', async () => {
  const f = fixture(),
    id = randomUUID()
  f.assignments.set(id, {
    id,
    spaceId: f.spaceId,
    title: 'Implementation',
    brief: 'Implement',
    roleId: f.roleId,
    acceptance: 'Review',
    dependsOn: [],
    resources: [],
    inputs: [],
    folderId: f.folderId,
    workflowRevision: 1,
    state: 'active',
    reason: '',
  })
  const d = {
    ...f.graph([step('finish')]),
    trigger: { type: 'assignment', assignmentId: id, milestone: 'submitted' } as const,
  }
  await f.saveGraph(d)
  await f.authorize(d, true)
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(0)
  f.assignments.get(id)!.state = 'submitted'
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(1)
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(1)
  const later = { ...d, id: randomUUID() }
  await f.saveGraph(later)
  await f.authorize(later, true)
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(1)
})

it('pins nested routine inputs and rejects excessive depth', async () => {
  const f = fixture()
  let d = f.graph([{ ...step('finish'), inputs: { value: { node: '$input', field: 'value' } } }])
  await f.saveGraph(d)
  await f.authorize(d)
  for (let level = 0; level < 3; level++) {
    d = f.graph(
      [
        {
          ...step('routine'),
          type: 'routine',
          definitionId: d.id,
          revision: 1,
          maxAttempts: 1,
          inputs: { value: { node: '$input', field: 'value' } },
        } as ProcessStep,
        step('finish'),
      ],
      [edge('routine', 'finish')],
    )
    await f.saveGraph(d)
    await f.authorize(d)
  }
  await f.engine.execute(
    'invoke_process',
    {
      operationId: randomUUID(),
      spaceId: f.spaceId,
      definitionId: d.id,
      revision: 1,
      objective: 'Nested',
      input: { value: 'Pinned data' },
    },
    human,
  )
  await f.ticks(15)
  expect(f.engine.runs().find((r) => !r.parentId)?.status).toBe('completed')
  expect(f.engine.runs().some((r) => r.nodes.finish?.output?.value === 'Pinned data')).toBe(true)
  const tooDeep = f.graph(
    [
      {
        ...step('routine'),
        type: 'routine',
        definitionId: d.id,
        revision: 1,
        maxAttempts: 1,
      } as ProcessStep,
      step('finish'),
    ],
    [edge('routine', 'finish')],
  )
  await expect(f.saveGraph(tooDeep)).rejects.toThrow(/depth/)
})

it('rejects cycles, dangling ports, forged properties, missing data and recursive routines', async () => {
  const f = fixture(),
    d = f.graph([step('join', 'a'), step('finish')], [edge('a', 'finish'), edge('finish', 'a')])
  expect(() => validateGraph(d)).toThrow(/Cycles/)
  expect(() => validateGraph({ ...d, edges: [edge('a', 'missing')] })).toThrow(/existing/)
  expect(() => validateGraph({ ...d, edges: [], authority: 'human' })).toThrow()
  expect(() =>
    validateGraph(
      f.graph([
        { ...step('condition'), type: 'condition', input: 'ok', equals: true } as ProcessStep,
        step('finish'),
      ]),
    ),
  ).toThrow(/bind/)
  const routine = f.graph([step('finish')])
  await f.saveGraph(routine)
  await expect(
    f.saveGraph({
      ...routine,
      revision: 2,
      nodes: [
        {
          ...step('routine'),
          type: 'routine',
          definitionId: routine.id,
          revision: 1,
          maxAttempts: 2,
        },
        step('finish'),
      ],
    }),
  ).rejects.toThrow(/recursion/)
})

it('keeps legacy authority unchanged; edits are drafts, authorization is human-only, operations deduplicate', async () => {
  const f = fixture(),
    d = f.graph([step('finish')]),
    agent: CommunicationActor = { id: 'brainstorm', kind: 'agent', spaceId: f.spaceId }
  await f.engine.execute(
    'save_process',
    { operationId: randomUUID(), expectedRevision: 0, definition: d },
    agent,
  )
  expect(f.engine.runs()).toHaveLength(0)
  await expect(f.invoke(d)).rejects.toThrow(/Human authorization/)
  await expect(
    f.engine.execute(
      'authorize_process',
      {
        operationId: randomUUID(),
        spaceId: f.spaceId,
        definitionId: d.id,
        revision: 1,
        triggers: false,
      },
      agent,
    ),
  ).rejects.toThrow(/Only the human/)
  await f.authorize(d)
  const op = randomUUID(),
    run = await f.invoke(d, op, agent)
  expect((await f.invoke(d, op, agent)).id).toBe(run.id)
  await expect(
    f.engine.execute(
      'invoke_process',
      {
        operationId: op,
        spaceId: f.spaceId,
        definitionId: d.id,
        revision: 1,
        objective: 'Changed',
      },
      agent,
    ),
  ).rejects.toThrow(/different input/)
  await f.saveGraph({ ...d, revision: 2, name: 'Edited' })
  expect(f.engine.runs()[0]!.definition.name).toBe('Fixture')
  await f.ticks()
  expect(f.engine.runs()[0]!.status).toBe('completed')
  await expect(f.invoke({ ...d, revision: 2 })).rejects.toThrow(/authorization/)
  expect(f.policy.revision).toBe(1)
})

it('executes mixed checks, branch, saved evidence and bounded correction routine without treating completion as acceptance', async () => {
  const f = fixture()
  f.script
    .mockResolvedValueOnce({ success: false, exitCode: 1, stdout: 'failure', stderr: '' })
    .mockResolvedValue({ success: true, exitCode: 0, stdout: 'pass', stderr: '' })
  const check = {
    ...step('script', 'check'),
    type: 'script',
    executable: process.execPath,
    cwd: tmpdir(),
    args: [],
    environment: {},
    timeoutMs: 1000,
    access: 'local-user',
  } as ProcessStep
  const condition = {
    ...step('condition', 'branch'),
    type: 'condition',
    input: 'ok',
    equals: true,
    inputs: { ok: { node: 'check', field: 'success' } },
  } as ProcessStep
  const fix = {
    ...step('ai', 'fix'),
    type: 'ai',
    roleId: f.roleId,
    folderId: f.folderId,
    brief: 'Fix failed checks',
    acceptance: 'Checks pass',
    items: [],
    milestone: 'submitted',
    inputs: { failure: { node: 'check', field: 'stdout' } },
  } as ProcessStep
  const save = {
    ...step('save', 'evidence'),
    type: 'save',
    folderId: f.folderId,
    body: 'Evidence',
    inputs: { log: { node: 'check', field: 'stdout' } },
  } as ProcessStep
  const routine = f.graph(
    [
      check,
      condition,
      fix,
      save,
      { ...step('finish', 'pass'), type: 'finish', success: true } as ProcessStep,
      { ...step('finish', 'retry'), type: 'finish', success: false } as ProcessStep,
    ],
    [
      edge('check', 'branch'),
      edge('branch', 'fix', 'failure'),
      edge('branch', 'evidence', 'success'),
      edge('fix', 'retry'),
      edge('evidence', 'pass'),
    ],
  )
  await f.saveGraph(routine)
  await f.authorize(routine)
  const parent = f.graph(
    [
      {
        ...step('routine', 'repair'),
        type: 'routine',
        definitionId: routine.id,
        revision: 1,
        maxAttempts: 3,
      } as ProcessStep,
      step('finish'),
    ],
    [edge('repair', 'finish')],
  )
  await f.saveGraph(parent)
  await f.authorize(parent)
  const run = await f.invoke(parent)
  await f.ticks(6)
  expect(f.assign).toHaveBeenCalledTimes(1)
  const assignment = [...f.assignments.values()][0]!
  expect(f.engine.runs().find((r) => r.id === run.id)?.status).toBe('running')
  assignment.state = 'submitted'
  assignment.result = 'Correction ready'
  assignment.outputs = []
  await f.ticks(14)
  expect(f.script).toHaveBeenCalledTimes(2)
  expect(f.save).toHaveBeenCalledTimes(1)
  expect(f.engine.runs().find((r) => r.id === run.id)).toMatchObject({
    status: 'completed',
    success: true,
  })
  expect(assignment.state).toBe('submitted')
})

it('retains exhausted attempts as Needs you and caps nested work', async () => {
  const f = fixture(),
    routine = f.graph([{ ...step('finish'), type: 'finish', success: false } as ProcessStep])
  await f.saveGraph(routine)
  await f.authorize(routine)
  const d = f.graph(
    [
      {
        ...step('routine'),
        type: 'routine',
        definitionId: routine.id,
        revision: 1,
        maxAttempts: 3,
      } as ProcessStep,
      step('finish'),
    ],
    [edge('routine', 'finish')],
  )
  await f.saveGraph(d)
  await f.authorize(d)
  const r = await f.invoke(d)
  await f.ticks(15)
  expect(f.engine.runs().find((x) => x.id === r.id)).toMatchObject({
    status: 'needs_you',
    reason: expect.stringContaining('3 attempts'),
  })
  expect(f.engine.runs().filter((x) => x.parentId === r.id)).toHaveLength(3)
})

it('joins parallel waits only after both paths, pauses and cancels without new effects', async () => {
  const f = fixture(),
    d = f.graph(
      [
        { ...step('wait', 'a'), type: 'wait', durationMs: 100 } as ProcessStep,
        { ...step('wait', 'b'), type: 'wait', durationMs: 200 } as ProcessStep,
        step('join'),
        step('finish'),
      ],
      [edge('a', 'join'), edge('b', 'join'), edge('join', 'finish')],
    )
  await f.saveGraph(d)
  await f.authorize(d)
  const r = await f.invoke(d)
  await f.ticks(1)
  f.setTime(f.now + 100)
  await f.ticks(2)
  expect(f.engine.runs()[0]!.nodes.join!.status).toBe('pending')
  await f.engine.execute(
    'control_process',
    { operationId: randomUUID(), spaceId: f.spaceId, runId: r.id, action: 'pause' },
    human,
  )
  f.setTime(f.now + 200)
  await f.ticks()
  expect(f.engine.runs()[0]!.status).toBe('paused')
  await f.engine.execute(
    'control_process',
    { operationId: randomUUID(), spaceId: f.spaceId, runId: r.id, action: 'resume' },
    human,
  )
  await f.ticks()
  expect(f.engine.runs()[0]!.status).toBe('completed')
})

it('never replays uncertain script side effects after restart; requires explicit reconciliation', async () => {
  const f = fixture()
  f.script.mockImplementation(() => new Promise(() => {}))
  const d = f.graph(
    [
      {
        ...step('script'),
        type: 'script',
        executable: process.execPath,
        cwd: tmpdir(),
        args: [],
        environment: {},
        timeoutMs: 1000,
        access: 'local-user',
      } as ProcessStep,
      step('finish'),
    ],
    [edge('script', 'finish')],
  )
  await f.saveGraph(d)
  await f.authorize(d)
  const r = await f.invoke(d)
  await f.ticks(1)
  f.restart()
  await f.ticks()
  expect(f.script).toHaveBeenCalledTimes(1)
  expect(f.engine.runs()[0]!.nodes.script!.status).toBe('uncertain')
  await expect(
    f.engine.execute(
      'control_process',
      { operationId: randomUUID(), spaceId: f.spaceId, runId: r.id, action: 'resume' },
      human,
    ),
  ).rejects.toThrow(/Reconcile/)
  await f.engine.execute(
    'reconcile_process',
    {
      operationId: randomUUID(),
      spaceId: f.spaceId,
      runId: r.id,
      nodeId: 'script',
      evidence: 'Inspected isolated command evidence',
      outcome: 'completed',
      output: { success: true, exitCode: 0, stdout: 'Recovered evidence', stderr: '' },
    },
    human,
  )
  await f.engine.execute(
    'control_process',
    { operationId: randomUUID(), spaceId: f.spaceId, runId: r.id, action: 'resume' },
    human,
  )
  await f.ticks()
  expect(f.script).toHaveBeenCalledTimes(1)
  expect(f.engine.runs()[0]!.status).toBe('completed')
})

it('schedules use explicit timezone, skip missed and overlapping slots, and deduplicate fall-back local minutes', async () => {
  const trigger = {
    type: 'cron',
    expression: '* * * * *',
    timezone: 'Europe/London',
    missed: 'skip',
    overlap: 'skip',
  } as const
  expect(cronSlot(trigger, Date.UTC(2026, 9, 25, 0, 30))).toBe(
    cronSlot(trigger, Date.UTC(2026, 9, 25, 1, 30)),
  )
  const f = fixture(),
    d = {
      ...f.graph(
        [{ ...step('wait'), type: 'wait', durationMs: 600000 } as ProcessStep, step('finish')],
        [edge('wait', 'finish')],
      ),
      trigger,
    }
  await f.saveGraph(d)
  await f.authorize(d, true)
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(0)
  f.setTime(f.now + 60000)
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(1)
  f.setTime(f.now + 5 * 60000)
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(1)
  f.revoke()
  f.setTime(f.now + 600000)
  await f.ticks()
  expect(f.engine.runs()).toHaveLength(1)
})

it('runs a real script through durable bounded attempts in a temporary workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-loop-')),
    f = fixture()
  try {
    f.script.mockImplementation(runScript)
    const routine = f.graph(
      [
        {
          ...step('script', 'check'),
          type: 'script',
          executable: process.execPath,
          cwd: root,
          args: [
            '-e',
            "const fs=require('fs');const n=fs.existsSync('attempt')?2:1;fs.writeFileSync('attempt',String(n));process.stdout.write('attempt '+n);process.exit(n===2?0:1)",
          ],
          environment: {},
          timeoutMs: 3000,
          access: 'local-user',
        } as ProcessStep,
        {
          ...step('condition', 'branch'),
          type: 'condition',
          input: 'ok',
          equals: true,
          inputs: { ok: { node: 'check', field: 'success' } },
        } as ProcessStep,
        { ...step('finish', 'pass'), type: 'finish', success: true } as ProcessStep,
        { ...step('finish', 'fail'), type: 'finish', success: false } as ProcessStep,
      ],
      [
        edge('check', 'branch'),
        edge('branch', 'pass', 'success'),
        edge('branch', 'fail', 'failure'),
      ],
    )
    await f.saveGraph(routine)
    await f.authorize(routine)
    const d = f.graph(
      [
        {
          ...step('routine'),
          type: 'routine',
          definitionId: routine.id,
          revision: 1,
          maxAttempts: 3,
        } as ProcessStep,
        step('finish'),
      ],
      [edge('routine', 'finish')],
    )
    await f.saveGraph(d)
    await f.authorize(d)
    const run = await f.invoke(d)
    await vi.waitFor(
      async () => {
        await f.ticks()
        expect(f.engine.runs().find((r) => r.id === run.id)?.status).toBe('completed')
      },
      { timeout: 5000 },
    )
    expect(f.script).toHaveBeenCalledTimes(2)
    expect(
      f.engine
        .runs()
        .filter((r) => r.parentId === run.id)
        .map((r) => r.nodes.check!.output!.exitCode),
    ).toEqual([1, 0])
  } finally {
    f.engine.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('executes a real harmless script with explicit environment and rejects cwd escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadlight-workflow-'))
  try {
    const node = {
      ...step('script'),
      type: 'script',
      executable: process.execPath,
      cwd: root,
      args: ['-e', 'process.stdout.write(process.env.WORKFLOW_FIXTURE || "missing")'],
      environment: { WORKFLOW_FIXTURE: 'isolated' },
      timeoutMs: 3000,
      access: 'local-user',
    } as Extract<ProcessStep, { type: 'script' }>
    expect(await runScript(node, {}, root, new AbortController().signal)).toMatchObject({
      success: true,
      stdout: 'isolated',
    })
    await expect(
      runScript({ ...node, cwd: tmpdir() }, {}, root, new AbortController().signal),
    ).rejects.toThrow(/outside/)
    await expect(
      runScript(
        { ...node, args: ['-e', 'setTimeout(()=>{},10000)'], timeoutMs: 100 },
        {},
        root,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/interrupted/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
