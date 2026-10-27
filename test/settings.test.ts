import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SettingsStore } from '../src/main/settings'
import {
  DEFAULT_SETTINGS,
  parseSettings,
  validatePatch,
  voiceHotkeyMode,
} from '../src/shared/settings'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox
beforeEach(async () => (box = await sandbox()))
afterEach(() => box.cleanup())

describe('parseSettings', () => {
  it('preserves the Info baseline, validates hover help modes and saves the choice', async () => {
    expect(parseSettings({}).hoverHelp).toBe('info')
    expect(parseSettings({ hoverHelp: 'invalid', maxSessions: 12 })).toMatchObject({
      hoverHelp: 'info',
      maxSessions: 12,
    })
    expect(validatePatch({ hoverHelp: 'always' }).ok).toBe(false)
    // There is always a time limit, and never more than a week.
    expect(validatePatch({ listWindowHours: 0 }).ok).toBe(false)
    expect(validatePatch({ listWindowHours: 169 }).ok).toBe(false)
    expect(validatePatch({ listWindowHours: 168 }).ok).toBe(true)
    // A settings file saved when the limit could be turned off falls back to the default for
    // that one field and keeps the rest.
    expect(parseSettings({ listWindowHours: 0, maxSessions: 12 })).toMatchObject({
      listWindowHours: 24,
      maxSessions: 12,
    })
    const store = new SettingsStore(box.root)
    await store.load()
    for (const hoverHelp of ['tour', 'off', 'info'] as const) {
      expect(validatePatch({ hoverHelp })).toEqual({ ok: true, patch: { hoverHelp } })
      await store.update({ hoverHelp })
      expect((await new SettingsStore(box.root).load()).hoverHelp).toBe(hoverHelp)
    }
  })
  it('migrates the previous effective engine and preserves explicit choices independently', () => {
    expect(
      parseSettings({ voiceTarget: 'agent', agentProvider: 'codex', talkMode: 'toggle' }).voiceMode,
    ).toBe('gpt-live')
    expect(
      parseSettings({ voiceTarget: 'agent', agentProvider: 'codex', talkMode: 'hold' }).voiceMode,
    ).toBe('local-stt')
    expect(parseSettings({ voiceTarget: 'agent', agentProvider: 'claude' }).voiceMode).toBe(
      'local-stt',
    )
    expect(
      parseSettings({ voiceMode: 'local-stt', voiceTarget: 'agent', agentProvider: 'codex' })
        .voiceMode,
    ).toBe('local-stt')
    expect(validatePatch({ voiceMode: 'gpt-live' })).toEqual({
      ok: true,
      patch: { voiceMode: 'gpt-live' },
    })
    expect(validatePatch({ voiceMode: 'automatic' }).ok).toBe(false)
    expect(voiceHotkeyMode({ ...DEFAULT_SETTINGS, voiceMode: 'gpt-live', talkMode: 'hold' })).toBe(
      'toggle',
    )
    expect(voiceHotkeyMode({ ...DEFAULT_SETTINGS, voiceMode: 'local-stt', talkMode: 'hold' })).toBe(
      'hold',
    )
  })
  it('fills in defaults and keeps every valid value', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ openOn: 'click', maxSessions: 15 })).toMatchObject({
      openOn: 'click',
      maxSessions: 15,
      voiceCountdownSeconds: 5,
      voiceHold: false,
    })
  })

  it('replaces only the bad fields, ignoring unknown ones', () => {
    const settings = parseSettings({
      voiceCountdownSeconds: 0, // never allowed: voice sends always count down
      openOn: 'sometimes',
      maxSessions: 12,
      someFutureSetting: true,
    })
    expect(settings.voiceCountdownSeconds).toBe(5)
    expect(settings.openOn).toBe('hover')
    expect(settings.maxSessions).toBe(12)
    expect(settings).not.toHaveProperty('someFutureSetting')
  })

  it('copes with junk', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
  })

  it('migrates the old mic preference and keeps voice target independent of activation', () => {
    expect(parseSettings({ openMic: true }).voiceTarget).toBe('agent')
    expect(parseSettings({ openMic: false }).voiceTarget).toBe('thread')
    expect(parseSettings({ openMic: true, voiceTarget: 'thread' }).voiceTarget).toBe('thread')
    expect(parseSettings({ voiceTarget: 'bad' }).voiceTarget).toBe('thread')
    for (const voiceTarget of ['agent', 'thread'])
      for (const talkMode of ['toggle', 'hold'])
        expect(validatePatch({ voiceTarget, talkMode })).toEqual({
          ok: true,
          patch: { voiceTarget, talkMode },
        })
    expect(validatePatch({ voiceTarget: 'room' }).ok).toBe(false)
    expect(parseSettings({ openMic: true })).not.toHaveProperty('openMic')
  })
})

