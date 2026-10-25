// Reads one Claude Code transcript (JSON Lines) incrementally: each update() only reads
// bytes added since the last call. The record shapes are undocumented; everything we rely
// on is in this file.

import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'

import type {
  BackgroundTask,
  CardQuestion,
  CurrentStep,
  NextStepAction,
  PlanItem,
  PlanStatus,
} from '../../shared/types'
import { isObject, oneLine, str, type JsonObject } from './json'

/** Claude writes this as a user message when the user presses Stop. No hook fires for it. */
const INTERRUPT_MARKER = '[Request interrupted'

/**
 * A finished background task is reported back as a `<task-notification>` naming the tool call
 * that started it and a status (completed, failed, killed, stopped). It is copied into several
 * record types, so the raw line is searched rather than one record shape.
 */
const TASK_NOTIFICATION = /<tool-use-id>(toolu_\w+)<\/tool-use-id>[\s\S]*?<status>\w+<\/status>/g

/**
 * A tool result that opens by saying the call carries on in the background. Anchored, so a
 * command whose output merely mentions these words is not mistaken for one.
 */
const BACKGROUND_RESULT = /^\s*(Command running in background|Async agent launched)/

export interface TranscriptSummary {
  title: string | null
  cwd: string | null
  lastPrompt: string | null
  /** The plan, if it belongs to the current turn or still has a step in progress. */
  plan: PlanItem[]
  currentStep: CurrentStep | null
  recap: string | null
  lastReply: string | null
  lastAction: string | null
  /** When the current turn began (the prompt that started it), in milliseconds since the epoch. */
  turnStartedAt: number | null
  backgroundTasks: BackgroundTask[]
  /** A question card still waiting for its answer. */
  pendingQuestion: CardQuestion[] | null
  /** The last turn ended asking the user something, and nothing has been said since. */
  nextStep: { recap: string | null; ask: string; actions: NextStepAction[] } | null
  /**
   * How full the context was on the latest reply: everything sent to the model that turn
   * (fresh input plus cache writes and reads), as the Claude app counts it. Null before any.
   */
  contextTokens: number | null
  /** The model that wrote the latest reply. */
  model: string | null
  /** The user pressed Stop and nothing has happened since. */
  interrupted: boolean
}

interface ToolCall {
  label: string
  startedAt: number
}

export class TranscriptReader {
  private offset = 0
  private leftover = Buffer.alloc(0)

  private customTitle: string | null = null
  private agentName: string | null = null
  private firstPrompt: string | null = null
  private lastPrompt: string | null = null
  private cwd: string | null = null
  private turn = 0
  private plan: PlanItem[] = []
  private planTurn = -1
  private recap: string | null = null
  private lastReply: string | null = null
  private lastAction: string | null = null
  private turnStartedAt: number | null = null
  private interrupted = false
  private contextTokens: number | null = null
  private model: string | null = null
  /** Tool calls waiting for their result, in case the result says "running in background". */
  private calls = new Map<string, ToolCall>()
  /** Running background tasks by the tool call that started them. */
  private tasks = new Map<string, BackgroundTask>()
  /** A task's own id (e.g. a shell id, which TaskStop names) to its tool call. */
  private taskIds = new Map<string, string>()
  private pendingQuestion: { id: string; questions: CardQuestion[] } | null = null
  private nextStep: TranscriptSummary['nextStep'] = null

  constructor(readonly path: string) {}

