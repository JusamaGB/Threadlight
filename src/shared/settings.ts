// Threadlight's settings: one schema, validated with zod, with a default for every field.
// The main process owns the file; the UI only ever sends changes through IPC.
// Settings are controlled through the panel and its settings view.

import { z } from 'zod'
import { DEFAULT_ENABLED_PROVIDERS, PROVIDERS } from './providers'

export const SETTINGS_VERSION = 1
export const SESSION_WINDOW_HOURS = [6, 12, 24, 72, 168] as const

export const settingsSchema = z.object({
  enabledProviders: z
    .array(z.enum(['claude', 'codex']))
    .max(2)
    .refine((list) => new Set(list).size === list.length, 'Choose each application once')
    .transform((list) => PROVIDERS.filter((provider) => list.includes(provider)))
    .default(DEFAULT_ENABLED_PROVIDERS),
  combinedFocusWorkspace: z.string().min(1).max(1100).nullable().default(null),
  codexFocusWorkspace: z.string().min(1).max(1000).nullable().default(null),
  /** Electron accelerator, e.g. "Control+Alt+Q". Press to start talking, again to stop. */
  talkHotkey: z.string().min(1).max(60).default('Control+Alt+Q'),
  /** Toggle: press to start talking, press again to send. Hold: talk while held, send on release. */
  talkMode: z.enum(['toggle', 'hold']).default('toggle'),
  /** Seconds a voice send waits before sending, so it can be cancelled. Never zero. */
  voiceCountdownSeconds: z.number().int().min(1).max(10).default(5),
  /** Hold: a spoken message waits in the composer until you click Send (no countdown). */
  voiceHold: z.boolean().default(false),
  /** Where hotkey speech goes, independently of Toggle / Push to talk. */
  voiceTarget: z.enum(['agent', 'thread']).default('thread'),
  /** Explicit speech engine; independent of the local transcript's destination. */
  voiceMode: z.enum(['local-stt', 'gpt-live']).default('local-stt'),
  /** Hover opens the panel straight away; click avoids opening it by accident in a game. */
  openOn: z.enum(['hover', 'click']).default('hover'),
  /** Tour explains all available hover targets immediately; Info preserves normal hints. */
  hoverHelp: z.enum(['tour', 'info', 'off']).default('info'),
  /** At Windows sign-in, start a quiet launcher that waits for Claude or Codex. */
  launchAtSignIn: z.boolean().default(false),
  /** The header's wire clip connects/disconnects workspace links. Opt in on first use. */
  workspaceWires: z.boolean().default(false),
  /** Single is the narrow column; dual widens the panel for Claude and Codex side by side. */
  panelLayout: z.enum(['single', 'dual']).default('single'),
  /**
   * What the full list (the "recent" view) shows: the most recent threads, one workspace with
   * all its threads (the workspace of the thread last open in Claude), or every workspace as
   * collapsible groups like the Claude sidebar.
   */
  listMode: z.enum(['recent', 'workspace', 'all']).default('recent'),
  /** The workspace the Workspace list shows (its folder), or null to follow the Claude app. */
  focusWorkspace: z.string().min(1).max(1000).nullable().default(null),
  /** Workspace view combines all known folders from the enabled applications. */
  workspaceAllDrives: z.boolean().default(false),
  /** Sessions active within this many hours are listed. There is always a limit. */
  listWindowHours: z.number().int().min(1).max(168).default(24),
  /** At most this many sessions are listed. */
  maxSessions: z.number().int().min(3).max(50).default(10),
  /** Workspace's picked maximum height in logical pixels; null uses the available work area. */
  workspacePanelHeight: z.number().int().min(120).max(16384).nullable().default(null),
  /**
   * How long an agent conversation stays open after its last reply, in minutes; then the next
   * message starts a fresh one (the old one stays on disk). 0: until it is ended by hand.
   */
  agentLifetimeMinutes: z.number().int().min(0).max(1440).default(60),
  /** The model that does the agent's real work (the conversation itself stays on Haiku). */
  agentWorker: z.enum(['opus', 'sonnet']).default('opus'),
  agentProvider: z.enum(['claude', 'codex']).default('claude'),
  agentCodexModel: z.string().min(1).max(200).nullable().default(null),
  agentCodexReasoning: z.string().min(1).max(40).nullable().default(null),
  agentCodexAppsOff: z.array(z.string().min(1).max(200)).max(100).default([]),
  /** Connected apps (MCP servers, by name) the agent may not use at all. */
  agentAppsOff: z.array(z.string().min(1).max(200)).max(100).default([]),
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
  // Migrate the old exclusive selector without turning on another app unexpectedly.
  const migrated: Record<string, unknown> = {
    ...stored,
    voiceTarget: stored['voiceTarget'] ?? (stored['openMic'] === true ? 'agent' : 'thread'),
    voiceMode:
      stored['voiceMode'] ??
      ((stored['voiceTarget'] === 'agent' ||
        (stored['voiceTarget'] === undefined && stored['openMic'] === true)) &&
      stored['agentProvider'] === 'codex' &&
      stored['talkMode'] !== 'hold'
        ? 'gpt-live'
        : 'local-stt'),
    enabledProviders:
      stored['enabledProviders'] ?? (stored['provider'] === 'codex' ? ['codex'] : ['claude']),
  }
  for (const [key, field] of Object.entries(settingsSchema.shape)) {
    const parsed = field.safeParse(migrated[key])
    result[key] = parsed.success ? parsed.data : DEFAULT_SETTINGS[key as keyof Settings]
  }
  return result as Settings
}

/** Live is an open conversation; retain the separate local push-to-talk preference. */
export const voiceHotkeyMode = (settings: Pick<Settings, 'voiceMode' | 'talkMode'>) =>
  settings.voiceMode === 'gpt-live' ? 'toggle' : settings.talkMode

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
