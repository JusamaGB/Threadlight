import { projectFileChanges } from './threadFileChanges'
import type { TimelineItem } from '../../shared/threadTimeline'
import { isObject, str } from '../sessions/json'
import { normalize, timestamp } from '../threadRead/normalize'

type ObjectValue = Record<string, unknown>
const forbidden = new Set(['__proto__', 'constructor', 'prototype'])

/** Immer's JSON-compatible patch subset. Copy only changed branches and reject bad paths. */
export function applyStreamPatches(state: ObjectValue, patches: unknown): ObjectValue {
  if (!Array.isArray(patches) || patches.length > 10_000) throw Error('Unsupported patches')
  let next: unknown = state
  for (const patch of patches) {
    if (
      !isObject(patch) ||
      !['add', 'replace', 'remove'].includes(String(patch.op)) ||
      !Array.isArray(patch.path) ||
      patch.path.length > 64 ||
      patch.path.some(
        (key) =>
          !(typeof key === 'string' || Number.isSafeInteger(key)) || forbidden.has(String(key)),
      )
    )
      throw Error('Unsupported patch')
    const path = patch.path as (string | number)[]
    const change = (value: unknown, depth: number): unknown => {
      if (depth === path.length) {
        if (patch.op === 'remove') throw Error('Cannot remove root')
        return patch.value
      }
      if (!Array.isArray(value) && !isObject(value)) throw Error('Missing patch parent')
      const key = path[depth]!,
        last = depth === path.length - 1
      if (Array.isArray(value)) {
        if (
          typeof key !== 'number' ||
          key < 0 ||
          key > value.length ||
          (key === value.length && !(last && patch.op === 'add'))
        )
          throw Error('Invalid array index')
        const copy = value.slice()
        if (!last) copy[key] = change(value[key], depth + 1)
        else if (patch.op === 'add') copy.splice(key, 0, patch.value)
        else if (patch.op === 'remove') copy.splice(key, 1)
        else copy[key] = patch.value
        return copy
      }
      if ((!last || patch.op !== 'add') && !Object.hasOwn(value, key))
        throw Error('Missing patch target')
      const copy = { ...value }
      if (!last) copy[key] = change(value[key], depth + 1)
      else if (patch.op === 'remove') delete copy[key]
      else copy[key] = patch.value
      return copy
    }
    next = change(next, 0)
  }
  if (!isObject(next)) throw Error('Invalid conversation state')
  return next
}

export function streamTurns(state: ObjectValue): ObjectValue[] {
  const legacy = Array.isArray(state.turns) ? state.turns.filter(isObject) : []
  const history =
    isObject(state.turnHistory) &&
    state.turnHistory.kind === 'canonical' &&
    isObject(state.turnHistory.history)
      ? state.turnHistory.history
      : null
  if (!history) return legacy
  if (!Array.isArray(history.islands) || !isObject(history.entitiesByKey))
    throw Error('Unknown native history')
  const entities = history.entitiesByKey
  const canonical = history.islands.filter(isObject).flatMap((island) =>
    (Array.isArray(island.entries) ? island.entries : []).filter(isObject).flatMap((entry) => {
      const turn =
        typeof entry.value === 'string' && Object.hasOwn(entities, entry.value)
          ? entities[entry.value]
          : null
      return isObject(turn) ? [turn] : []
    }),
  )
  // The native store may keep a streaming tail outside canonical history while hydrating.
  const ids = new Set(canonical.map((turn) => turn.turnId).filter(Boolean))
  return [...canonical, ...legacy.filter((turn) => !ids.has(turn.turnId))]
}

/** Extract only the short display heading from Codex's public summary, never its body/content. */
function publicActivityHeading(raw: ObjectValue): string | undefined {
  if (!Array.isArray(raw.summary)) return undefined
  for (const part of raw.summary.toReversed()) {
    if (typeof part !== 'string') continue
    const heading = part.match(/^\s*\*\*([^\r\n]{1,160}?)\*\*/)?.[1]?.trim()
    if (heading) return heading
  }
  return undefined
}

