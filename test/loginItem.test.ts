import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sandbox, type Sandbox } from './helpers'
import { launcherPaths, windowsPowerShell } from '../src/main/sessions/paths'

const mocks = vi.hoisted(() => ({
  profile: '',
  appPath: '',
  packaged: false,
  register: vi.fn(),
  query: vi.fn(),
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.profile,
    getAppPath: () => mocks.appPath,
    get isPackaged() {
      return mocks.packaged
    },
    setLoginItemSettings: mocks.register,
    getLoginItemSettings: mocks.query,
  },
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

import { launchesAtSignIn, loginItem, setLaunchAtSignIn } from '../src/main/loginItem'

let box: Sandbox
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(async () => {
  box = await sandbox()
  mocks.profile = box.root
  mocks.appPath = resolve('.')
  mocks.packaged = false
  vi.clearAllMocks()
  mocks.register.mockReset()
  mocks.query.mockReturnValue({ openAtLogin: false, launchItems: [] })
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  await box.cleanup()
})

const config = async () => JSON.parse(await readFile(launcherPaths(box.root).config, 'utf8'))

describe('Windows startup', () => {
  it('registers only the quiet watcher for both development and installed apps', () => {
    expect(loginItem(true)).toMatchObject({
      openAtLogin: true,
      name: 'Threadlight',
      path: windowsPowerShell(),
    })
    mocks.packaged = true
    expect(loginItem(true).args).toContain(launcherPaths(box.root).script)
  })

  it('uses one sign-in entry for a hidden watcher, and starts it without a console', async () => {
    setLaunchAtSignIn(true)
    const entry = mocks.register.mock.calls[0]![0]
    expect(entry).toMatchObject({
      name: 'Threadlight',
      openAtLogin: true,
      path: windowsPowerShell(),
    })
    expect(entry.args).toEqual(
      expect.arrayContaining([
        '-WindowStyle',
        'Hidden',
        launcherPaths(box.root).script,
        launcherPaths(box.root).config,
      ]),
    )
    expect(mocks.spawn).toHaveBeenCalledWith(entry.path, entry.args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })
    expect(await config()).toMatchObject({
      enabled: true,
      executable: process.execPath,
      owner: { id: process.pid },
    })
    expect(await readFile(launcherPaths(box.root).script, 'utf8')).toBe(
      await readFile(resolve('resources/app-launcher.ps1'), 'utf8'),
    )
  })

  it('turns off the watcher and removes the same sign-in entry when disabled', async () => {
    setLaunchAtSignIn(true)
    mocks.spawn.mockClear()
    setLaunchAtSignIn(false)
    expect(await config()).toMatchObject({ enabled: false })
    expect(mocks.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Threadlight', openAtLogin: false }),
    )
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('keeps --no-start setup isolated from the real profile and launches nothing', async () => {
    mocks.profile = resolve(box.root, 'setup-only')
    setLaunchAtSignIn(true, { userData: box.root, startWatcher: false })
    expect(await config()).toMatchObject({ enabled: true, owner: null })
    expect(mocks.register).toHaveBeenCalledWith(loginItem(true, box.root))
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('preserves the previous watcher configuration if Windows refuses the sign-in change', async () => {
    setLaunchAtSignIn(true)
    const previous = await config()
    mocks.spawn.mockClear()
    mocks.register.mockImplementationOnce(() => {
      throw new Error('Registration refused')
    })
    expect(() => setLaunchAtSignIn(false)).toThrow('Registration refused')
    expect(await config()).toEqual(previous)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('recognises the previous direct-app entry during an upgrade', () => {
    mocks.query
      .mockReturnValueOnce({ openAtLogin: false, launchItems: [] })
      .mockReturnValueOnce({ openAtLogin: true, launchItems: [] })
    expect(launchesAtSignIn()).toBe(true)
    expect(mocks.query).toHaveBeenLastCalledWith({
      path: process.execPath,
      args: [mocks.appPath],
    })
    mocks.query.mockReturnValue({ openAtLogin: false, launchItems: [] })
    expect(launchesAtSignIn()).toBe(false)
  })
})
