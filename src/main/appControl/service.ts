import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import { dirname } from 'node:path'
import {
  controlTools,
  controlSettingsSchema,
  APP_CONTROL_VERSION,
  type ControlResult,
  type ControlOutcome,
  type ControlCommand,
  type ControlPublication,
  type ControlSnapshot,
  type AppliedRoute,
} from '../../shared/appControl'
import type { Settings } from '../../shared/settings'
import type { TimelineItem } from '../../shared/threadTimeline'

export interface ControlCaller {
  active: boolean
  owner(): string
  resolve(ref: string): { id: string } | null
  cards(ref: string): Promise<TimelineItem[] | null>
  approve(id: string, title: string, detail: string, decide: (allow: boolean) => void): void
}
export interface ControlDependencies {
  hasChat?: (id: string) => boolean
  chatInfo?: (id: string) => { id: string; title: string; provider: string } | null
  availability?: (name: string) => { available: boolean; reason?: string }
  settings(): Settings
  updateSettings(patch: unknown, expectedRevision: string): Promise<{ ok: boolean }>
  workspaces(): { id: string; name: string; path: string; parentId: string | null }[]
  spaces(): { id: string; title: string; workspaceId: string | null }[]
  artifacts(id: string): Promise<{ id: string; title: string; kind: string }[]>
  changes(id: string, scope: 'thread' | 'worktree'): Promise<unknown>
  createSpace(
    title: string,
    workspace: string,
    operationId: string,
  ): Promise<{ ok: boolean; spaceId?: string }>
  createChat(
    workspace: string | null,
    operationId: string,
  ): Promise<{ ok: boolean; sessionId?: string }>
  busy(): { agent: boolean; otherWork: boolean }
  send(command: ControlCommand): void
  restart(): void
}
type Operation = {
  owner: string
  actionId: string
  fingerprint: string
  tool: string
  result: ControlResult
}
const fingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
          : v,
      ),
    )
    .digest('hex')
export const controlSettingsRevision = fingerprint
const savedOperations = z
  .array(
    z.tuple([
      z.string().max(500),
      z
        .object({
          owner: z.string().max(300),
          actionId: z.string().uuid(),
          fingerprint: z.string().length(64),
          tool: z.string().max(100),
          result: z
            .object({
              outcome: z.enum([
                'ok',
                'pending',
                'unavailable',
                'not_found',
                'ambiguous',
                'conflict',
                'denied',
                'busy',
                'uncertain',
              ]),
              observationId: z.string().uuid(),
              instanceId: z.string().uuid(),
              observedAt: z.number(),
              operationId: z.string().uuid().optional(),
              reason: z.string().max(500).optional(),
              data: z.unknown().optional(),
            })
            .strict(),
        })
        .strict(),
    ]),
  )
  .max(1000)

