// Threadlight's settings: one schema, validated with zod, with a default for every field.
// The main process owns the file; the UI only ever sends changes through IPC.
// Settings are controlled through the panel and its settings view.

import { z } from 'zod'
import { VOICE_PACES } from './voicePace'
import { DEFAULT_KIMI_SETUP, kimiSetupSchema } from './kimi'
import { DEFAULT_ENABLED_PROVIDERS, PROVIDERS } from './providers'
import { chatSource, conversationFilter } from './accountChats'

export const SETTINGS_VERSION = 1
export const SESSION_WINDOW_HOURS = [6, 12, 24, 72, 168] as const
export const SHOWN_PROVIDERS = ['claude', 'codex', 'perplexity', 'kimi'] as const
export type ShownProvider = (typeof SHOWN_PROVIDERS)[number]

export const settingsSchema = z.object({
  /** Work-provider visibility; ordinary chat sources remain independently selected. */
  shownProviders: z
    .array(z.enum(SHOWN_PROVIDERS))
    .max(4)
    .refine((values) => new Set(values).size === values.length, 'Choose each provider once')
    .transform((values) => SHOWN_PROVIDERS.filter((provider) => values.includes(provider)))
    .default(['claude', 'perplexity']),
  conversationFilter: conversationFilter.default('code-computer'),
  chatSources: z
    .array(chatSource)
    .max(2)
    .refine((v) => new Set(v).size === v.length)
    .default(['chatgpt', 'perplexity']),
  /** Non-executing connection draft; no credentials or capability claims. */
  kimiSetup: kimiSetupSchema.default(DEFAULT_KIMI_SETUP),
  /** Offer a per-space ignore choice at creation; never changes existing spaces. */
  sharedSpacesGitignore: z.boolean().default(false),
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
  pythonSuggestions: z.enum(['editor', 'on', 'off']).default('editor'),
  spokenGhostWalkthroughs: z.boolean().default(true),
  ghostPracticeLocation: z.enum(['current', 'copy']).default('current'),
  screenRegionModes: z
    .array(z.enum(['live', 'outside']))
    .max(2)
    .refine((values) => new Set(values).size === values.length)
    .default(['live']),
  speakScreenReply: z.boolean().default(true),
  /** Hover opens the panel straight away; click avoids opening it by accident in a game. */
  openOn: z.enum(['hover', 'click']).default('hover'),
  /** Tour explains all available hover targets immediately; Info preserves normal hints. */
  hoverHelp: z.enum(['tour', 'info', 'teach', 'off']).default('info'),
  /** At Windows sign-in, start a quiet launcher that waits for Claude or Codex. */
  launchAtSignIn: z.boolean().default(false),
  /** The header's wire clip connects/disconnects workspace links. Opt in on first use. */
  workspaceWires: z.boolean().default(false),
  /** Keep a live Active preview below other pages; controlled from the wire's context menu. */
  pinnedActiveThreads: z.boolean().default(false),
  /** Single is the narrow column; dual widens the panel for Claude and Codex side by side. */
  panelLayout: z.enum(['single', 'dual']).default('single'),
  /**
   * What the full list (the "recent" view) shows: the most recent threads, one workspace with
   * all its threads (the workspace of the thread last open in Claude), or every workspace as
   * collapsible groups like the Claude sidebar.
   */
  listMode: z.enum(['recent', 'workspace', 'all']).default('recent'),
  /** Shared folder scope for Active, Recent and Workspace; null follows the Claude app. */
  focusWorkspace: z.string().min(1).max(1000).nullable().default(null),
  /** Active, Recent and Workspace include all known folders from enabled applications. */
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
  spokenReplyCompanion: z.boolean().default(false),
  agentVoicePace: z.enum(VOICE_PACES).default('normal'),
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
  const shown = settingsSchema.shape.shownProviders.safeParse(stored['shownProviders'])
  if (stored['shownProviders'] === undefined || !shown.success)
    result.shownProviders = [
      ...(result.enabledProviders as Settings['enabledProviders']),
      'perplexity',
    ]
  else result.enabledProviders = PROVIDERS.filter((provider) => shown.data.includes(provider))
  return result as Settings
}

/** Keep the legacy coding filters and the four-provider selector in sync in every caller. */
export function applySettingsPatch(previous: Settings, patch: SettingsPatch): Settings {
  const next = { ...previous, ...patch }
  if (patch.shownProviders !== undefined)
    next.enabledProviders = PROVIDERS.filter((provider) => patch.shownProviders!.includes(provider))
  else if (patch.enabledProviders !== undefined)
    next.shownProviders = SHOWN_PROVIDERS.filter((provider) =>
      provider === 'claude' || provider === 'codex'
        ? patch.enabledProviders!.includes(provider)
        : previous.shownProviders.includes(provider),
    )
  return next
}

/** Live is an open conversation; retain the separate local push-to-talk preference. */
export function isGptLiveShortcut(settings: Pick<Settings, 'talkHotkey' | 'agentProvider'>) {
  const keys = settings.talkHotkey.toLowerCase().replace(/commandorcontrol|ctrl/g, 'control')
  return settings.agentProvider === 'codex' && keys.split('+').sort().join('+') === 'alt+control+q'
}
export const voiceHotkeyMode = (
  settings: Pick<Settings, 'voiceMode' | 'talkMode' | 'talkHotkey' | 'agentProvider'>,
) =>
  settings.voiceMode === 'gpt-live' || isGptLiveShortcut(settings) ? 'toggle' : settings.talkMode

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
