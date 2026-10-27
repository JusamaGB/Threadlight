import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { isObject, type JsonObject } from './json'
import { recordedPath, ThreadDiffLedger, type RecordedChange } from './threadDiff'

const edits = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const text = (value: unknown) => (typeof value === 'string' ? value : null)
const blocks = (record: JsonObject): JsonObject[] => {
  const message = isObject(record['message']) ? record['message'] : {}
  return Array.isArray(message['content']) ? message['content'].filter(isObject) : []
}

/** Successful edit tool/result pairs only; shell source, messages and sidechains are opaque. */
export class ClaudeThreadDiff {
  readonly ledger = new ThreadDiffLedger()
  private calls = new Map<string, JsonObject>()
  private completed = new Set<string>()
  private cwd: string
  constructor(cwd: string) {
    this.cwd = cwd
  }
  feed(record: JsonObject): void {
    if (record['isSidechain'] === true || record['is_sidechain'] === true) return
    this.cwd = text(record['cwd']) ?? this.cwd
    if (record['type'] === 'assistant') {
      for (const block of blocks(record))
        if (
          block['type'] === 'tool_use' &&
          edits.has(String(block['name'])) &&
          typeof block['id'] === 'string'
        ) {
          if (this.calls.size > 1000) {
            this.ledger.complete = false
            this.calls.clear()
          }
          this.calls.set(block['id'], block)
        }
      return
    }
    if (record['type'] !== 'user') return
    const results = blocks(record).filter((block) => block['type'] === 'tool_result')
    for (const result of results) {
      const id = text(result['tool_use_id'])
      if (!id || this.completed.has(id)) continue
      const call = this.calls.get(id)
      if (!call) continue
      this.calls.delete(id)
      this.completed.add(id)
      if (
        result['is_error'] === true ||
        (typeof result['content'] === 'string' && /^Error\b/.test(result['content']))
      )
        continue
      const input = isObject(call['input']) ? call['input'] : {}
      const rawPath = text(input['file_path']) ?? text(input['notebook_path'])
      const path = rawPath && recordedPath(rawPath, this.cwd)
      if (!path) {
        this.ledger.complete = false
        continue
      }
      const auxiliary =
        results.length === 1 ? (record['toolUseResult'] ?? record['tool_use_result']) : null
      const output = isObject(auxiliary) ? auxiliary : {}
      const before = text(output['originalFile']) ?? text(output['original_file'])
      const name = call['name']
      if (name === 'Write') {
        const after = text(input['content'])
        if (after === null) this.ledger.record({ path, kind: 'unknown' })
        else if (
          output['type'] === 'create' ||
          output['originalFile'] === null ||
          output['original_file'] === null
        )
          this.ledger.record({ path, kind: 'add', diff: after })
        else if (before !== null) this.ledger.record({ path, kind: 'update', before, after })
        else this.ledger.record({ path, kind: 'unknown' })
        continue
      }
      if (name === 'NotebookEdit') {
        this.ledger.record({ path, kind: 'unknown' })
        continue
      }
      const changes =
        name === 'MultiEdit' && Array.isArray(input['edits'])
          ? input['edits'].filter(isObject)
          : [input]
      if (before !== null) {
        let after = before
        let valid = true
        for (const change of changes) {
          const old = text(change['old_string']),
            next = text(change['new_string'])
          if (!old || next === null || !after.includes(old)) {
            valid = false
            break
          }
          after =
            change['replace_all'] === true
              ? after.split(old).join(next)
              : after.replace(old, () => next)
        }
        this.ledger.record(
          valid ? { path, kind: 'update', before, after } : { path, kind: 'unknown' },
        )
      } else if (Array.isArray(output['structuredPatch'])) {
        const diff = output['structuredPatch']
          .filter(isObject)
          .map(
            (hunk) =>
              `@@ -${hunk['oldStart']},${hunk['oldLines']} +${hunk['newStart']},${hunk['newLines']} @@\n${Array.isArray(hunk['lines']) ? hunk['lines'].join('\n') : ''}`,
          )
          .join('\n')
        this.ledger.record({ path, kind: 'update', diff })
      } else {
        // Local fragments are attributable but have no reliable file line positions.
        for (const change of changes) {
          const old = text(change['old_string']),
            next = text(change['new_string'])
          this.ledger.record(
            old !== null && next !== null
              ? { path, kind: 'unknown', before: old, after: next }
              : { path, kind: 'unknown' },
          )
        }
      }
    }
  }
}