describe('focusWorkspace', () => {
  it('persists all-drives scope without forgetting saved folder selections', async () => {
    const store = new SettingsStore(box.root)
    expect((await store.load()).workspaceAllDrives).toBe(false)
    await store.update({
      focusWorkspace: 'C:/saved',
      combinedFocusWorkspace: 'codex:Z:/General',
      workspaceAllDrives: true,
    })
    expect(await new SettingsStore(box.root).load()).toMatchObject({
      workspaceAllDrives: true,
      focusWorkspace: 'C:/saved',
      combinedFocusWorkspace: 'codex:Z:/General',
    })
    await store.update({ workspaceAllDrives: false })
    expect((await new SettingsStore(box.root).load()).workspaceAllDrives).toBe(false)
    expect(validatePatch({ workspaceAllDrives: 'all' }).ok).toBe(false)
  })
  it('defaults to following Claude and accepts a folder or null', () => {
    expect(parseSettings({}).focusWorkspace).toBeNull()
    expect(validatePatch({ focusWorkspace: 'C:\\demo\\ws' })).toEqual({
      ok: true,
      patch: { focusWorkspace: 'C:\\demo\\ws' },
    })
    expect(validatePatch({ focusWorkspace: null }).ok).toBe(true)
    expect(validatePatch({ focusWorkspace: '' }).ok).toBe(false)
  })
})

describe('validatePatch', () => {
  it('accepts good changes and refuses bad or unknown ones', () => {
    expect(validatePatch({ openOn: 'click' })).toEqual({ ok: true, patch: { openOn: 'click' } })
    expect(validatePatch({ voiceCountdownSeconds: 0 }).ok).toBe(false)
    expect(validatePatch({ launchAtSignIn: 'yes' }).ok).toBe(false)
    expect(validatePatch({ notASetting: 1 }).ok).toBe(false)
  })
})

