import { existsSync, readFileSync, writeFileSync, renameSync, statSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pinLabel } from '../shared/codeReference'
import {
  pinCommand,
  pinState,
  pinVersion,
  versionNumbers,
  MAX_PIN_VERSIONS,
  PIN_READ_SIZE,
  type PinState,
} from '../shared/pinnedCode'

/** Only this store writes pin content. Source names and paths are display metadata. */
export class PinnedCodeStore {
  private state?: PinState
  constructor(
    private file: string,
    private changed: (state: PinState) => void,
  ) {}
  private save(next: PinState) {
    const value = pinState.parse(next)
    if (new Set(value.files.map((f) => f.id)).size !== value.files.length)
      throw Error('Duplicate pin ID.')
    const json = JSON.stringify(value)
    if (Buffer.byteLength(json) > 16_000_000)
      throw new RangeError(
        'Pinned references exceed the storage limit. Existing versions were retained.',
      )
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file + '.tmp', json, { mode: 0o600 })
    renameSync(this.file + '.tmp', this.file)
    this.state = value
    this.changed(value)
    return value
  }
  get current() {
    if (!this.state && existsSync(this.file)) {
      if (statSync(this.file).size > 16_000_000) throw Error('Pinned reference store is too large.')
      this.state = pinState.parse(JSON.parse(readFileSync(this.file, 'utf8')))
    }
    return this.state
  }
  get available() {
    try {
      return !!this.current
    } catch {
      return false
    }
  }
  request(raw: unknown): PinState {
    const cmd = pinCommand.parse(raw),
      state = this.current
    if (cmd.action === 'open') {
      if (state) return state
      return this.save({
        version: 1,
        generation: 1,
        selectedId: null,
        files: cmd.legacy ? JSON.parse(cmd.legacy) : [],
      })
    }
    if (!state) throw Error('Open pinned references first.')
    const next = { ...state, generation: state.generation + 1 }
    if (cmd.action === 'add') {
      if (state.files.some((f) => f.id === cmd.file.id)) return state
      next.files = [
        ...state.files,
        { ...cmd.file, revision: 1, history: undefined, viewedRevision: undefined },
      ]
      next.selectedId = cmd.file.id
    } else {
      const pin = state.files.find((f) => f.id === cmd.id)
      if (!pin) {
        if (cmd.action === 'remove') return state
        throw Error('That reference is no longer pinned.')
      }
      if (cmd.action === 'remove') {
        next.files = state.files.filter((f) => f.id !== cmd.id)
        if (next.selectedId === cmd.id) next.selectedId = null
      } else if (cmd.action === 'browse') {
        if (!pinVersion(pin, cmd.revision)) throw Error('That version is unavailable.')
        next.files = state.files.map((f) =>
          f === pin
            ? { ...f, viewedRevision: cmd.revision === f.revision ? undefined : cmd.revision }
            : f,
        )
        next.selectedId = pin.id
      } else if (cmd.action === 'select') {
        if (next.selectedId === cmd.id) return state
        next.selectedId = cmd.id
      } else {
        if (!!pin.collapsed === cmd.collapsed) return state
        next.files = state.files.map((f) => (f === pin ? { ...f, collapsed: cmd.collapsed } : f))
      }
    }
    return this.save(next)
  }
  list(offset: number, limit: number) {
    const state = this.current
    if (!state) throw Error('The panel has not opened pinned references yet.')
    return {
      selectedId: state.selectedId,
      items: state.files.slice(offset, offset + limit).map((pin) => {
        const { history: _history, code, ...meta } = pin
        const shown = pinVersion(pin) ?? { code, revision: pin.revision }
        return {
          ...meta,
          viewedRevision: shown.revision,
          versions: versionNumbers(pin),
          label: pinLabel({ ...pin, code: shown.code }),
          preview: shown.code.trimStart().slice(0, 100),
          length: shown.code.length,
        }
      }),
      nextOffset: offset + limit < state.files.length ? offset + limit : null,
    }
  }
  read(id: string, offset: number, revision?: number, version?: number) {
    const pin = this.current?.files.find((f) => f.id === id)
    if (!pin) return { outcome: 'not_found' as const, reason: 'Reference is no longer pinned.' }
    if (revision !== undefined && pin.revision !== revision)
      return { outcome: 'conflict' as const, reason: 'The pinned copy changed. Read it again.' }
    if (offset > 0 && version === undefined && revision === undefined)
      return { outcome: 'conflict' as const, reason: 'Specify the version for continued reads.' }
    const shown = pinVersion(pin, version ?? (offset > 0 ? revision : undefined))
    if (!shown) return { outcome: 'not_found' as const, reason: 'That version is unavailable.' }
    const { history: _history, ...meta } = pin
    return {
      outcome: 'ok' as const,
      data: {
        ...meta,
        revision: shown.revision,
        latestRevision: pin.revision,
        viewedRevision: pin.viewedRevision ?? pin.revision,
        versions: versionNumbers(pin),
        code: shown.code.slice(offset, offset + PIN_READ_SIZE),
        offset,
        nextOffset: offset + PIN_READ_SIZE < shown.code.length ? offset + PIN_READ_SIZE : null,
      },
    }
  }
  replace(id: string, expected: number, code: string, mode: 'append' | 'replace' = 'replace') {
    const state = this.current,
      pin = state?.files.find((f) => f.id === id)
    if (!state || !pin)
      return { outcome: 'not_found' as const, reason: 'Reference is no longer pinned.' }
    if (pin.revision !== expected)
      return {
        outcome: 'conflict' as const,
        reason: 'Pinned content changed. Read the current revision.',
      }
    const history = [...(pin.history ?? []), { revision: pin.revision, code: pin.code }]
    if (history.length >= MAX_PIN_VERSIONS)
      return {
        outcome: 'unavailable' as const,
        reason: 'Version limit reached. All saved versions were retained.',
      }
    const nextCode = mode === 'append' ? pin.code + code : code
    if (nextCode.length > 5_000_000)
      return { outcome: 'unavailable' as const, reason: 'Pinned copy exceeds the content limit.' }
    const revision = pin.revision + 1
    try {
      this.save({
        ...state,
        generation: state.generation + 1,
        files: state.files.map((f) =>
          f === pin ? { ...pin, revision, code: nextCode, history } : f,
        ),
      })
    } catch (error) {
      if (error instanceof RangeError)
        return { outcome: 'unavailable' as const, reason: error.message }
      throw error
    }
    return { outcome: 'ok' as const, data: { id, revision } }
  }
}
