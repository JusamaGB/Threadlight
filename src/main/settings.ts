// Loads and saves settings.json in Threadlight's own app data folder, atomically.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  parseSettings,
  SETTINGS_VERSION,
  validatePatch,
  type Settings,
  type SettingsPatch,
} from '../shared/settings'

export class SettingsStore {
  private current: Settings = parseSettings({})
  private readonly file: string

  constructor(private readonly dir: string) {
    this.file = join(dir, 'settings.json')
  }

  get settings(): Settings {
    return this.current
  }

  async load(): Promise<Settings> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      this.current = parseSettings(raw)
    } catch {
      this.current = parseSettings({}) // first run, or an unreadable file: start from defaults
    }
    return this.current
  }

  /** Validates and saves a change. `apply` may refuse it (e.g. a hotkey another app owns). */
  async update(
    patch: unknown,
    apply: (next: Settings, previous: Settings) => string | null = () => null,
  ): Promise<{ ok: true; settings: Settings } | { ok: false; reason: string }> {
    const checked = validatePatch(patch)
    if (!checked.ok) return checked
    const previous = this.current
    const next = { ...previous, ...(checked.patch as SettingsPatch) }
    const problem = apply(next, previous)
    if (problem) return { ok: false, reason: problem }
    this.current = next
    await this.save()
    return { ok: true, settings: next }
  }

  private async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const temporary = `${this.file}.tmp`
    await writeFile(
      temporary,
      JSON.stringify({ version: SETTINGS_VERSION, ...this.current }, null, 2),
    )
    await rename(temporary, this.file) // a crash mid-write never leaves a half-written file
  }
}
