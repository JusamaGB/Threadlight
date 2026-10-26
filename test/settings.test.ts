import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SettingsStore } from '../src/main/settings'
import { DEFAULT_SETTINGS, parseSettings, validatePatch } from '../src/shared/settings'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox
beforeEach(async () => (box = await sandbox()))
afterEach(() => box.cleanup())

describe('parseSettings', () => {
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
