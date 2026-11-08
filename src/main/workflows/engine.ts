import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { isAbsolute, relative } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { CommunicationActor, Assignment, Workflow } from '../../shared/communication'
import {
  cronSlot,
  processSchemas,
  validateGraph,
  parseProcessRun,
  parseStepOutput,
  type ProcessDefinition,
  type ProcessGrant,
  type ProcessRun,
  type ProcessStep,
  type StepOutput,
} from '../../shared/workflowGraph'
import type { CommunicationStore } from '../communication/store'
import { initializeProcessStorage } from './storage'

export interface ProcessAdapters {
  validate?: (actor: CommunicationActor, node: ProcessStep) => void
  reviewed?: (actor: CommunicationActor, itemId: string, revision: number) => boolean
  check(actor: CommunicationActor, spaceId: string): void
  policy(spaceId: string): Workflow | undefined
  project(spaceId: string): { root?: string; paused: boolean; expiresAt: number }
  context(actor: CommunicationActor, items: { itemId: string; revision: number }[]): unknown
  save(
    run: ProcessRun,
    node: Extract<ProcessStep, { type: 'save' }>,
    body: string,
    operationId: string,
  ): unknown
  assign(
    run: ProcessRun,
    node: Extract<ProcessStep, { type: 'ai' }>,
    inputs: StepOutput,
    operationId: string,
  ): Promise<Assignment>
  assignment(id: string): Assignment
  script?: typeof runScript
}
const terminal = (status: string) => ['completed', 'skipped'].includes(status)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Explicit local-user execution; stdin is data, never interpolated into arguments. */
export async function runScript(
  node: Extract<ProcessStep, { type: 'script' }>,
  input: StepOutput,
  root: string,
  signal: AbortSignal,
): Promise<StepOutput> {
  if (!isAbsolute(node.cwd) || !isAbsolute(node.executable))
    throw new Error('Script executable and working directory must be absolute.')
  const [cwd, allowed, executable] = await Promise.all([
    realpath(node.cwd),
    realpath(root),
    realpath(node.executable),
  ])
  const rel = relative(allowed, cwd)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('Script working directory is outside the project root.')
  if (signal.aborted) throw new Error('Script cancelled before launch.')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, node.args, {
      cwd,
      env: node.environment,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    })
    let interrupted = false
    let stdout = '',
      stderr = '',
      overflow = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const capture = (data: string, error: boolean) => {
      if (error) stderr += data
      else stdout += data
      if (stdout.length + stderr.length > 48000) {
        overflow = true
        child.kill()
      }
    }
    child.stdout.on('data', (d) => capture(d, false))
    child.stderr.on('data', (d) => capture(d, true))
    const timer = setTimeout(() => {
      interrupted = true
      child.kill()
    }, node.timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(
        Object.assign(e, {
          partialOutput: {
            success: false,
            exitCode: null,
            stdout: stdout.slice(0, 24000),
            stderr: stderr.slice(0, 24000),
          },
        }),
      )
    })
    child.on('close', (code, killed) => {
      clearTimeout(timer)
      if (overflow || interrupted || killed || signal.aborted)
        reject(
          Object.assign(
            new Error(
              'Script interrupted or output limit reached; inspect side effects before continuing.',
            ),
            {
              partialOutput: {
                success: false,
                exitCode: null,
                stdout: stdout.slice(0, 24000),
                stderr: stderr.slice(0, 24000),
              },
            },
          ),
        )
      else resolve({ success: code === 0, exitCode: code, stdout, stderr })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ kind: 'untrusted-workflow-input', values: input }))
  })
}

