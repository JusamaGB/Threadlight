import { z } from 'zod'

const id = z.string().uuid()
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
const text = z.string().trim().min(1).max(8000)
export const pinnedInput = z.object({ itemId: id, revision: z.number().int().positive() }).strict()
const binding = z.object({ node: z.union([key, z.literal('$input')]), field: key }).strict()
export const inputBindings = z.record(key, binding)
const base = {
  id: key,
  title: z.string().trim().min(1).max(80),
  x: z.number().min(0).max(20000).default(0),
  y: z.number().min(0).max(20000).default(0),
  inputs: inputBindings.default({}),
}
export const stepSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('context'), items: z.array(pinnedInput).max(30) }).strict(),
  z
    .object({
      ...base,
      type: z.literal('script'),
      executable: text,
      args: z.array(z.string().max(2000)).max(40),
      cwd: text,
      environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4000)),
      timeoutMs: z.number().int().min(100).max(300000),
      access: z.literal('local-user'),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('ai'),
      roleId: id,
      folderId: id,
      brief: text,
      acceptance: text,
      items: z.array(pinnedInput).max(30),
      milestone: z.enum(['submitted', 'accepted']),
    })
    .strict(),
  z.object({ ...base, type: z.literal('save'), folderId: id, body: text }).strict(),
  z
    .object({
      ...base,
      type: z.literal('condition'),
      input: key,
      equals: z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]),
    })
    .strict(),
  z.object({ ...base, type: z.literal('join') }).strict(),
  z.object({ ...base, type: z.literal('review') }).strict(),
  z
    .object({ ...base, type: z.literal('wait'), durationMs: z.number().int().min(0).max(86400000) })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('routine'),
      definitionId: id,
      revision: z.number().int().positive(),
      maxAttempts: z.number().int().min(1).max(10),
    })
    .strict(),
  z.object({ ...base, type: z.literal('finish'), success: z.boolean() }).strict(),
])
export const graphSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    spaceId: id,
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    nodes: z.array(stepSchema).min(1).max(80),
    edges: z
      .array(
        z.object({ from: key, to: key, route: z.enum(['always', 'success', 'failure']) }).strict(),
      )
      .max(200),
    trigger: z.discriminatedUnion('type', [
      z.object({ type: z.literal('manual') }).strict(),
      z
        .object({
          type: z.literal('assignment'),
          assignmentId: id,
          milestone: z.enum(['completed', 'submitted', 'accepted']),
        })
        .strict(),
      z
        .object({
          type: z.literal('cron'),
          expression: z.string().min(1).max(100),
          timezone: z.string().min(1).max(100),
          missed: z.literal('skip'),
          overlap: z.literal('skip'),
        })
        .strict(),
    ]),
    maxConcurrent: z.number().int().min(1).max(4),
    maxOperations: z.number().int().min(1).max(200),
  })
  .strict()