  /** Reads anything new. Starts over if the file shrank (it was rewritten). */
  async update(): Promise<void> {
    let size: number
    try {
      size = (await stat(this.path)).size
    } catch {
      return
    }
    if (size < this.offset) this.reset()
    if (size === this.offset) return

    const handle = await open(this.path, 'r')
    try {
      const chunk = Buffer.alloc(size - this.offset)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset)
      this.offset += bytesRead
      this.consume(chunk.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  }

  summary(): TranscriptSummary {
    return {
      title: this.customTitle ?? this.agentName ?? (oneLine(this.firstPrompt).slice(0, 80) || null),
      cwd: this.cwd,
      lastPrompt: this.lastPrompt,
      plan: this.currentPlan(),
      currentStep: this.currentStep(),
      recap: this.recap,
      lastReply: this.lastReply,
      lastAction: this.lastAction,
      turnStartedAt: this.turnStartedAt,
      backgroundTasks: [...this.tasks.values()].map((task) => ({ ...task })),
      pendingQuestion: this.pendingQuestion?.questions ?? null,
      nextStep: this.nextStep,
      contextTokens: this.contextTokens,
      model: this.model,
      interrupted: this.interrupted,
    }
  }

  private reset(): void {
    Object.assign(this, new TranscriptReader(this.path))
  }

  /** Splits on newline bytes (not characters) so a multi-byte character cut by a read survives. */
  private consume(chunk: Buffer): void {
    let data = Buffer.concat([this.leftover, chunk])
    let newline = data.indexOf(0x0a)
    while (newline !== -1) {
      this.feedLine(data.subarray(0, newline).toString('utf8'))
      data = data.subarray(newline + 1)
      newline = data.indexOf(0x0a)
    }
    this.leftover = Buffer.from(data)
  }

  private feedLine(line: string): void {
    if (!line.trim()) return
    if (line.includes('task-notification')) {
      for (const [, toolUseId] of line.matchAll(TASK_NOTIFICATION)) this.tasks.delete(toolUseId!)
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      return // a damaged line should not stop the rest of the file
    }
    if (isObject(record)) this.feed(record)
  }

  private feed(record: JsonObject): void {
    const cwd = str(record['cwd'])
    if (cwd) this.cwd = cwd
    const sidechain = record['isSidechain'] === true // subagent traffic, not the main thread

    switch (record['type']) {
      case 'custom-title':
        this.customTitle = str(record['customTitle']) ?? this.customTitle
        break
      case 'agent-name':
        this.agentName = str(record['agentName']) ?? this.agentName
        break
      case 'last-prompt':
        this.lastPrompt = str(record['lastPrompt']) ?? this.lastPrompt
        break
      case 'user':
        if (sidechain) break
        this.feedResults(messageContent(record), record['toolUseResult'])
        if (record['isMeta'] !== true) this.feedUser(messageContent(record), timeOf(record))
        break
      case 'assistant':
        if (sidechain) break
        this.feedUsage(record['message'])
        this.feedAssistant(messageContent(record), timeOf(record))
        break
    }
  }

  private feedUser(content: unknown, at: number): void {
    const texts =
      typeof content === 'string'
        ? [content]
        : Array.isArray(content)
          ? content
              .filter(isObject)
              .filter((b) => b['type'] === 'text')
              .map((b) => str(b['text']) ?? '')
          : []
    if (texts.some((t) => t.trimStart().startsWith(INTERRUPT_MARKER))) {
      this.interrupted = true
      return
    }
    // Tool results carry no text blocks, and injected reminders start with "<".
    const prompts = texts.filter((t) => t.trim() && !t.trimStart().startsWith('<'))
    const prompt = prompts[0]
    if (prompt === undefined) return
    this.turn += 1
    this.turnStartedAt = at
    this.recap = null
    this.nextStep = null // whatever was asked, the user has now said something
    this.interrupted = false
    this.firstPrompt ??= prompt
    this.lastPrompt = prompt
  }

  /** The context size a reply was written with (a compaction shows as a sudden drop). */
  private feedUsage(message: unknown): void {
    if (!isObject(message)) return
    const usage = message['usage']
    if (!isObject(usage)) return
    const count = (key: string) => (typeof usage[key] === 'number' ? (usage[key] as number) : 0)
    const tokens =
      count('input_tokens') +
      count('cache_creation_input_tokens') +
      count('cache_read_input_tokens')
    // A synthetic reply (an error or a notice) carries no real usage; keep the last real one.
    if (tokens > 0) this.contextTokens = tokens
    const model = str(message['model'])
    if (model && !model.startsWith('<')) this.model = model
  }

  private feedAssistant(content: unknown, at: number): void {
    this.interrupted = false
    if (!Array.isArray(content)) return
    for (const block of content.filter(isObject)) {
      if (block['type'] === 'text') {
        const text = str(block['text'])
        if (text?.trim()) this.lastReply = text
      } else if (block['type'] === 'tool_use') {
        const name = str(block['name']) ?? ''
        const input = isObject(block['input']) ? block['input'] : {}
        const id = str(block['id'])
        if (id) this.calls.set(id, { label: describeTool(name, input), startedAt: at })
        this.feedTool(name, input, id)
      }
    }
  }

  /** Tool results: one that says "running in background" turns its call into a running task. */
  private feedResults(content: unknown, toolUseResult: unknown): void {
    if (!Array.isArray(content)) return
    for (const block of content.filter(isObject)) {
      if (block['type'] !== 'tool_result') continue
      const id = str(block['tool_use_id'])
      if (id && id === this.pendingQuestion?.id) this.pendingQuestion = null // answered
      const call = id ? this.calls.get(id) : undefined
      if (!id || !call) continue
      this.calls.delete(id)
      const details = isObject(toolUseResult) ? toolUseResult : {}
      // An agent that ran to the end in the foreground has an agentId too; only async ones count.
      const async = details['isAsync'] === true || details['status'] === 'async_launched'
      const taskId = str(details['backgroundTaskId']) ?? (async ? str(details['agentId']) : null)
      if (taskId === null && !async && !BACKGROUND_RESULT.test(resultText(block))) continue
      this.tasks.set(id, { id, ...call })
      if (taskId) this.taskIds.set(taskId, id)
    }
  }

  private feedTool(name: string, input: JsonObject, id: string | null): void {
    // Stopping a task by hand: its notification may never be written.
    if (name === 'TaskStop' || name === 'KillShell') {
      const taskId = str(input['task_id']) ?? str(input['shell_id'])
      const toolUseId = taskId ? this.taskIds.get(taskId) : undefined
      if (toolUseId) this.tasks.delete(toolUseId)
    }
    // The Claude app's task list and end-of-turn summary arrive as tool calls.
    if (name.endsWith('update_plan')) {
      this.applyPlan(input)
    } else if (name.endsWith('wrap_up')) {
      this.recap = str(input['recap'])
      for (const item of this.plan) item.status = 'completed'
      this.nextStep = parseNextStep(input, this.recap)
    } else if (name === 'AskUserQuestion') {
      const questions = parseQuestions(input)
      this.pendingQuestion = id && questions.length > 0 ? { id, questions } : null
      this.lastAction = describeTool(name, input)
    } else {
      this.lastAction = describeTool(name, input)
    }
  }

  /** Replays the app's plan updates: a full list, "advance", or explicit done/start indexes. */
  private applyPlan(input: JsonObject): void {
    const items = input['items']
    if (Array.isArray(items)) {
      this.plan = items.filter(isObject).map((item) => ({
        content: oneLine(str(item['content'])),
        status: toPlanStatus(item['status']),
      }))
      this.planTurn = this.turn
    }
    if (input['advance'] === true) {
      const current = this.plan.findIndex((item) => item.status === 'in_progress')
      if (current !== -1) this.plan[current]!.status = 'completed'
      const next = this.plan.findIndex((item, i) => i > current && item.status === 'pending')
      if (next !== -1) this.plan[next]!.status = 'in_progress'
    }
    const done = input['done']
    if (Array.isArray(done)) {
      for (const n of done) {
        const item = typeof n === 'number' ? this.plan[n - 1] : undefined
        if (item) item.status = 'completed'
      }
    }
    const start = input['start']
    const started = typeof start === 'number' ? this.plan[start - 1] : undefined
    if (started) started.status = 'in_progress'
  }

  private currentPlan(): PlanItem[] {
    const live = this.plan.some((item) => item.status === 'in_progress')
    return live || this.planTurn === this.turn ? this.plan.map((item) => ({ ...item })) : []
  }

  private currentStep(): CurrentStep | null {
    const index = this.plan.findIndex((item) => item.status === 'in_progress')
    const item = this.plan[index]
    return item ? { index: index + 1, total: this.plan.length, content: item.content } : null
  }
}

function messageContent(record: JsonObject): unknown {
  const message = record['message']
  return isObject(message) ? message['content'] : undefined
}

/** When a record was written; records without a time count as now. */
function timeOf(record: JsonObject): number {
  const at = Date.parse(str(record['timestamp']) ?? '')
  return Number.isNaN(at) ? Date.now() : at
}

function resultText(block: JsonObject): string {
  const content = block['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(isObject)
    .map((part) => str(part['text']) ?? '')
    .join('\n')
}

/** Claude marks its pick by ending the label with "(Recommended)"; the card shows a tag instead. */
const RECOMMENDED = /\s*\(recommended\)\s*$/i

function parseQuestions(input: JsonObject): CardQuestion[] {
  const questions = Array.isArray(input['questions']) ? input['questions'].filter(isObject) : []
  return questions.map((q) => ({
    header: oneLine(str(q['header'])),
    question: str(q['question']) ?? '',
    multiSelect: q['multiSelect'] === true,
    options: (Array.isArray(q['options']) ? q['options'].filter(isObject) : []).map((o) => {
      const label = str(o['label']) ?? ''
      return {
        label: label.replace(RECOMMENDED, ''),
        description: str(o['description']) ?? '',
        recommended: RECOMMENDED.test(label),
      }
    }),
  }))
}

/** A wrap_up with a question: the box Claude shows under its last message. */
function parseNextStep(input: JsonObject, recap: string | null): TranscriptSummary['nextStep'] {
  const ask = str(input['ask'])
  if (!ask) return null
  const actions = (Array.isArray(input['actions']) ? input['actions'].filter(isObject) : [])
    .map((a) => {
      const label = str(a['label'])
      if (!label) return null
      // An app action (commit, create a PR…) has no message: only the Claude app can do it.
      const appAction = str(a['action'])
      return { label, message: appAction ? null : (str(a['message']) ?? label) }
    })
    .filter((a): a is NextStepAction => a !== null)
  return { recap, ask, actions }
}

function toPlanStatus(value: unknown): PlanStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'pending'
}

/** A short, human description of a tool call, e.g. "Editing Panel.tsx". */
export function describeTool(name: string, input: JsonObject): string {
  const description = str(input['description'])
  if (description) return oneLine(description)
  const path = str(input['file_path']) ?? str(input['notebook_path'])
  if (path) {
    const verb = { Read: 'Reading', Edit: 'Editing', Write: 'Writing' }[name] ?? name
    return `${verb} ${basename(path)}`
  }
  if (name === 'Grep' || name === 'Glob') return `Searching ${oneLine(str(input['pattern']))}`
  if (name.startsWith('mcp__')) {
    const tool = (name.split('__').pop() ?? name).replaceAll('_', ' ')
    return tool.charAt(0).toUpperCase() + tool.slice(1)
  }
  return name
}