/** Only user-visible records cross into the renderer. Never forward the raw native store. */
export function projectStream(state: ObjectValue): TimelineItem[] {
  const result: TimelineItem[] = []
  for (const turn of streamTurns(state)) {
    const items = Array.isArray(turn.items) ? turn.items.filter(isObject) : []
    const completed = isObject(turn.completedItemIds) ? turn.completedItemIds : {}
    for (const raw of items) {
      if (typeof raw.id !== 'string') continue
      const complete =
        turn.status !== 'inProgress' ||
        completed[raw.id] === true ||
        raw.completed === true ||
        ['completed', 'failed', 'interrupted', 'declined'].includes(String(raw.status))
      const activity = (
        text: string,
        kind: NonNullable<TimelineItem['activity']>,
        detail?: string,
      ): TimelineItem => ({
        id: raw.id as string,
        role: 'activity',
        kind: 'tool',
        text,
        activity: kind,
        detail,
        phase: 'progress',
        at: timestamp(raw.startedAtMs ?? turn.turnStartedAtMs),
        turnId: str(turn.turnId),
        complete,
        source: 'codex_stream',
        failed: raw.status === 'failed' || (typeof raw.exitCode === 'number' && raw.exitCode !== 0),
      })
      let visible: TimelineItem[]
      if (raw.type === 'reasoning') {
        const heading = publicActivityHeading(raw)
        visible = heading ? [activity(heading, 'status')] : []
      } else if (raw.type === 'contextCompaction') {
        visible = [
          activity(
            complete
              ? raw.source === 'manual'
                ? 'Context compacted'
                : 'Context automatically compacted'
              : 'Compacting context',
            'compaction',
          ),
        ]
      } else if (raw.type === 'commandExecution') {
        const command = str(raw.command) ?? ''
        const actions = (Array.isArray(raw.commandActions) ? raw.commandActions : []).filter(
          isObject,
        )
        const loaded = actions.some(
          (action) =>
            action.type === 'read' && /(?:^|[\\/])SKILL\.md$/i.test(str(action.path) ?? ''),
        )
        const label = loaded
          ? complete
            ? 'Loaded a tool'
            : 'Loading a tool'
          : `${complete ? 'Ran' : 'Running'} ${command.replace(/\s+/g, ' ').trim().slice(0, 240) || 'a command'}`
        visible = [
          activity(
            label,
            loaded ? 'loaded-tool' : 'command',
            [
              command.slice(0, 8000),
              str(raw.aggregatedOutput)?.slice(-24_000),
              raw.exitCode == null ? null : `Exit code: ${raw.exitCode}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          ),
        ]
      } else if (raw.type === 'fileChange') {
        const changes = projectFileChanges(raw.changes)
        const failed = raw.status === 'failed' || raw.status === 'declined'
        const verb = failed
          ? 'Could not edit'
          : raw.status === 'completed'
            ? 'Edited'
            : complete
              ? 'Stopped editing'
              : 'Editing'
        const label = changes.count
          ? `${verb} ${changes.count} ${changes.count === 1 ? 'file' : 'files'}`
          : `${verb} files`
        visible = [
          {
            ...activity(label, 'files'),
            failed,
            fileChanges: changes.files,
            fileCount: changes.count,
          },
        ]
      } else if (raw.type === 'mcpToolCall') {
        let args: unknown = raw.arguments
        try {
          if (typeof args === 'string') args = JSON.parse(args)
        } catch {
          args = null
        }
        const label = isObject(args) ? str(args.title) : null
        const tool = [str(raw.server), str(raw.tool)].filter(Boolean).join(' · ') || 'Tool'
        visible = [
          activity(
            label?.trim().slice(0, 240) || tool,
            'tool',
            `${tool}\n${str(raw.status) ?? (complete ? 'Completed' : 'In progress')}`,
          ),
        ]
      } else if (raw.type === 'imageView') {
        visible = [
          activity(
            complete ? 'Viewed an image' : 'Viewing an image',
            'image',
            str(raw.path)?.slice(0, 2000),
          ),
        ]
      } else {
        visible = normalize('codex', { ...raw, turn_id: turn.turnId }, 'codex_stream', raw.id)
      }
      for (const item of visible) {
        item.at ??= timestamp(turn.turnStartedAtMs)
        item.complete = item.role === 'user' || complete
        item.text = item.text.slice(0, 64_000)
        result.push(item)
      }
    }
  }
  return [...new Map(result.map((item) => [item.id, item])).values()]
}