/** Incremental byte reader: incomplete JSON/UTF-8 tails wait for the next append. */
export class ClaudeDiffReplay {
  reader: ClaudeThreadDiff
  private offset = 0
  private leftover = Buffer.alloc(0)
  private discard = false
  private modified = 0
  private inode: number | bigint = 0
  constructor(
    readonly path: string,
    private readonly cwd: string,
  ) {
    this.reader = new ClaudeThreadDiff(cwd)
  }
  async update(): Promise<void> {
    const info = await stat(this.path)
    if (
      info.size < this.offset ||
      (info.size === this.offset && info.mtimeMs !== this.modified) ||
      (this.inode && info.ino !== this.inode)
    ) {
      this.reader = new ClaudeThreadDiff(this.cwd)
      this.offset = 0
      this.leftover = Buffer.alloc(0)
      this.discard = false
    }
    if (info.size > this.offset) {
      for await (const chunk of createReadStream(this.path, {
        start: this.offset,
        end: info.size - 1,
      })) {
        let data = Buffer.concat([this.leftover, chunk as Buffer])
        let newline: number
        while ((newline = data.indexOf(10)) !== -1) {
          const line = data.subarray(0, newline)
          data = data.subarray(newline + 1)
          if (this.discard) {
            this.discard = false
            continue
          }
          if (line.length > 2 * 1024 * 1024) {
            this.reader.ledger.complete = false
            continue
          }
          try {
            const record: unknown = JSON.parse(line.toString('utf8'))
            if (isObject(record)) this.reader.feed(record)
          } catch {
            if (line.toString('utf8').trim()) this.reader.ledger.complete = false
          }
        }
        if (data.length > 2 * 1024 * 1024) {
          this.discard = true
          this.reader.ledger.complete = false
          this.leftover = Buffer.alloc(0)
        } else this.leftover = Buffer.from(data)
      }
      this.offset = info.size
    }
    this.modified = info.mtimeMs
    this.inode = info.ino
  }
}

/** The native projection contains provider-confirmed file changes, not inferred shell edits. */
export function codexThreadDiff(records: JsonObject[], cwd: string): ThreadDiffLedger {
  const ledger = new ThreadDiffLedger()
  const seen = new Set<string>()
  for (const record of records) {
    if (record['type'] !== 'fileChange' || record['status'] !== 'completed') continue
    const id = text(record['id'])
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    if (!Array.isArray(record['changes'])) {
      ledger.complete = false
      continue
    }
    for (const change of record['changes'].filter(isObject)) {
      const path = text(change['path'])
      const absolute = path && recordedPath(path, cwd)
      if (!absolute) {
        ledger.complete = false
        continue
      }
      const kind = isObject(change['kind']) ? change['kind'] : {}
      const type = kind['type']
      const mutation: RecordedChange = {
        path: absolute,
        kind: type === 'add' || type === 'update' || type === 'delete' ? type : 'unknown',
      }
      if (typeof change['diff'] === 'string') mutation.diff = change['diff']
      else mutation.kind = 'unknown'
      const move = text(kind['move_path'])
      if (move) mutation.move = recordedPath(move, cwd) ?? undefined
      ledger.record(mutation)
    }
  }
  return ledger
}

export function readCodexThreadDiff(
  history: string,
  id: string,
  cwd: string,
): ThreadDiffLedger | null {
  const db = new DatabaseSync(history, { readOnly: true })
  try {
    if (!db.prepare('SELECT 1 FROM thread_items WHERE thread_id=? LIMIT 1').get(id)) return null
    let rows: Iterable<Record<string, unknown>>
    try {
      rows = db
        .prepare(
          "SELECT CASE WHEN length(item_json)<=2097152 THEN item_json END AS item_json FROM thread_items WHERE thread_id=? AND item_type='fileChange' ORDER BY rollout_ordinal LIMIT 5001",
        )
        .iterate(id)
    } catch {
      rows = db
        .prepare(
          "SELECT CASE WHEN length(item_json)<=2097152 THEN item_json END AS item_json FROM thread_items WHERE thread_id=? AND json_extract(item_json,'$.type')='fileChange' ORDER BY rollout_ordinal LIMIT 5001",
        )
        .iterate(id)
    }
    const records: JsonObject[] = []
    let complete = true,
      bytes = 0
    for (const row of rows) {
      const value = row['item_json']
      if (typeof value !== 'string') {
        complete = false
        continue
      }
      bytes += value.length
      if (records.length >= 5000 || bytes > 16 * 1024 * 1024) {
        complete = false
        break
      }
      try {
        const item: unknown = JSON.parse(value)
        if (isObject(item)) records.push(item)
        else complete = false
      } catch {
        complete = false
      }
    }
    const ledger = codexThreadDiff(records, cwd)
    if (!complete) ledger.complete = false
    return ledger
  } finally {
    db.close()
  }
}
