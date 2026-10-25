import { open, readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  Attention,
  GitState,
  PlanItem,
  Session,
  Snapshot,
  TreeView,
  Workspace,
} from '../../shared/types'
import type { CodexPaths } from '../sessions/paths'
import { isObject, str } from '../sessions/json'
import { CODEX_UUID, codexKey } from './identity'
import { CodexHolds, endQuestion } from './holds'
import { writerHeld } from './live'
import { readCodexPlan } from './plan'
import { codexUsage } from './usage'
import type { Usage } from '../../shared/usage'
import { codexDisplayText, codexToolActivity, codexUserRequest } from './presentation'
import { codexState } from './state'

type Row = Record<string, unknown>
const json = (value: unknown): Row => {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter(isObject)
          .map((x) => str(x['text']) || '')
          .filter(Boolean)
          .join('\n')
      : ''
const ms = (value: unknown): number =>
  typeof value === 'number'
    ? value < 1e12
      ? value * 1000
      : value
    : typeof value === 'string'
      ? Date.parse(value) || 0
      : 0

/** Bounded legacy tail. Only actual session files inside the selected Codex home may be read. */
export async function rolloutTail(path: string, home: string): Promise<Row[]> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    const rel = relative(await realpath(home), await realpath(path))
    if (isAbsolute(rel) || rel.startsWith('..') || !/^(sessions|archived_sessions)[\\/]/.test(rel))
      return []
    file = await open(path, 'r')
    const { size } = await file.stat(),
      start = Math.max(0, size - 1024 * 1024),
      data = Buffer.alloc(size - start)
    await file.read(data, 0, data.length, start)
    const lines = data.toString('utf8').split('\n')
    if (start) lines.shift()
    return lines.filter(Boolean).map(json)
  } catch {
    return []
  } finally {
    await file?.close()
  }
}

export interface CodexSummary {
  lastPrompt: string | null
  lastReply: string | null
  lastAction: string | null
  plan: PlanItem[]
  planText: string | null
  hasPlan: boolean
  attention: Attention | null
  contextUsed: number | null
}

function questionCard(value: unknown): Attention | null {
  if (!Array.isArray(value)) return null
  const questions = value.filter(isObject).flatMap((q) => {
    const question = str(q['question']) || str(q['title'])
    if (!question) return []
    return [
      {
        header: str(q['header']) || '',
        question,
        multiSelect: false,
        options: (Array.isArray(q['options']) ? q['options'] : [])
          .map((o) => (typeof o === 'string' ? { label: o } : o))
          .filter(isObject)
          .flatMap((o) => {
            const label = str(o['label'])
            return label
              ? [
                  {
                    label,
                    description: str(o['description']) || '',
                    recommended: /\(recommended\)/i.test(label),
                  },
                ]
              : []
          }),
      },
    ]
  })
  return questions.length ? { kind: 'question', questions, answerableUntil: null } : null
}