export class ProcessEngine {
  private active = new Map<string, AbortController>()
  private pumping = false
  private closed = false
  private startupMinute: number
  constructor(
    readonly store: CommunicationStore,
    private adapters: ProcessAdapters,
    private now = Date.now,
  ) {
    this.startupMinute = Math.floor(now() / 60000)
    initializeProcessStorage(store.db)
    for (const run of this.runs()) {
      if (['completed', 'cancelled'].includes(run.status)) continue
      for (const state of Object.values(run.nodes))
        if (state.status === 'running') {
          state.status = 'uncertain'
          state.error = 'Restart interrupted the operation. Reconcile evidence; do not replay.'
        }
      run.status = Object.values(run.nodes).some((n) => n.status === 'uncertain')
        ? 'needs_you'
        : 'paused'
      run.reason = 'Recovered after restart; revalidate before resuming.'
      this.put(run)
    }
  }
  definitions(spaceId?: string): ProcessDefinition[] {
    const rows = this.store.db
      .prepare('SELECT data FROM process_definitions ORDER BY revision')
      .all()
      .map((r) => validateGraph(JSON.parse(String(r.data))))
    return rows.filter(
      (d) =>
        (!spaceId || d.spaceId === spaceId) &&
        !rows.some((x) => x.id === d.id && x.revision > d.revision),
    )
  }
  definition(id: string, revision: number): ProcessDefinition {
    const r = this.store.db
      .prepare('SELECT data FROM process_definitions WHERE id=? AND revision=?')
      .get(id, revision)
    if (!r) throw new Error('Workflow revision unavailable.')
    return validateGraph(JSON.parse(String(r.data)))
  }
  runs(spaceId?: string): ProcessRun[] {
    return this.store.db
      .prepare('SELECT data FROM process_runs')
      .all()
      .map((r) => parseProcessRun(JSON.parse(String(r.data))))
      .filter((r) => !spaceId || r.spaceId === spaceId)
  }
  private run(id: string) {
    const r = this.store.db.prepare('SELECT data FROM process_runs WHERE id=?').get(id)
    if (!r) throw new Error('Workflow run unavailable.')
    return parseProcessRun(JSON.parse(String(r.data)))
  }
  private put(run: ProcessRun) {
    run.updatedAt = this.now()
    this.store.transaction(() => {
      this.store.db
        .prepare(
          'INSERT INTO process_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        )
        .run(run.id, run.spaceId, JSON.stringify(run))
      this.event(run.id, run.spaceId, 'Workflow run updated')
    })
    return run
  }
  private event(id: string, spaceId: string, action: string) {
    this.store.db
      .prepare('INSERT INTO communication_events(id,kind,space,action,at) VALUES(?,?,?,?,?)')
      .run(id, 'process', spaceId, action, this.now())
  }
  private check(actor: CommunicationActor, spaceId: string) {
    this.adapters.check(actor, spaceId)
    const policy = this.adapters.policy(spaceId)
    if (!policy) throw new Error('Configure project roles and authority first.')
    if (
      actor.kind === 'participant' &&
      (actor.target !== policy.coordinator ||
        !policy.participants.find((p) => p.target === actor.target)?.requestWork)
    )
      throw new Error('Workflow changes require the configured coordinator.')
    return policy
  }
  private pin(
    definition: ProcessDefinition,
    path: string[] = [],
    budget = { count: 0 },
  ): ProcessDefinition[] {
    if (++budget.count > 320) throw new Error('Routine expansion limit (320) exceeded.')
    if (path.includes(definition.id) || path.length >= 4)
      throw new Error('Routine recursion or depth limit (4) exceeded.')
    const result: ProcessDefinition[] = []
    for (const node of definition.nodes)
      if (node.type === 'routine') {
        const d = this.definition(node.definitionId, node.revision)
        if (d.spaceId !== definition.spaceId)
          throw new Error('Routines must belong to this project.')
        result.push(d, ...this.pin(d, [...path, definition.id], budget))
      }
    return [...new Map(result.map((d) => [`${d.id}:${d.revision}`, d])).values()]
  }
  private allowed(d: ProcessDefinition, actor: CommunicationActor) {
    if (JSON.stringify(d) !== JSON.stringify(this.definition(d.id, d.revision)))
      throw new Error('Pinned workflow differs from the authorized stored revision.')
    const policy = this.check(actor, d.spaceId),
      project = this.adapters.project(d.spaceId)
    const row = this.store.db
      .prepare('SELECT data FROM process_grants WHERE id=?')
      .get(`${d.id}:${d.revision}`)
    const grant = row ? (JSON.parse(String(row.data)) as ProcessGrant) : undefined
    if (
      !grant ||
      grant.revision !== d.revision ||
      grant.policyRevision !== policy.revision ||
      grant.expiresAt <= this.now()
    )
      throw new Error('Human authorization for this workflow revision is required.')
    if (
      policy.paused ||
      project.paused ||
      Math.min(policy.expiresAt, project.expiresAt) <= this.now()
    )
      throw new Error('Project execution is paused or expired.')
    if (actor.kind !== 'human' && policy.mode !== 'automatic')
      throw new Error('Agent invocation requires automatic project policy.')
    return { policy, grant }
  }
  private assignmentSlot(d: ProcessDefinition) {
    if (d.trigger.type !== 'assignment') return null
    const a = this.adapters.assignment(d.trigger.assignmentId)
    if (a.spaceId !== d.spaceId) throw new Error('Trigger assignment belongs to another project.')
    const reached =
      d.trigger.milestone === 'completed'
        ? !!a.messageId &&
          this.store.get('message', a.messageId).deliveries.every((d) => d.phase === 'completed')
        : a.state === d.trigger.milestone ||
          (d.trigger.milestone === 'submitted' && a.state === 'accepted')
    return reached ? a.id : null
  }
  private async validateExecution(d: ProcessDefinition, actor: CommunicationActor) {
    for (const node of d.nodes) {
      this.adapters.validate?.({ ...actor, spaceId: d.spaceId }, node)
      if (node.type === 'script') {
        const root = this.adapters.project(d.spaceId).root
        if (!root || !isAbsolute(node.executable) || !isAbsolute(node.cwd))
          throw new Error('Scripts require absolute executable/cwd and a project execution root.')
        const [allowed, cwd] = await Promise.all([
          realpath(root),
          realpath(node.cwd),
          realpath(node.executable),
        ])
        const rel = relative(allowed, cwd)
        if (rel.startsWith('..') || isAbsolute(rel))
          throw new Error('Script working directory is outside the project root.')
      }
    }
  }
  readiness(id: string, revision: number, actor: CommunicationActor) {
    try {
      const d = this.definition(id, revision)
      this.allowed(d, actor)
      this.pin(d).forEach((r) => this.allowed(r, actor))
      return { ready: true, reason: '' }
    } catch (error) {
      return { ready: false, reason: message(error) }
    }
  }
  private create(
    d: ProcessDefinition,
    actor: CommunicationActor,
    objective: string,
    routines: ProcessDefinition[],
    parent?: ProcessRun,
    input: StepOutput = {},
  ): ProcessRun {
    const { policy } = this.allowed(d, actor)
    const id = randomUUID()
    return this.put({
      id,
      spaceId: d.spaceId,
      objective,
      definition: d,
      routines,
      actor: {
        id: actor.id,
        kind: actor.kind,
        target: actor.target,
        spaceId: actor.spaceId,
        folderId: actor.folderId,
      },
      policyRevision: policy.revision,
      status: 'running',
      nodes: Object.fromEntries(
        d.nodes.map((n) => [n.id, { status: 'pending', operationId: randomUUID() }]),
      ),
      startedAt: this.now(),
      updatedAt: this.now(),
      reason: '',
      parentId: parent?.id,
      rootId: parent?.rootId ?? id,
      operations: 0,
      input,
    })
  }
  async execute(
    action: keyof typeof processSchemas,
    raw: unknown,
    actor: CommunicationActor,
  ): Promise<unknown> {
    if (this.closed) throw new Error('Workflow engine closed.')
    if (action === 'save_process') {
      const i = processSchemas.save_process.parse(raw),
        d = validateGraph(i.definition)
      this.check(actor, d.spaceId)
      return this.store.operation(actor.id, i.operationId, { tool: action, ...i }, () => {
        const old = this.definitions().find((x) => x.id === d.id)
        if (
          (old?.revision ?? 0) !== i.expectedRevision ||
          d.revision !== i.expectedRevision + 1 ||
          (old && old.spaceId !== d.spaceId)
        )
          throw new Error('Workflow changed. Reload before saving.')
        this.pin(d)
        this.store.db
          .prepare('INSERT INTO process_definitions VALUES(?,?,?,?)')
          .run(d.id, d.revision, d.spaceId, JSON.stringify(d))
        this.event(d.id, d.spaceId, 'Workflow definition saved')
        return d
      })
    }
    if (action === 'authorize_process') {
      const i = processSchemas.authorize_process.parse(raw)
      if (actor.kind !== 'human')
        throw new Error('Only the human can authorize workflow execution.')
      const d = this.definition(i.definitionId, i.revision),
        policy = this.check(actor, i.spaceId)
      if (
        d.spaceId !== i.spaceId ||
        this.definitions(i.spaceId).find((x) => x.id === d.id)?.revision !== i.revision
      )
        throw new Error('Authorize the current project definition.')
      this.pin(d)
      await this.validateExecution(d, actor)
      if (this.check(actor, i.spaceId).revision !== policy.revision)
        throw new Error('Project authority changed during validation.')
      return this.store.operation(actor.id, i.operationId, { tool: action, ...i }, () => {
        const grant: ProcessGrant = {
          definitionId: d.id,
          revision: d.revision,
          policyRevision: policy.revision,
          expiresAt: policy.expiresAt,
          triggers: i.triggers,
        }
        this.store.db
          .prepare(
            'INSERT INTO process_grants VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
          )
          .run(`${d.id}:${d.revision}`, JSON.stringify(grant))
        // Do not catch up work from before authorization, including the current slot.
        this.store.db
          .prepare(
            'INSERT INTO process_triggers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET slot=excluded.slot',
          )
          .run(
            d.id,
            d.trigger.type === 'cron'
              ? (cronSlot(d.trigger, this.now()) ?? '')
              : (this.assignmentSlot(d) ?? ''),
          )
        return grant
      })
    }
    if (action === 'invoke_process') {
      const i = processSchemas.invoke_process.parse(raw),
        d = this.definition(i.definitionId, i.revision)
      if (JSON.stringify(i.input).length > 48000)
        throw new Error('Workflow input size limit exceeded.')
      if (d.spaceId !== i.spaceId) throw new Error('Workflow belongs to another project.')
      this.allowed(d, actor)
      const routines = this.pin(d)
      routines.forEach((r) => this.allowed(r, actor))
      return this.store.operation(actor.id, i.operationId, { tool: action, ...i }, () => {
        if (
          this.runs(i.spaceId).filter(
            (r) => !r.parentId && !['completed', 'cancelled'].includes(r.status),
          ).length >= 4
        )
          throw new Error('Project active run limit (4) reached.')
        return this.create(d, actor, i.objective, routines, undefined, i.input)
      })
    }
    if (action === 'control_process') {
      const i = processSchemas.control_process.parse(raw),
        run = this.run(i.runId)
      this.check(actor, i.spaceId)
      if (run.spaceId !== i.spaceId || run.parentId)
        throw new Error('Control the root run in this project.')
      if (i.action === 'resume') {
        for (const r of this.runs().filter((r) => r.rootId === run.id)) {
          this.allowed(r.definition, r.actor)
          if (Object.values(r.nodes).some((n) => ['uncertain', 'failed'].includes(n.status)))
            throw new Error('Reconcile unresolved operations before resuming.')
        }
      }
      return this.store.operation(actor.id, i.operationId, { tool: action, ...i }, () => {
        for (const r of this.runs().filter(
          (r) => r.rootId === run.id && !['completed', 'cancelled'].includes(r.status),
        )) {
          r.status =
            i.action === 'resume' ? 'running' : i.action === 'pause' ? 'paused' : 'cancelled'
          r.reason =
            i.action === 'cancel'
              ? 'Cancelled; already issued assignments and external effects are retained.'
              : ''
          if (i.action === 'cancel')
            for (const n of Object.values(r.nodes)) this.active.get(n.operationId)?.abort()
          this.put(r)
        }
        return this.run(run.id)
      })
    }
    const i = processSchemas.reconcile_process.parse(raw),
      run = this.run(i.runId)
    this.check(actor, i.spaceId)
    if (actor.kind !== 'human' || run.spaceId !== i.spaceId)
      throw new Error('Human reconciliation in the correct project required.')
    return this.store.operation(actor.id, i.operationId, { tool: action, ...i }, () => {
      const n = run.nodes[i.nodeId]
      if (!n || !['uncertain', 'failed'].includes(n.status))
        throw new Error('This step is not awaiting reconciliation.')
      if (JSON.stringify(i.output).length > 48000) throw new Error('Evidence output too large.')
      n.status = i.outcome === 'completed' ? 'completed' : 'failed'
      n.output =
        i.outcome === 'completed'
          ? parseStepOutput(
              run.definition.nodes.find((s) => s.id === i.nodeId)!,
              i.output,
            )
          : i.output
      if (run.definition.nodes.find((s) => s.id === i.nodeId)?.type === 'condition')
        n.route = n.output.success ? 'success' : 'failure'
      n.error = i.evidence
      run.status = 'paused'
      run.reason = 'Reconciled; resume explicitly, or cancel after a failed outcome.'
      return this.put(run)
    })
  }
  private settle(id: string, nodeId: string, output?: StepOutput, error?: unknown) {
    if (this.closed) return
    const run = this.run(id),
      n = run.nodes[nodeId]!
    if (!error)
      try {
        output = parseStepOutput(
          run.definition.nodes.find((s) => s.id === nodeId)!,
          output,
        )
      } catch (e) {
        error = e
      }
    if (error || JSON.stringify(output).length > 60000) {
      if (
        run.definition.nodes.find((s) => s.id === nodeId)?.type === 'script' &&
        error &&
        typeof error === 'object' &&
        'partialOutput' in error
      ) {
        try {
          n.output = parseStepOutput(
            run.definition.nodes.find((s) => s.id === nodeId)!,
            error.partialOutput,
          )
        } catch {
          /* Keep the uncertainty even if partial output is malformed. */
        }
      }
      n.status = 'uncertain'
      n.error = error ? message(error) : 'Output limit exceeded.'
      if (run.status !== 'cancelled') run.status = 'needs_you'
      run.reason = n.error
    } else {
      n.output = output
      n.status = 'completed'
    }
    this.put(run)
  }
  async tick() {
    if (this.closed || this.pumping) return
    this.pumping = true
    try {
      this.triggers()
      for (const run of this.runs().filter((r) => r.status === 'running')) {
        try {
          await this.advance(run)
        } catch (e) {
          const current = this.run(run.id)
          current.status = 'needs_you'
          current.reason = message(e)
          for (const state of Object.values(current.nodes))
            if (state.status === 'running' && !this.active.has(state.operationId)) {
              state.status = 'uncertain'
              state.error = message(e)
            }
          this.put(current)
        }
      }
    } finally {
      this.pumping = false
    }
  }
  private triggers() {
    for (const d of this.definitions()) {
      if (d.trigger.type === 'manual') continue
      try {
        const actor: CommunicationActor = {
          id: `process-trigger:${d.id}`,
          kind: 'agent',
          spaceId: d.spaceId,
        }
        const { grant } = this.allowed(d, actor)
        if (!grant.triggers) continue
        let slot: string | null = null
        if (d.trigger.type === 'cron') {
          if (Math.floor(this.now() / 60000) === this.startupMinute) continue
          slot = cronSlot(d.trigger, this.now())
        } else {
          slot = this.assignmentSlot(d)
        }
        if (
          !slot ||
          this.store.db.prepare('SELECT slot FROM process_triggers WHERE id=?').get(d.id)?.slot ===
            slot ||
          this.store.db
            .prepare('SELECT slot FROM process_trigger_slots WHERE id=? AND slot=?')
            .get(`${d.id}:${d.revision}`, slot)
        )
          continue
        this.store.transaction(() => {
          this.store.db
            .prepare(
              'INSERT INTO process_triggers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET slot=excluded.slot',
            )
            .run(d.id, slot)
          this.store.db
            .prepare('INSERT INTO process_trigger_slots VALUES(?,?)')
            .run(`${d.id}:${d.revision}`, slot)
          if (
            this.runs(d.spaceId).some(
              (r) =>
                !r.parentId &&
                r.definition.id === d.id &&
                !['completed', 'cancelled'].includes(r.status),
            )
          )
            return
          if (
            this.runs(d.spaceId).filter(
              (r) => !r.parentId && !['completed', 'cancelled'].includes(r.status),
            ).length >= 4
          )
            return
          const routines = this.pin(d)
          routines.forEach((r) => this.allowed(r, actor))
          this.create(d, actor, d.name, routines)
        })
      } catch {
        /* Unavailable/revoked authority never starts a trigger. */
      }
    }
  }
  private async advance(original: ProcessRun) {
    let run = this.run(original.id)
    const root = this.run(run.rootId)
    if (root.status !== 'running') return
    const { policy } = this.allowed(run.definition, run.actor)
    if (policy.revision !== run.policyRevision)
      throw new Error('Project authority changed; this run is held.')
    for (const node of run.definition.nodes) {
      run = this.run(run.id)
      if (run.status !== 'running') return
      const state = run.nodes[node.id]!
      if (state.status === 'waiting') {
        if (node.type === 'review') {
          if (!this.adapters.reviewed) throw new Error('Evidence review adapter unavailable.')
          if (
            this.adapters.reviewed(
              { ...run.actor, spaceId: run.spaceId },
              String(state.output?.itemId),
              Number(state.output?.revision),
            )
          ) {
            state.status = 'completed'
            state.output = { ...state.output, accepted: true }
            this.put(run)
          }
        }
        if (node.type === 'wait' && state.wakeAt! <= this.now()) {
          state.status = 'completed'
          state.output = { waited: true }
          this.put(run)
        }
        if (node.type === 'ai' && state.assignmentId) {
          const a = this.adapters.assignment(state.assignmentId)
          if (a.state === node.milestone || a.state === 'accepted') {
            this.settle(run.id, node.id, {
              assignmentId: a.id,
              result: a.result ?? '',
              outputs: a.outputs ?? [],
            })
          } else if (['cancelled', 'superseded'].includes(a.state))
            throw new Error('Assigned work was cancelled or superseded.')
        }
        if (node.type === 'routine' && state.childId) {
          const child = this.run(state.childId)
          if (child.status === 'needs_you')
            throw new Error(`Routine needs attention: ${child.reason}`)
          if (child.status === 'completed') {
            if (child.success) {
              state.status = 'completed'
              state.output = { success: true, runId: child.id, attempts: state.attempts }
              this.put(run)
            } else if (state.attempts! >= node.maxAttempts)
              throw new Error(
                `Routine exhausted ${node.maxAttempts} attempts. Review retained failures.`,
              )
            else {
              state.status = 'pending'
              this.put(run)
            }
          }
        }
        continue
      }
      if (state.status !== 'pending') continue
      const incoming = run.definition.edges.filter((e) => e.to === node.id)
      if (incoming.some((e) => !terminal(run.nodes[e.from]!.status))) continue
      const selected = incoming.filter(
        (e) =>
          run.nodes[e.from]!.status === 'completed' &&
          (e.route === 'always' || run.nodes[e.from]!.route === e.route),
      )
      if (incoming.length && !selected.length) {
        state.status = 'skipped'
        this.put(run)
        continue
      }
      const inFlight = this.runs(run.spaceId)
        .flatMap((r) => Object.values(r.nodes))
        .filter((n) => n.status === 'running').length
      if (inFlight >= Math.min(policy.maxConcurrent, run.definition.maxConcurrent)) continue
      const latestRoot = this.run(run.rootId)
      if (latestRoot.operations >= latestRoot.definition.maxOperations)
        throw new Error('Run operation limit reached.')
      const inputs: StepOutput = {}
      for (const [key, binding] of Object.entries(node.inputs)) {
        const output = binding.node === '$input' ? run.input : run.nodes[binding.node]?.output
        if (!output || !(binding.field in output))
          throw new Error(`${node.title}: required input ${key} unavailable on this route.`)
        inputs[key] = output[binding.field]
      }
      // Journal before any adapter can produce an external effect.
      latestRoot.operations++
      this.put(latestRoot)
      run = this.run(run.id)
      const n = run.nodes[node.id]!
      n.status = 'running'
      this.put(run)
      if (node.type === 'condition') {
        n.route = inputs[node.input] === node.equals ? 'success' : 'failure'
        n.status = 'completed'
        n.output = { success: n.route === 'success' }
        this.put(run)
      } else if (node.type === 'finish' || node.type === 'join')
        this.settle(
          run.id,
          node.id,
          node.type === 'finish' ? { ...inputs, success: node.success } : { inputs },
        )
      else if (node.type === 'wait') {
        n.status = 'waiting'
        n.wakeAt = this.now() + node.durationMs
        this.put(run)
      } else if (node.type === 'context')
        this.settle(run.id, node.id, {
          items: this.adapters.context({ ...run.actor, spaceId: run.spaceId }, node.items),
        })
      else if (node.type === 'save')
        this.settle(
          run.id,
          node.id,
          this.adapters.save(
            run,
            node,
            `${node.body}\n\nWorkflow evidence (data):\n${JSON.stringify(inputs)}`,
            n.operationId,
          ) as StepOutput,
        )
      else if (node.type === 'routine') {
        const d = run.routines.find(
          (d) => d.id === node.definitionId && d.revision === node.revision,
        )
        if (!d) throw new Error('Pinned routine unavailable.')
        this.store.transaction(() => {
          n.childId = this.create(d, run.actor, run.objective, run.routines, run, inputs).id
          n.attempts = (n.attempts ?? 0) + 1
          n.status = 'waiting'
          this.put(run)
        })
      } else if (node.type === 'ai') {
        try {
          const a = await this.adapters.assign(run, node, inputs, n.operationId)
          const current = this.run(run.id)
          current.nodes[node.id]!.assignmentId = a.id
          current.nodes[node.id]!.status = 'waiting'
          this.put(current)
        } catch (e) {
          this.settle(run.id, node.id, undefined, e)
        }
      } else if (node.type === 'review') {
        if (
          typeof inputs.itemId !== 'string' ||
          !Number.isInteger(inputs.revision) ||
          Number(inputs.revision) < 1
        )
          throw new Error('Review requires a saved item ID and positive revision.')
        n.status = 'waiting'
        n.output = { itemId: inputs.itemId, revision: inputs.revision }
        this.put(run)
      } else if (node.type === 'script') {
        const controller = new AbortController()
        this.active.set(n.operationId, controller)
        const project = this.adapters.project(run.spaceId)
        if (!project.root) {
          this.active.delete(n.operationId)
          this.settle(run.id, node.id, undefined, new Error('Project execution root unavailable.'))
          continue
        }
        void (this.adapters.script ?? runScript)(node, inputs, project.root, controller.signal)
          .then(
            (output) => this.settle(run.id, node.id, output),
            (e) => this.settle(run.id, node.id, undefined, e),
          )
          .finally(() => this.active.delete(n.operationId))
      }
    }
    run = this.run(run.id)
    if (run.status === 'running' && Object.values(run.nodes).every((n) => terminal(n.status))) {
      const finishes = run.definition.nodes.filter(
        (n) => n.type === 'finish' && run.nodes[n.id]?.status === 'completed',
      )
      run.success = finishes.length > 0 && finishes.every((n) => n.type === 'finish' && n.success)
      run.status = 'completed'
      run.reason = 'Execution completed; saved evidence and assignment acceptance remain separate.'
      if (!run.parentId && !run.success) {
        run.status = 'needs_you'
        run.reason = 'Workflow ended without success. Review the retained evidence.'
      }
      this.put(run)
    }
  }
  close() {
    this.closed = true
    this.active.forEach((c) => c.abort())
    this.active.clear()
  }
}
