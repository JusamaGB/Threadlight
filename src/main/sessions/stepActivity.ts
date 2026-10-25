// What a thread did on one plan step: the files it changed, the commands it ran (and whether
// they failed), the other tools it used and what it said, read from its transcript on demand.
//
// The plan's updates are replayed in order (replayPlan), and everything in between belongs to
// the step in progress at the time. Threads start the next step in the same message as the work
// that begins it, so a plan update also takes the rest of its own message along to the new step.
// Steps are named by their text, so a list sent again with the same steps keeps their history.

import { readFile } from 'node:fs/promises'

import type { PlanItem, StepActivity } from '../../shared/types'
import { isObject, str, type JsonObject } from './json'
import { replayPlan } from './transcript'

/**
 * What starting threads are told (hookServer's /context), so each plan step names the files it
 * means to change and why. Threadlight shows those next to what the step actually changed.
 */
export const PLAN_CONTEXT =
  'Threadlight, a companion app the user runs, shows each step of your task list (update_plan) with the files it means to change. ' +
  'Whenever you send update_plan a full "items" list, give every item two more fields: ' +
  '"files", the paths you expect that step to create or change, relative to your working folder ([] if none), ' +
  'and "why", one short sentence on what the step does and why. Keep them current when you send the list again.'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
/** Bookkeeping tools that say nothing about the work itself. */
const QUIET = /(^|__)(update_plan|wrap_up|mark_chapter)$|^ToolSearch$/
const MAX_SAID = 600

interface Entry {
  step: string | null
  messageId: string | null
  /** A file change, a command (by its tool call), another tool, or something said. */
  file?: { path: string; added: number; removed: number }
  command?: { id: string | null; label: string; command: string }
  tool?: string
  said?: string
}

/** The activity of the step named `content`, or null if the transcript cannot be read. */
export async function readStepActivity(
  transcriptPath: string,
  content: string,
): Promise<StepActivity | null> {
  let text: string
  try {
    text = await readFile(transcriptPath, 'utf8')
  } catch {
    return null
  }
  return stepActivity(text.split('\n'), content)
}

export function stepActivity(lines: string[], content: string): StepActivity {
  let plan: PlanItem[] = []
  let current: string | null = null
  let startedAt: number | null = null
  let endedAt: number | null = null
  const entries: Entry[] = []
  const failed = new Map<string, boolean>()

  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(record)) continue
    const message = isObject(record['message']) ? record['message'] : {}
    const blocks = Array.isArray(message['content']) ? message['content'].filter(isObject) : []
    if (record['type'] === 'user') {
      for (const block of blocks) {
        const id = str(block['tool_use_id'])
        if (block['type'] === 'tool_result' && id) failed.set(id, resultFailed(block))
      }
      continue
    }
    if (record['type'] !== 'assistant') continue
    const messageId = str(message['id'])
    const at = Date.parse(str(record['timestamp']) ?? '')

    for (const block of blocks) {
      if (block['type'] === 'text') {
        const said = str(block['text'])?.trim()
        if (said) entries.push({ step: current, messageId, said: said.slice(0, MAX_SAID) })
        continue
      }
      if (block['type'] !== 'tool_use') continue
      const name = str(block['name']) ?? ''
      const input = isObject(block['input']) ? block['input'] : {}
      const plans = name.endsWith('update_plan')
      if (plans || name.endsWith('wrap_up')) {
        // A wrap-up ends the plan: every step is done.
        plan = plans
          ? replayPlan(plan, input)
          : plan.map((item) => ({ ...item, status: 'completed' }))
        const next = plan.find((item) => item.status === 'in_progress')?.content ?? null
        if (next !== current) {
          if (current === content && endedAt === null) endedAt = at
          if (next === content) {
            startedAt ??= at
            endedAt = null
          }
          current = next
          // The rest of this message started the new step.
          for (let i = entries.length - 1; i >= 0 && messageId; i--) {
            if (entries[i]!.messageId !== messageId) break
            entries[i]!.step = next
          }
        }
        continue
      }
      if (QUIET.test(name)) continue
      entries.push({ step: current, messageId, ...describe(name, input, str(block['id'])) })
    }
  }
  return summarise(
    entries.filter((entry) => entry.step === content),
    failed,
    startedAt,
    endedAt,
  )
}

/** One tool call as an entry: a file change, a command, or just the tool's name. */
function describe(name: string, input: JsonObject, id: string | null): Partial<Entry> {
  const path = str(input['file_path']) ?? str(input['notebook_path'])
  if (path && name === 'Edit') {
    return {
      file: { path, added: lines(input['new_string']), removed: lines(input['old_string']) },
    }
  }
  if (path && name === 'MultiEdit' && Array.isArray(input['edits'])) {
    const edits = input['edits'].filter(isObject)
    return {
      file: {
        path,
        added: edits.reduce((n, e) => n + lines(e['new_string']), 0),
        removed: edits.reduce((n, e) => n + lines(e['old_string']), 0),
      },
    }
  }
  if (path && name === 'Write')
    return { file: { path, added: lines(input['content']), removed: 0 } }
  if (path && name === 'NotebookEdit') return { file: { path, added: 0, removed: 0 } }
  if (SHELL_TOOLS.has(name)) {
    const command = str(input['command']) ?? ''
    return { command: { id, label: str(input['description']) ?? command, command } }
  }
  // An app tool reads better without its server's prefix: mcp__ccd_session__start_session.
  return { tool: name.replace(/^mcp__.*?__/, '') }
}

function summarise(
  entries: Entry[],
  failed: Map<string, boolean>,
  startedAt: number | null,
  endedAt: number | null,
): StepActivity {
  const files = new Map<string, { path: string; added: number; removed: number }>()
  const tools = new Map<string, number>()
  const activity: StepActivity = {
    startedAt,
    endedAt,
    files: [],
    commands: [],
    tools: [],
    said: [],
  }
  for (const entry of entries) {
    if (entry.file) {
      const key = entry.file.path.replaceAll('\\', '/').toLowerCase()
      const seen = files.get(key)
      if (seen) {
        seen.added += entry.file.added
        seen.removed += entry.file.removed
      } else files.set(key, { ...entry.file })
    } else if (entry.command) {
      const { id, label, command } = entry.command
      activity.commands.push({ label, command, failed: id ? (failed.get(id) ?? null) : null })
    } else if (entry.tool) {
      tools.set(entry.tool, (tools.get(entry.tool) ?? 0) + 1)
    } else if (entry.said) {
      activity.said.push(entry.said)
    }
  }
  activity.files = [...files.values()]
  activity.tools = [...tools].map(([name, count]) => ({ name, count }))
  return activity
}

/** Whether a tool result reports failure: flagged as an error, or a non-zero exit code. */
function resultFailed(block: JsonObject): boolean {
  if (block['is_error'] === true) return true
  const content = block['content']
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter(isObject)
            .map((b) => str(b['text']) ?? '')
            .join('\n')
        : ''
  return /^Exit code [1-9]/m.test(text)
}

function lines(value: unknown): number {
  const text = typeof value === 'string' ? value : ''
  return text ? text.split('\n').length : 0
}