export class AppControlService {
  readonly instanceId = randomUUID()
  private generation = randomUUID()
  private snapshot?: ControlSnapshot
  private operations = new Map<string, Operation>()
  private queue: Promise<unknown> = Promise.resolve()
  private navigation = new Map<
    string,
    {
      caller: ControlCaller
      key: string
      timer: ReturnType<typeof setTimeout>
      done: () => void
      command: ControlCommand
    }
  >()
  private restarting?: string
  private owners = new Map<ControlCaller, Set<string>>()
  private storeIssue = false
  private routeIdentities = new Map<string, string>()
  constructor(
    private deps: ControlDependencies,
    private file: string,
    private timeoutMs = 4000,
  ) {
    try {
      if (existsSync(file)) {
        if (statSync(file).size > 4_000_000) throw Error('Receipt size limit')
        const entries = savedOperations.parse(JSON.parse(readFileSync(file, 'utf8')))
        this.operations = new Map(entries)
        for (const op of this.operations.values())
          if (op.result.outcome === 'pending' && op.result.reason !== 'restart_scheduled') {
            op.result = this.result(
              'uncertain',
              'Application stopped before completion was confirmed.',
              undefined,
              op.result.operationId,
            )
          }
      }
    } catch {
      this.operations.clear()
      this.storeIssue = true
    }
  }
  /** Called only after startup readiness. Never replays a saved action. */
  ready() {
    if (this.storeIssue) return
    for (const op of this.operations.values())
      if (
        op.tool === 'threadlight_restart_app' &&
        op.result.reason === 'restart_scheduled' &&
        op.result.instanceId !== this.instanceId
      ) {
        op.result = this.result(
          'ok',
          'New application instance is ready.',
          undefined,
          op.result.operationId,
        )
      }
    try {
      this.save()
    } catch {
      /* Reads remain available; mutations fail closed. */
    }
  }
  hello() {
    return { instanceId: this.instanceId, generation: this.generation }
  }
  orientation() {
    return {
      version: APP_CONTROL_VERSION,
      instanceId: this.instanceId,
      renderer: this.snapshot ?? null,
      tools: controlTools.map((t) => t.name),
    }
  }
  claim(command: ControlCommand) {
    const nav = this.navigation.get(command.commandId)
    return (
      command.instanceId === this.instanceId &&
      command.generation === this.generation &&
      command.expiresAt > Date.now() &&
      !!nav?.caller.active &&
      nav.command.expiresAt > Date.now()
    )
  }
  rendererGone() {
    this.generation = randomUUID()
    this.snapshot = undefined
    for (const [id, nav] of this.navigation) {
      clearTimeout(nav.timer)
      this.settle(nav.key, 'uncertain', 'Renderer became unavailable.')
      nav.done()
      this.navigation.delete(id)
    }
  }
  publish(value: ControlPublication) {
    if (
      value.instanceId !== this.instanceId ||
      value.generation !== this.generation ||
      !Number.isSafeInteger(value.snapshot.revision) ||
      value.snapshot.revision <= (this.snapshot?.revision ?? -1)
    )
      return false
    if (value.commandId && !this.navigation.get(value.commandId)?.caller.active) return false
    this.snapshot = { ...value.snapshot, observedAt: Date.now() }
    if (value.commandId) {
      const nav = this.navigation.get(value.commandId)
      if (!nav || !nav.caller.active) return false
      clearTimeout(nav.timer)
      this.navigation.delete(value.commandId)
      const expected = nav.command.route
      const matches =
        !expected ||
        Object.entries(expected).every(
          ([k, v]) =>
            k === 'threadId' ||
            (value.snapshot.route as unknown as Record<string, unknown>)[k] === v,
        )
      this.settle(
        nav.key,
        value.outcome === 'ok' && !matches ? 'uncertain' : (value.outcome ?? 'unavailable'),
        matches ? undefined : 'Renderer applied a different route.',
        this.snapshot,
      )
      nav.done()
    }
    return true
  }
  revoke(caller: ControlCaller) {
    caller.active = false
    for (const [id, nav] of this.navigation)
      if (nav.caller === caller) {
        clearTimeout(nav.timer)
        this.navigation.delete(id)
        this.settle(nav.key, 'denied', 'Caller revoked.')
        nav.done()
      }
    for (const key of this.owners.get(caller) ?? []) {
      const op = this.operations.get(key)
      if (op?.result.outcome === 'pending' && op.result.reason === 'Awaiting human decision.')
        this.settle(key, 'denied', 'Caller revoked.')
    }
    this.owners.delete(caller)
  }
  private result(
    outcome: ControlOutcome,
    reason?: string,
    data?: unknown,
    operationId?: string,
  ): ControlResult {
    return {
      outcome,
      reason,
      data,
      operationId,
      observationId: randomUUID(),
      instanceId: this.instanceId,
      observedAt: Date.now(),
    }
  }
  private save() {
    if (this.storeIssue) throw Error('Control receipt store unavailable.')
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.operations]), { mode: 0o600 })
      renameSync(`${this.file}.tmp`, this.file)
    } catch {
      this.storeIssue = true
      throw Error('Control receipts could not be persisted.')
    }
  }
  failure() {
    return this.result(
      'uncertain',
      'Request could not be confirmed. Recover any write with its operation ID.',
    )
  }
  private settle(key: string, outcome: ControlOutcome, reason?: string, data?: unknown) {
    const op = this.operations.get(key)!
    op.result = this.result(outcome, reason, data, op.result.operationId)
    this.save()
    return op.result
  }
  private revision() {
    return fingerprint(this.deps.settings())
  }
  async call(caller: ControlCaller, name: string, raw: unknown): Promise<ControlResult> {
    if (!caller.active) return this.result('denied', 'Caller revoked.')
    const tool = controlTools.find((t) => t.name === name)
    const parsed = tool?.schema.safeParse(raw)
    if (!tool || !parsed?.success) return this.result('unavailable', 'Invalid tool arguments.')
    const input = parsed.data as Record<string, unknown>
    const operationId = input.operationId as string | undefined
    const key = `${caller.owner()}:${operationId}`
    if (name === 'threadlight_get_operation')
      if (this.storeIssue)
        return this.result(
          'uncertain',
          'Control receipts could not be read; no actions were replayed.',
          undefined,
          operationId,
        )
    if (name === 'threadlight_get_operation')
      return (
        this.operations.get(key)?.result ??
        this.result(
          'not_found',
          'Operation not found in this conversation.',
          undefined,
          operationId,
        )
      )
    if (tool.effect === 'read') {
      const result = await this.read(caller, name, input)
      if (
        !caller.active ||
        (result.outcome === 'ok' &&
          typeof input.threadRef === 'string' &&
          !caller.resolve(input.threadRef))
      )
        return this.result('denied', 'Caller or chat access was revoked during the read.')
      return result
    }
    const previous = this.operations.get(key)
    const hash = fingerprint({ name, input })
    if (previous)
      return previous.fingerprint === hash
        ? previous.result
        : this.result(
            'conflict',
            'Operation ID already has a different payload.',
            undefined,
            operationId,
          )
    const availability = this.availability(name)
    if (!availability.available)
      return this.result('unavailable', availability.reason, undefined, operationId)
    if (this.operations.size >= 1000) return this.result('busy', 'Operation store is full.')
    this.operations.set(key, {
      owner: caller.owner(),
      actionId: randomUUID(),
      fingerprint: hash,
      tool: name,
      result: this.result(
        'pending',
        tool.effect === 'write' ? 'Awaiting human decision.' : 'Awaiting renderer.',
        undefined,
        operationId,
      ),
    })
    const owned = this.owners.get(caller) ?? new Set<string>()
    owned.add(key)
    this.owners.set(caller, owned)
    this.save()
    if (tool.effect === 'navigate') await this.navigate(caller, key, input)
    else
      caller.approve(
        `control:${operationId}`,
        name.replace('threadlight_', '').replaceAll('_', ' '),
        JSON.stringify(input, null, 2),
        (allow) => {
          if (this.operations.get(key)?.result.reason !== 'Awaiting human decision.') return
          if (!allow || !caller.active) {
            this.settle(key, 'denied', 'Action denied or caller revoked.')
            return
          }
          this.settle(key, 'pending', 'Approved action is executing.')
          // Serialize approval callbacks, including expected-revision validation and persistence.
          this.queue = this.queue.then(async () => {
            if (!caller.active) {
              this.settle(key, 'denied', 'Caller revoked.')
              return
            }
            try {
              await this.write(key, name, input)
            } catch {
              this.settle(
                key,
                'uncertain',
                'Action could not be confirmed; inspect its receipt before retrying.',
              )
            }
          })
        },
      )
    return this.operations.get(key)!.result
  }
  private async read(
    caller: ControlCaller,
    name: string,
    input: Record<string, unknown>,
  ): Promise<ControlResult> {
    const customAvailability = this.deps.availability?.(name)
    if (customAvailability && !customAvailability.available)
      return this.result('unavailable', customAvailability.reason)
    if (name === 'threadlight_get_capabilities')
      return this.result('ok', undefined, {
        version: APP_CONTROL_VERSION,
        tools: controlTools.map((t) => ({
          name: t.name,
          effect: t.effect,
          ...this.availability(t.name),
        })),
        settings: Object.keys(controlSettingsSchema.shape),
        limitations: [
          'Native chat creation supports enabled Codex only.',
          'Writes require the existing Agent human decision card.',
          'Captured edit cards require an available Codex native stream; Claude card previews are unavailable.',
          'Card discovery is bounded to 50 captured cards.',
          'Smart chat, artifact and diff navigation requires a chat in the monitored snapshot; archived or unloaded chats remain readable through the reader.',
        ],
      })
    if (name === 'threadlight_get_app_state')
      return this.result('ok', undefined, {
        renderer:
          this.snapshot && Date.now() - this.snapshot.observedAt < 15000
            ? 'available'
            : 'unavailable',
        snapshot: this.snapshot,
        selectedChat:
          this.snapshot && 'threadRef' in this.snapshot.route
            ? (this.deps.chatInfo?.(
                caller.resolve(this.snapshot.route.threadRef)?.id ??
                  this.routeIdentities.get(this.snapshot.route.threadRef) ??
                  this.snapshot.route.threadRef,
              ) ?? null)
            : null,
        stateRevision: fingerprint({
          renderer: this.snapshot?.revision,
          settings: this.revision(),
          busy: this.deps.busy(),
        }),
        enabledProviders: this.deps.settings().enabledProviders,
        settingsRevision: this.revision(),
        settings: Object.fromEntries(
          Object.keys(controlSettingsSchema.shape).map((k) => [
            k,
            this.deps.settings()[k as keyof Settings],
          ]),
        ),
        busy: this.deps.busy(),
        pending: [...this.operations.values()]
          .filter((o) => o.owner === caller.owner() && o.result.outcome === 'pending')
          .map((o) => ({
            tool: o.tool,
            operationId: o.result.operationId,
            reason: o.result.reason,
          })),
      })
    if (name === 'threadlight_list_workspaces' || name === 'threadlight_list_spaces') {
      const all = name.endsWith('workspaces') ? this.deps.workspaces() : this.deps.spaces()
      const matches = all.filter((v) =>
        JSON.stringify(v).toLowerCase().includes(String(input.query).toLowerCase()),
      )
      const offset = Number(input.offset),
        limit = Number(input.limit)
      return this.result('ok', undefined, {
        items: matches.slice(offset, offset + limit),
        nextOffset: offset + limit < matches.length ? offset + limit : null,
      })
    }
    const resolved = caller.resolve(String(input.threadRef))
    if (!resolved)
      return this.result('not_found', 'Resolve this exact chat using the chat reader first.')
    if (this.deps.hasChat && !this.deps.hasChat(resolved.id))
      return this.result(
        'unavailable',
        'This chat is outside the current monitored snapshot. It remains readable with the chat reader.',
      )
    if (name === 'threadlight_list_artifacts')
      return this.result('ok', undefined, {
        items: (await this.deps.artifacts(resolved.id))
          .slice(0, 100)
          .map(({ id, title, kind }) => ({
            id,
            title: title.slice(0, 200),
            kind,
            availability: kind === 'unsupported' ? 'unavailable' : 'unknown',
            reason:
              kind === 'unsupported'
                ? 'No viewer supports this format.'
                : 'File availability is checked when the exact artifact is opened.',
          })),
      })
    if (input.scope === 'card') {
      const cards = await caller.cards(String(input.threadRef))
      if (!caller.active) return this.result('denied', 'Caller revoked.')
      const edits = cards?.filter((c) => c.fileChanges?.length).slice(-50)
      if (!edits) return this.result('unavailable', 'Captured cards unavailable.')
      if (!input.cardId)
        return this.result('ok', undefined, {
          cards: edits.map((c) => ({
            cardId: c.id,
            title: c.text.slice(0, 200),
            fileCount: c.fileCount ?? c.fileChanges!.length,
          })),
        })
      const card = edits.find((c) => c.id === input.cardId)
      return card
        ? this.result('ok', undefined, {
            cardId: card.id,
            files: card.fileChanges!.slice(0, 100).map((f) => ({
              path: f.path,
              added: f.added,
              removed: f.removed,
              captured: f.diff !== undefined,
            })),
            preview: {
              page: 'changes',
              threadRef: input.threadRef,
              scope: 'card',
              cardId: card.id,
            },
          })
        : this.result('not_found', 'Card not found in the bounded discovery page.')
    }
    const changes = await this.deps.changes(resolved.id, input.scope as 'thread' | 'worktree')
    return changes === null
      ? this.result('unavailable', 'Changes are unavailable for this chat and scope.')
      : this.result('ok', undefined, changes)
  }
  private availability(name: string) {
    if (this.storeIssue && controlTools.find((t) => t.name === name)?.effect !== 'read')
      return {
        available: false,
        reason: 'Control receipt store unavailable; existing data was preserved.',
      }
    const custom = this.deps.availability?.(name)
    if (custom && !custom.available) return custom
    if (
      name === 'threadlight_navigate' &&
      (!this.snapshot || Date.now() - this.snapshot.observedAt > 15000)
    )
      return { available: false, reason: 'Panel renderer unavailable.' }
    if (
      name === 'threadlight_create_chat' &&
      !this.deps.settings().enabledProviders.includes('codex')
    )
      return { available: false, reason: 'Native chat creation requires enabled Codex.' }
    if (name === 'threadlight_restart_app' && this.deps.busy().otherWork)
      return { available: false, reason: 'Other active work or captures prevent restart.' }
    return { available: true }
  }
  private async navigate(caller: ControlCaller, key: string, input: Record<string, unknown>) {
    const deadline = Date.now() + this.timeoutMs
    if (this.navigation.size) {
      this.settle(key, 'busy', 'Another navigation is awaiting acknowledgement.')
      return
    }
    if (!this.snapshot || Date.now() - this.snapshot.observedAt > 15000) {
      this.settle(key, 'unavailable', 'Panel renderer unavailable.')
      return
    }
    const route = input.route ? (structuredClone(input.route) as AppliedRoute) : undefined
    let card: TimelineItem | undefined
    if (route && 'threadRef' in route) {
      const resolved = caller.resolve(route.threadRef)
      if (!resolved) {
        this.settle(key, 'not_found', 'Resolve the exact chat first.')
        return
      }
      route.threadId = resolved.id
      if (this.routeIdentities.size >= 500)
        this.routeIdentities.delete(this.routeIdentities.keys().next().value!)
      this.routeIdentities.set(route.threadRef, resolved.id)
      if (this.deps.hasChat && !this.deps.hasChat(resolved.id)) {
        this.settle(
          key,
          'unavailable',
          'This chat is outside the monitored snapshot; use the reader for its content.',
        )
        return
      }
      if (
        route.page === 'changes' &&
        route.scope !== 'card' &&
        (await this.deps.changes(resolved.id, route.scope)) === null
      ) {
        this.settle(key, 'unavailable', 'Changes are unavailable for this chat and scope.')
        return
      }
      if (
        route.page === 'artifact' &&
        !(await this.deps.artifacts(resolved.id)).some((a) => a.id === route.artifactId)
      ) {
        this.settle(key, 'not_found', 'Artifact not found in this chat.')
        return
      }
      if (route.page === 'changes' && route.scope === 'card') {
        card = (await caller.cards(route.threadRef))?.find(
          (c) => c.id === route.cardId && c.fileChanges?.length,
        )
        if (!card || JSON.stringify(card).length > 500000) {
          this.settle(key, 'unavailable', 'Captured card is missing or exceeds the preview limit.')
          return
        }
        card = structuredClone(card)
      }
    }
    if (
      route?.page === 'workspace' &&
      !this.deps.workspaces().some((w) => w.id === route.workspaceId)
    ) {
      this.settle(key, 'not_found', 'Unknown workspace.')
      return
    }
    if (
      route?.page === 'spaces' &&
      route.area === 'space' &&
      !this.deps.spaces().some((s) => s.id === route.spaceId)
    ) {
      this.settle(key, 'not_found', 'Unknown space.')
      return
    }
    if (!caller.active) {
      this.settle(key, 'denied', 'Caller revoked.')
      return
    }
    if (
      route &&
      'threadRef' in route &&
      (!caller.resolve(route.threadRef) ||
        (this.deps.hasChat && !this.deps.hasChat(route.threadId!)))
    ) {
      this.settle(key, 'denied', 'Chat access changed before navigation.')
      return
    }
    if (Date.now() >= deadline) {
      this.settle(key, 'unavailable', 'Navigation validation deadline expired.')
      return
    }
    const commandId = randomUUID()
    const command: ControlCommand = {
      ...this.hello(),
      commandId,
      expiresAt: deadline,
      route,
      direction: input.direction as 'back' | 'forward' | undefined,
      card,
    }
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        this.navigation.delete(commandId)
        this.settle(key, 'uncertain', 'Navigation acknowledgement timed out; command expired.')
        done()
      }, deadline - Date.now())
      this.navigation.set(commandId, { caller, key, timer, done, command })
      this.deps.send(command)
    })
  }
  private async write(key: string, name: string, input: Record<string, unknown>) {
    const workspace =
      'workspaceId' in input && input.workspaceId !== null
        ? this.deps.workspaces().find((w) => w.id === input.workspaceId)
        : undefined
    if ('workspaceId' in input && input.workspaceId !== null && !workspace) {
      this.settle(key, 'not_found', 'Workspace is no longer known.')
      return
    }
    if (name === 'threadlight_update_settings') {
      if (input.expectedRevision !== this.revision()) {
        this.settle(key, 'conflict', 'Settings changed; read the current revision.')
        return
      }
      const patch = Object.fromEntries(
        Object.entries(controlSettingsSchema.parse(input.patch)).filter(([k]) =>
          Object.hasOwn(input.patch as object, k),
        ),
      )
      if (patch.panelLayout === 'dual' && this.deps.settings().enabledProviders.length < 2) {
        this.settle(key, 'unavailable', 'Dual layout requires both providers.')
        return
      }
      const applied = await this.deps.updateSettings(patch, String(input.expectedRevision))
      this.settle(key, applied.ok ? 'ok' : 'unavailable', undefined, {
        values: patch,
        revision: this.revision(),
      })
      return
    }
    if (name === 'threadlight_create_space') {
      const result = await this.deps.createSpace(
        String(input.title),
        workspace!.path,
        this.operations.get(key)!.actionId,
      )
      this.settle(key, result.ok ? 'ok' : 'unavailable', undefined, { spaceId: result.spaceId })
      return
    }
    if (name === 'threadlight_create_chat') {
      if (input.provider !== 'codex' || !this.deps.settings().enabledProviders.includes('codex')) {
        this.settle(key, 'unavailable', 'Native creation requires enabled Codex.')
        return
      }
      const result = await this.deps.createChat(
        workspace?.path ?? null,
        this.operations.get(key)!.actionId,
      )
      this.settle(
        key,
        result.ok ? 'ok' : result.sessionId ? 'uncertain' : 'unavailable',
        undefined,
        { threadId: result.sessionId },
      )
      return
    }
    if (
      this.deps.busy().otherWork ||
      this.restarting ||
      [...this.operations].some(([k, o]) => k !== key && o.result.outcome === 'pending')
    ) {
      this.settle(key, 'busy', 'Other work or pending operations prevent restart.')
      return
    }
    this.restarting = key
    this.settle(key, 'pending', 'restart_scheduled')
  }
  /** HTTP response finish is the earliest point at which the requester has a receipt. */
  responseFlushed(result: ControlResult) {
    if (
      !this.restarting ||
      this.operations.get(this.restarting)?.result.observationId !== result.observationId
    )
      return
    const key = this.restarting
    this.restarting = undefined
    setTimeout(() => {
      if (this.deps.busy().otherWork) {
        this.settle(key, 'busy', 'Other work began before restart.')
        return
      }
      try {
        this.deps.restart()
      } catch {
        this.settle(key, 'uncertain', 'Graceful restart failed.')
      }
    }, 250)
  }
}