/** Accepts the history projection and the older rollout format without rewriting either. */
export function summarizeCodex(records: Row[]): CodexSummary {
  let questionCall: string | null = null,
    asynchronous = false,
    progress: string | null = null
  const out: CodexSummary = {
    lastPrompt: null,
    lastReply: null,
    lastAction: null,
    plan: [],
    planText: null,
    hasPlan: false,
    attention: null,
    contextUsed: null,
  }
  for (const record of records) {
    const plan = readCodexPlan(record)
    if (plan) Object.assign(out, plan, { hasPlan: true })
    const item = isObject(record['payload']) ? record['payload'] : record
    const type = str(item['type'])
    if (
      type === 'userMessage' ||
      type === 'user_message' ||
      (type === 'message' && item['role'] === 'user')
    ) {
      const request = codexUserRequest(textOf(item['content']) || str(item['message']) || '')
      if (!request) continue
      out.lastPrompt = request
      progress = null
      out.lastAction = null
      out.attention = null
      questionCall = null
    }
    if (
      type === 'agentMessage' ||
      type === 'agent_message' ||
      (type === 'message' && item['role'] === 'assistant')
    ) {
      const text = str(item['text']) || str(item['message']) || textOf(item['content'])
      if (text) {
        const display = codexDisplayText(text)
        if (item['phase'] === 'commentary') {
          progress = display || null
          out.lastAction = progress
        } else {
          out.lastReply = display || out.lastReply
          if (out.attention?.kind !== 'question') out.attention = endQuestion(text)
        }
      }
      const card = questionCard(item['questions'])
      if (card) {
        out.attention = card
        questionCall = null
      }
    }
    if (type === 'commandExecution') out.lastAction = progress || codexToolActivity(type, item)
    if (type === 'function_call' || type === 'functionCall') {
      const name = str(item['name']) || '',
        args = json(item['arguments'])
      out.lastAction = progress || codexToolActivity(name, args)
      if (/request_user_input(?:_async)?$/.test(name) && Array.isArray(args['questions'])) {
        out.attention = questionCard(args['questions'])
        questionCall = str(item['call_id']) || str(item['id'])
        asynchronous = name.endsWith('_async')
      }
    }
    if (type === 'function_call_output' || type === 'functionCallOutput') {
      if (
        !asynchronous &&
        questionCall &&
        item['call_id'] === questionCall &&
        out.attention?.kind === 'question'
      )
        out.attention = null
    }
    if (type === 'token_count') {
      const info = json(item['info']),
        usage = json(info['last_token_usage']),
        limit = Number(info['model_context_window'])
      if (limit > 0) out.contextUsed = Math.min(1, Number(usage['input_tokens'] || 0) / limit)
    }
  }
  return out
}