describe('SettingsStore', () => {
  it('persists one sign-in preference and ignores an obsolete extra startup field', async () => {
    const store = new SettingsStore(box.root)
    expect((await store.load()).launchAtSignIn).toBe(false)
    await store.update({ launchAtSignIn: true })
    expect(await new SettingsStore(box.root).load()).toMatchObject({
      launchAtSignIn: true,
    })
    await store.update({ launchAtSignIn: false })
    expect(await new SettingsStore(box.root).load()).toMatchObject({
      launchAtSignIn: false,
    })
    expect(parseSettings({ launchWhenAppsOpen: true })).not.toHaveProperty('launchWhenAppsOpen')
    expect(validatePatch({ launchWhenAppsOpen: true }).ok).toBe(false)
  })
  it('defaults Workspace to full height and remembers a picked height across restarts', async () => {
    const store = new SettingsStore(box.root)
    expect((await store.load()).workspacePanelHeight).toBeNull()
    await store.update({ workspacePanelHeight: 540 })
    expect((await new SettingsStore(box.root).load()).workspacePanelHeight).toBe(540)
    expect(validatePatch({ workspacePanelHeight: 0 }).ok).toBe(false)
    expect(validatePatch({ workspacePanelHeight: 20000 }).ok).toBe(false)
  })

  it('defaults workspace wires off and remembers the header clip across restarts', async () => {
    const store = new SettingsStore(box.root)
    expect((await store.load()).workspaceWires).toBe(false)
    await store.update({ workspaceWires: true })
    expect((await new SettingsStore(box.root).load()).workspaceWires).toBe(true)
    await store.update({ workspaceWires: false })
    expect((await new SettingsStore(box.root).load()).workspaceWires).toBe(false)
    expect(validatePatch({ workspaceWires: 'on' }).ok).toBe(false)
  })
  it('migrates Agent defaults and preserves provider-specific choices across switches', async () => {
    await writeFile(
      join(box.root, 'settings.json'),
      JSON.stringify({ agentWorker: 'sonnet', agentAppsOff: ['claude-app'] }),
    )
    const store = new SettingsStore(box.root)
    expect(await store.load()).toMatchObject({
      agentProvider: 'claude',
      agentWorker: 'sonnet',
      agentCodexModel: null,
      agentCodexAppsOff: [],
    })
    await store.update({
      agentProvider: 'codex',
      agentCodexModel: 'future-model',
      agentCodexReasoning: 'future-effort',
      agentCodexAppsOff: ['codex-app'],
    })
    await store.update({ agentProvider: 'claude' })
    expect(await new SettingsStore(box.root).load()).toMatchObject({
      agentProvider: 'claude',
      agentWorker: 'sonnet',
      agentAppsOff: ['claude-app'],
      agentCodexModel: 'future-model',
      agentCodexReasoning: 'future-effort',
      agentCodexAppsOff: ['codex-app'],
    })
  })
  it('persists both enabled and paused states without forgetting legacy workspace choices', async () => {
    await writeFile(
      join(box.root, 'settings.json'),
      JSON.stringify({
        provider: 'codex',
        focusWorkspace: 'claude-folder',
        codexFocusWorkspace: 'codex-folder',
      }),
    )
    const store = new SettingsStore(box.root)
    expect((await store.load()).enabledProviders).toEqual(['codex'])
    await store.update({ enabledProviders: ['claude', 'codex'] })
    expect((await new SettingsStore(box.root).load()).enabledProviders).toEqual(['claude', 'codex'])
    await store.update({ enabledProviders: [] })
    expect(await new SettingsStore(box.root).load()).toMatchObject({
      enabledProviders: [],
      focusWorkspace: 'claude-folder',
      codexFocusWorkspace: 'codex-folder',
    })
  })
  it('saves changes and reads them back', async () => {
    const store = new SettingsStore(box.root)
    await store.load()
    expect(await store.update({ openOn: 'click', listWindowHours: 48 })).toMatchObject({ ok: true })

    const again = new SettingsStore(box.root)
    expect(await again.load()).toMatchObject({ openOn: 'click', listWindowHours: 48 })
    const file = JSON.parse(await readFile(join(box.root, 'settings.json'), 'utf8'))
    expect(file.version).toBe(1)
  })

  it('changing one setting leaves the others alone', async () => {
    const store = new SettingsStore(box.root)
    await store.load()
    await store.update({ maxSessions: 20 })
    await store.update({ openOn: 'click' })
    expect(store.settings).toMatchObject({ maxSessions: 20, openOn: 'click' })
  })

  it('does not save a change the app refuses', async () => {
    const store = new SettingsStore(box.root)
    await store.load()
    const result = await store.update(
      { talkHotkey: 'Control+Alt+X' },
      () => 'Taken by another app.',
    )
    expect(result).toEqual({ ok: false, reason: 'Taken by another app.' })
    expect(store.settings.talkHotkey).toBe('Control+Alt+Q')
  })

  it('starts from defaults when the file is unreadable', async () => {
    await writeFile(join(box.root, 'settings.json'), '{not json')
    expect(await new SettingsStore(box.root).load()).toEqual(DEFAULT_SETTINGS)
  })
})
