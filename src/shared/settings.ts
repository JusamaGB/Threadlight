// Threadlight's settings: one schema, validated with zod, with a default for every field.
// The main process owns the file; the UI only ever sends changes through IPC.
// Every setting here has a control in the panel's settings view.

import { z } from 'zod'

export const SETTINGS_VERSION = 1

export const settingsSchema = z.object({
  /** Electron accelerator, e.g. "Control+Alt+Q". Press to start talking, again to stop. */
  talkHotkey: z.string().min(1).max(60).default('Control+Alt+Q'),
  /** Seconds a voice send waits before sending, so it can be cancelled. Never zero. */
  voiceCountdownSeconds: z.number().int().min(1).max(10).default(3),
  /** Hover opens the panel straight away; click avoids opening it by accident in a game. */
  openOn: z.enum(['hover', 'click']).default('hover'),
  /** Start Threadlight when you sign in to Windows. Off until you turn it on. */
  launchAtSignIn: z.boolean().default(false),
  /**
   * What the full list (the "recent" view) shows: the most recent threads, one workspace with
   * all its threads (the workspace of the thread last open in Claude), or every workspace as
   * collapsible groups like the Claude sidebar.
   */
  listMode: z.enum(['recent', 'workspace', 'all']).default('recent'),
  /** Sessions active within this many hours are listed. */
  listWindowHours: z.number().int().min(1).max(168).default(24),
  /** At most this many sessions are listed. */
  maxSessions: z.number().int().min(3).max(25).default(10),
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingsPatch = Partial<Settings>

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

/**
 * Reads stored settings forgivingly: anything missing, unknown or invalid falls back to its
 * default on its own, so one bad value (or a file from a newer version) never loses the rest.
 */
export function parseSettings(raw: unknown): Settings {
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(settingsSchema.shape)) {
    const parsed = field.safeParse(stored[key])
    result[key] = parsed.success ? parsed.data : DEFAULT_SETTINGS[key as keyof Settings]
  }
  return result as Settings
}

/** Validates a change strictly: unknown keys or bad values are refused with a reason. */
export function validatePatch(
  patch: unknown,
): { ok: true; patch: SettingsPatch } | { ok: false; reason: string } {
  const parsed = settingsSchema.partial().strict().safeParse(patch)
  if (parsed.success) {
    // zod still fills in defaults for fields that were left out; a change must only carry the
    // fields it actually changes, or saving one setting would reset all the others.
    const given = new Set(Object.keys(patch as object))
    const changed = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) => given.has(key)),
    )
    return { ok: true, patch: changed as SettingsPatch }
  }
  const issue = parsed.error.issues[0]
  return {
    ok: false,
    reason: issue ? `${issue.path.join('.') || 'settings'}: ${issue.message}` : 'Invalid settings.',
  }
}