export type ProcessDefinition = z.infer<typeof graphSchema>
export type ProcessStep = z.infer<typeof stepSchema>
export type StepOutput = Record<string, unknown>
export function workflowError(error: unknown): string {
  return error instanceof z.ZodError
    ? error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'Workflow'}: ${issue.message}`)
        .join('; ')
    : error instanceof Error
      ? error.message
      : 'Workflow unavailable.'
}
export interface ProcessNodeState {
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'skipped' | 'uncertain' | 'failed'
  operationId: string
  output?: StepOutput
  error?: string
  route?: 'success' | 'failure'
  wakeAt?: number
  assignmentId?: string
  childId?: string
  attempts?: number
}
export interface ProcessRun {
  id: string
  spaceId: string
  objective: string
  definition: ProcessDefinition
  routines: ProcessDefinition[]
  policyRevision: number
  actor: {
    id: string
    kind: 'human' | 'agent' | 'participant'
    target?: string
    spaceId?: string
    folderId?: string | null
  }
  status: 'running' | 'paused' | 'needs_you' | 'completed' | 'cancelled'
  nodes: Record<string, ProcessNodeState>
  startedAt: number
  updatedAt: number
  reason: string
  success?: boolean
  parentId?: string
  rootId: string
  operations: number
  input?: StepOutput
}
export interface ProcessGrant {
  definitionId: string
  revision: number
  policyRevision: number
  expiresAt: number
  triggers: boolean
}
export const processRunSchema: z.ZodType<ProcessRun> = z
  .object({
    id,
    spaceId: id,
    objective: z.string().min(1).max(80),
    definition: graphSchema,
    routines: z.array(graphSchema).max(320),
    policyRevision: z.number().int().positive(),
    actor: z
      .object({
        id: z.string().max(512),
        kind: z.enum(['human', 'agent', 'participant']),
        target: z.string().max(512).optional(),
        spaceId: id.optional(),
        folderId: id.nullable().optional(),
      })
      .strict(),
    status: z.enum(['running', 'paused', 'needs_you', 'completed', 'cancelled']),
    nodes: z.record(
      key,
      z
        .object({
          status: z.enum([
            'pending',
            'running',
            'waiting',
            'completed',
            'skipped',
            'uncertain',
            'failed',
          ]),
          operationId: id,
          output: z.record(z.string(), z.json()).optional(),
          error: z.string().max(100000).optional(),
          route: z.enum(['success', 'failure']).optional(),
          wakeAt: z.number().finite().optional(),
          assignmentId: id.optional(),
          childId: id.optional(),
          attempts: z.number().int().min(1).max(10).optional(),
        })
        .strict(),
    ),
    startedAt: z.number().finite(),
    updatedAt: z.number().finite(),
    reason: z.string().max(100000),
    success: z.boolean().optional(),
    parentId: id.optional(),
    rootId: id,
    operations: z.number().int().nonnegative().max(200),
    input: z.record(z.string(), z.json()).optional(),
  })
  .strict()
export function parseProcessRun(raw: unknown): ProcessRun {
  const run = processRunSchema.parse(raw)
  validateGraph(run.definition)
  run.routines.forEach(validateGraph)
  if (
    run.definition.spaceId !== run.spaceId ||
    run.routines.some((d) => d.spaceId !== run.spaceId) ||
    (run.actor.spaceId && run.actor.spaceId !== run.spaceId)
  )
    throw new Error('Run contains cross-project state.')
  if (
    run.definition.nodes.length !== Object.keys(run.nodes).length ||
    run.definition.nodes.some((n) => !run.nodes[n.id])
  )
    throw new Error('Run node state does not match its pinned graph.')
  return run
}
export const processSchemas = {
  save_process: z
    .object({
      operationId: id,
      expectedRevision: z.number().int().nonnegative(),
      definition: graphSchema,
    })
    .strict(),
  invoke_process: z
    .object({
      operationId: id,
      spaceId: id,
      definitionId: id,
      revision: z.number().int().positive(),
      objective: z.string().trim().min(1).max(80),
      input: z.record(key, z.json()).default({}),
    })
    .strict(),
  control_process: z
    .object({
      operationId: id,
      spaceId: id,
      runId: id,
      action: z.enum(['pause', 'resume', 'cancel']),
    })
    .strict(),
  authorize_process: z
    .object({
      operationId: id,
      spaceId: id,
      definitionId: id,
      revision: z.number().int().positive(),
      triggers: z.boolean(),
    })
    .strict(),
  reconcile_process: z
    .object({
      operationId: id,
      spaceId: id,
      runId: id,
      nodeId: key,
      evidence: text,
      outcome: z.enum(['completed', 'failed']),
      output: z.record(key, z.json()).default({}),
    })
    .strict(),
}

/** No expressions, dynamic code, hidden ports or inferred back edges. */
export function validateGraph(raw: unknown): ProcessDefinition {
  if (JSON.stringify(raw).length > 128000) throw new Error('Workflow definition exceeds 128 KB.')
  const g = graphSchema.parse(raw)
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  if (nodes.size !== g.nodes.length) throw new Error('Step IDs must be distinct.')
  const edges = new Set<string>()
  for (const e of g.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to)
      throw new Error('Connect distinct existing steps.')
    const identity = `${e.from}:${e.to}:${e.route}`
    if (edges.has(identity)) throw new Error('Duplicate connection.')
    edges.add(identity)
    if (e.route !== 'always' && nodes.get(e.from)?.type !== 'condition')
      throw new Error('Only conditions have success/failure ports.')
  }
  const visiting = new Set<string>(),
    visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Cycles require a bounded routine step.')
    if (visited.has(id)) return
    visiting.add(id)
    g.edges.filter((e) => e.from === id).forEach((e) => visit(e.to))
    visiting.delete(id)
    visited.add(id)
  }
  g.nodes.forEach((n) => visit(n.id))
  const ancestorCache = new Map<string, Set<string>>()
  const ancestors = (id: string): Set<string> => {
    const cached = ancestorCache.get(id)
    if (cached) return cached
    const result = new Set(
      g.edges.filter((e) => e.to === id).flatMap((e) => [e.from, ...ancestors(e.from)]),
    )
    ancestorCache.set(id, result)
    return result
  }
  for (const n of g.nodes) {
    for (const b of Object.values(n.inputs)) {
      if (b.node !== '$input' && !ancestors(n.id).has(b.node))
        throw new Error(`${n.title}: input must reference a predecessor.`)
      if (b.node !== '$input') {
        const source = nodes.get(b.node)!
        const fields: readonly string[] = stepContracts[source.type].outputs
        if (!fields.includes(b.field) && !(source.type === 'finish' && source.inputs[b.field]))
          throw new Error(`${n.title}: ${b.field} is not an output of ${source.type}.`)
      }
    }
    if (n.type === 'condition' && !n.inputs[n.input])
      throw new Error(`${n.title}: bind the condition input.`)
    if (n.type === 'review' && (!n.inputs.itemId || !n.inputs.revision))
      throw new Error(`${n.title}: bind itemId and revision to saved evidence.`)
    if (n.type === 'finish' && g.edges.some((e) => e.from === n.id))
      throw new Error('Finish steps cannot have outgoing connections.')
  }
  if (!g.nodes.some((n) => n.type === 'finish'))
    throw new Error('Add a finish step with an explicit success outcome.')
  if (g.trigger.type === 'cron') {
    cronFields(g.trigger.expression)
    new Intl.DateTimeFormat('en', { timeZone: g.trigger.timezone }).format(0)
  }
  return g
}

// Deliberately small five-field cron grammar: *, */n, integer, comma lists.
export function cronFields(expression: string): Set<number>[] {
  const parts = expression.trim().split(/\s+/)
  const bounds = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ]
  if (parts.length !== 5)
    throw new Error('Cron requires five fields: minute hour day month weekday.')
  return parts.map((part, i) => {
    const [min, max] = bounds[i]!,
      result = new Set<number>()
    for (const token of part.split(',')) {
      if (token === '*' || /^\*\/[1-9]\d*$/.test(token)) {
        const step = token === '*' ? 1 : Number(token.slice(2))
        if (step > max! + 1) throw new Error('Cron interval is out of range.')
        for (let n = min!; n <= max!; n += step) result.add(n)
      } else if (/^\d+$/.test(token) && Number(token) >= min! && Number(token) <= max!)
        result.add(Number(token))
      else throw new Error('Use cron integers, lists, * or */n within field limits.')
    }
    return result
  })
}
export function cronSlot(
  trigger: Extract<ProcessDefinition['trigger'], { type: 'cron' }>,
  now: number,
): string | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: trigger.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now)
  const p = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  const fields = cronFields(trigger.expression)
  const values = [
    Number(p.minute),
    Number(p.hour),
    Number(p.day),
    Number(p.month),
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!),
  ]
  return values.every((n, i) => fields[i]!.has(n))
    ? `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
    : null
}