export class CodexTracker {
  private windowHours = 24
  private maxSessions = 10
  private lastError = ''
  private tails = new Map<
    string,
    { stamp: string; identity: string; size: number; records: Row[] }
  >()
  constructor(
    private readonly paths: CodexPaths,
    readonly hooks: CodexHolds,
    private readonly gitFor: (cwd: string) => GitState | null = () => null,
    private readonly hidden: (id: string, cwd: string) => boolean = () => false,
  ) {}
  configure(hours: number, max: number): void {
    this.windowHours = hours
    this.maxSessions = max
  }
  private async tail(path: string): Promise<Row[]> {
    try {
      const info = await stat(path),
        identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`,
        stamp = `${identity}:${info.mtimeMs}:${info.size}`
      const cached = this.tails.get(path)
      if (cached?.stamp === stamp) return cached.records
      const records = await rolloutTail(path, this.paths.home)
      // Long tool output can push the last plan/quota out of the bounded tail. Retain an
      // observation already seen in this process, but never across a truncated/replaced file.
      if (cached && cached.identity === identity && info.size > cached.size) {
        if (!records.some((record) => readCodexPlan(record) !== null)) {
          const prior = cached.records.findLast((record) => readCodexPlan(record) !== null)
          if (prior) records.unshift(prior)
        }
        if (!codexUsage(records)) {
          const prior = cached.records.findLast((record) => codexUsage([record]) !== null)
          if (prior) records.unshift(prior)
        }
      }
      if (this.tails.size >= 200) this.tails.delete(this.tails.keys().next().value!)
      this.tails.set(path, { stamp, identity, size: info.size, records })
      return records
    } catch {
      return []
    }
  }
  async snapshot(view: TreeView = { expanded: null, showAll: [] }): Promise<Snapshot> {
    let db: DatabaseSync | undefined, history: DatabaseSync | undefined
    const empty: Snapshot = {
      provider: 'codex',
      sessions: [],
      workspaces: [],
      allWorkspaces: [],
      currentWorkspace: null,
      currentThreadId: null,
    }
    try {
      db = new DatabaseSync(this.paths.state, { readOnly: true })
      // SELECTs only, including on WAL databases. Never migrate a Codex-owned schema.
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100')
      const rows = db
        .prepare('SELECT * FROM threads WHERE archived=0 ORDER BY updated_at DESC LIMIT 5000')
        .all() as Row[]
      const edges = new Map<string, string>()
      try {
        for (const e of db
          .prepare('SELECT parent_thread_id,child_thread_id FROM thread_spawn_edges')
          .all() as Row[])
          edges.set(String(e['child_thread_id']), String(e['parent_thread_id']))
      } catch {
        /* older schema */
      }
      try {
        history = new DatabaseSync(this.paths.history, { readOnly: true })
        history.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100')
      } catch {
        /* legacy rollouts */
      }
      const focus = new Map<string, number>()
      try {
        const state = json(await readFile(this.paths.desktopState, 'utf8')),
          atoms = json(state['electron-persisted-atom-state'])
        for (const [key, value] of Object.entries(json(atoms['thread-user-activity-times-v1']))) {
          const pair: unknown = JSON.parse(key)
          if (
            Array.isArray(pair) &&
            pair[0] === 'local' &&
            typeof pair[1] === 'string' &&
            typeof value === 'number'
          )
            focus.set(pair[1], value)
        }
      } catch {
        /* optional UI activity metadata */
      }
      const valid = rows.filter(
        (row) =>
          CODEX_UUID.test(String(row['id'])) &&
          !this.hidden(codexKey(String(row['id'])), String(row['cwd'])),
      )
      const focused = valid
        .filter((row) => focus.has(String(row['id'])))
        .sort((a, b) => (focus.get(String(b['id'])) || 0) - (focus.get(String(a['id'])) || 0))[0]
      const currentWorkspace = focused ? String(focused['cwd']) : null
      const cutoff = Date.now() - this.windowHours * 3600_000
      const activity = (row: Row) =>
        Math.max(
          ms(row['updated_at_ms'] || row['updated_at']),
          this.hooks.records.get(codexKey(String(row['id'])))?.at || 0,
        )
      const groups = new Map<string, Row[]>()
      for (const row of valid) {
        const cwd = String(row['cwd'])
        groups.set(cwd, [...(groups.get(cwd) || []), row])
      }
      const built = new Map<string, Session>()
      let usage: Usage | null = null
      const observeUsage = (records: Row[]) => {
        const found = codexUsage(records)
        if (found && (!usage || found.at > usage.at)) usage = found
      }
      // Account usage must still appear when the chosen list window contains no chats.
      for (const row of valid.slice(0, 8))
        observeUsage(await this.tail(String(row['rollout_path'])))
      const build = async (row: Row): Promise<Session> => {
        const id = String(row['id']),
          key = codexKey(id),
          cached = built.get(key)
        if (cached) return cached
        let records: Row[] = [],
          turn: Row = {}
        if (history) {
          try {
            records = (
              history
                .prepare(
                  'SELECT item_json FROM thread_items WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 200',
                )
                .all(id) as Row[]
            )
              .reverse()
              .map((r) => json(r['item_json']))
            // A proposed plan can precede hundreds of tool events. Fetch it separately instead
            // of silently losing it when it falls outside the normal recent-items page.
            const priorPlan = history
              .prepare(
                "SELECT item_json FROM thread_items WHERE thread_id=? AND json_extract(item_json,'$.type')='plan' ORDER BY rollout_ordinal DESC LIMIT 1",
              )
              .get(id) as Row | undefined
            if (priorPlan) records.unshift(json(priorPlan['item_json']))
            turn = (history
              .prepare(
                'SELECT status,started_at,completed_at FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1',
              )
              .get(id) || {}) as Row
          } catch {
            /* use rollout fallback */
          }
        }
        const tail = await this.tail(String(row['rollout_path']))
        observeUsage(tail)
        // Paginated projections are authoritative for messages; tail still supplies token usage.
        const summary = summarizeCodex(records.length ? records : tail),
          tailSummary = summarizeCodex(tail)
        const live = await writerHeld(this.paths.locks, id)
        const hook = this.hooks.records.get(key)
        const fresh = hook && Date.now() - hook.at < 10 * 60_000 ? hook : null
        const attention = fresh
          ? fresh.attention || (fresh.state === 'waiting' ? summary.attention : null)
          : summary.attention
        const { state, tracked } = codexState(turn['status'], live, attention, fresh)
        const planSource = tailSummary.hasPlan ? tailSummary : summary
        const plan = planSource.plan
        const current = plan.findIndex((p) => p.status === 'in_progress')
        const currentStep =
          current < 0
            ? null
            : { index: current + 1, total: plan.length, content: plan[current]!.content }
        const lastReply = summary.lastReply || tailSummary.lastReply
        const lastAction = summary.lastAction || tailSummary.lastAction
        const cwd = String(row['cwd'])
        const session: Session = {
          provider: 'codex',
          id: key,
          appId: key,
          title:
            str(row['name']) ||
            str(row['title']) ||
            codexUserRequest(str(row['first_user_message']) || '')?.slice(0, 100) ||
            'Codex chat',
          cwd,
          state,
          tracked,
          thinking: state === 'working' && !lastAction,
          lastActiveAt: activity(row),
          focusedAt: focus.get(id) || 0,
          stage: codexStage(state, currentStep, lastAction, lastReply, attention),
          lastPrompt:
            summary.lastPrompt ||
            tailSummary.lastPrompt ||
            codexUserRequest(str(row['first_user_message']) || ''),
          plan,
          planText: planSource.planText,
          currentStep,
          recap: null,
          lastReply,
          lastAction,
          turnStartedAt: state === 'working' ? ms(turn['started_at']) || fresh?.at || null : null,
          backgroundTasks: [],
          live,
          git: this.gitFor(cwd),
          contextUsed: tailSummary.contextUsed,
          attention,
          permissionMode: str(row['approval_mode']),
          model: str(row['model']),
          pullRequests: [],
        }
        built.set(key, session)
        return session
      }
      const recent = valid.filter((row) => activity(row) > cutoff).slice(0, 200)
      const sessions = await Promise.all(recent.map(build))
      const order = { working: 0, waiting: 1, idle: 2 }
      sessions.sort((a, b) => order[a.state] - order[b.state] || b.lastActiveAt - a.lastActiveAt)
      const expanded = new Set(view.expanded ?? (currentWorkspace ? [currentWorkspace] : [])),
        all = new Set(view.showAll)
      const workspaces: Workspace[] = []
      for (const [cwd, members] of groups) {
        const recentMembers = members.filter((row) => activity(row) > cutoff)
        if (!recentMembers.length) continue
        const list = expanded.has(cwd)
          ? await Promise.all(
              (all.has(cwd) ? recentMembers : recentMembers.slice(0, this.maxSessions)).map(build),
            )
          : []
        const nodes = list.map((session) => ({
          session,
          children: [] as { session: Session; children: never[] }[],
        }))
        const byId = new Map(nodes.map((n) => [n.session.id, n]))
        const roots = nodes.filter((node) => {
          const parent = byId.get(codexKey(edges.get(node.session.id.slice(6)) || ''))
          // Avoid cycles; only one-level side-thread grouping is inferred here.
          if (parent && parent !== node && !edges.has(parent.session.id.slice(6))) {
            parent.children.push({ session: node.session, children: [] })
            return false
          }
          return true
        })
        const states = recentMembers.map(
          (row) => built.get(codexKey(String(row['id'])))?.state || 'idle',
        )
        workspaces.push({
          id: cwd,
          name: basename(cwd.replace(/\\/g, '/')) || cwd,
          threadCount: recentMembers.length,
          activeCount: states.filter((s) => s !== 'idle').length,
          anyWorking: states.includes('working'),
          threads: roots,
          hiddenCount: expanded.has(cwd) ? Math.max(0, recentMembers.length - list.length) : 0,
          worktrees: 0,
        })
      }
      this.lastError = ''
      return {
        provider: 'codex',
        codexUsage: usage,
        sessions: sessions.slice(0, this.maxSessions),
        workspaces,
        allWorkspaces: [...groups.keys()].map((id) => ({
          id,
          name: basename(id.replace(/\\/g, '/')) || id,
        })),
        currentWorkspace,
        currentThreadId: focused ? codexKey(String(focused['id'])) : null,
      }
    } catch (error) {
      const message = String(error)
      if (message !== this.lastError) console.error('Codex read-only scan unavailable', message)
      this.lastError = message
      return empty
    } finally {
      history?.close()
      db?.close()
    }
  }
}

export function codexStage(
  state: Session['state'],
  step: Session['currentStep'],
  action: string | null,
  reply: string | null,
  attention: Attention | null,
): string {
  if (state !== 'idle' && step)
    return `${state === 'waiting' ? 'Waiting for you · ' : ''}${step.index}/${step.total} · ${step.content}`
  if (attention) return attention.kind === 'approval' ? 'Needs approval' : 'Waiting for you'
  if (state === 'working') return action?.replace(/\s+/g, ' ').slice(0, 300) || 'Thinking'
  return reply?.replace(/\s+/g, ' ').slice(0, 300) || 'Ready'
}