export const stepContracts = {
  context: { outputs: ['items'], effect: 'read' },
  script: { outputs: ['success', 'exitCode', 'stdout', 'stderr'], effect: 'external' },
  ai: { outputs: ['assignmentId', 'result', 'outputs'], effect: 'assignment' },
  save: { outputs: ['itemId', 'revision'], effect: 'write' },
  condition: { outputs: ['success'], effect: 'pure' },
  join: { outputs: ['inputs'], effect: 'pure' },
  review: { outputs: ['itemId', 'revision', 'accepted'], effect: 'read' },
  wait: { outputs: ['waited'], effect: 'pure' },
  routine: { outputs: ['success', 'runId', 'attempts'], effect: 'routine' },
  finish: { outputs: ['success'], effect: 'pure' },
} as const

/** Every execution adapter returns JSON data, with this versioned output contract.
 * Adapter errors are held for review; no type implicitly opts into replay. */
export function parseStepOutput(step: ProcessStep, raw: unknown): StepOutput {
  const outputs: Record<ProcessStep['type'], z.ZodType> = {
    context: z.object({ items: z.array(z.json()).max(30) }).strict(),
    script: z
      .object({
        success: z.boolean(),
        exitCode: z.number().int().nullable(),
        stdout: z.string().max(48000),
        stderr: z.string().max(48000),
      })
      .strict(),
    ai: z
      .object({
        assignmentId: id,
        result: z.string().max(48000),
        outputs: z.array(pinnedInput).max(30),
      })
      .strict(),
    save: z.object({ itemId: id, revision: z.number().int().positive() }).strict(),
    condition: z.object({ success: z.boolean() }).strict(),
    join: z.object({ inputs: z.record(z.string(), z.json()) }).strict(),
    review: z
      .object({ itemId: id, revision: z.number().int().positive(), accepted: z.literal(true) })
      .strict(),
    wait: z.object({ waited: z.literal(true) }).strict(),
    routine: z
      .object({ success: z.boolean(), runId: id, attempts: z.number().int().min(1).max(10) })
      .strict(),
    finish: z.object({ success: z.boolean() }).catchall(z.json()),
  }
  const output = outputs[step.type].parse(raw) as StepOutput
  if (JSON.stringify(output).length > 60000) throw new Error('Step output exceeds 60 KB.')
  if (step.type === 'finish' && output.success !== step.success)
    throw new Error('Finish outcome differs from its saved definition.')
  if (step.type === 'script' && output.success !== (output.exitCode === 0))
    throw new Error('Script success must match its exit code.')
  return output
}
