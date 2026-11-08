import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { LiveScreen } from '../src/main/liveScreen'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
function helper() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    exitCode: null,
  })
}
beforeEach(() => vi.resetAllMocks())
it('enables either gesture independently and never reroutes a delayed crop after a mode change', () => {
  const processes = Array.from({ length: 4 }, () => helper())
  const next = [...processes]
  vi.mocked(spawn).mockImplementation(() => next.shift() as unknown as ReturnType<typeof spawn>)
  const crop = vi.fn(),
    screen = new LiveScreen('fixture', crop, vi.fn())
  screen.sync(null, [])
  expect(spawn).not.toHaveBeenCalled()
  screen.sync(null, ['outside'])
  processes[0]!.stdout.write('crop /9j/test /9j/thumb Q29kZQ==\n')
  expect(crop).toHaveBeenLastCalledWith(null, {
    jpeg: '/9j/test',
    thumbnail: '/9j/thumb',
    application: 'Code',
  })
  screen.sync('live-a', ['outside'])
  expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toContain('-InspectOnly')
  processes[0]!.stdout.write('crop /9j/old /9j/thumb\n')
  processes[1]!.stdout.write('crop /9j/old /9j/thumb\n')
  expect(crop).toHaveBeenCalledTimes(1)
  screen.sync('live-a', ['outside', 'live'])
  processes[2]!.stdout.write('crop /9j/live /9j/thumb\n')
  expect(crop).toHaveBeenLastCalledWith('live-a', { jpeg: '/9j/live', thumbnail: '/9j/thumb' })
  screen.sync(null, ['live'])
  processes[2]!.stdout.write('crop /9j/stale /9j/thumb\n')
  expect(crop).toHaveBeenCalledTimes(2)
  screen.close()
})
it('uses the window from speech time, follows later speech, and drops late crop bytes after closing', async () => {
  const first = helper(),
    second = helper()
  vi.mocked(spawn)
    .mockReturnValueOnce(first as unknown as ReturnType<typeof spawn>)
    .mockReturnValueOnce(second as unknown as ReturnType<typeof spawn>)
  let window = { handle: '11', pid: 123, executable: 'Editor.exe', title: 'Editor' }
  const crop = vi.fn()
  const screen = new LiveScreen(
    'fixture',
    crop,
    vi.fn(),
    () => window,
    () => BigInt(window.handle),
  )
  screen.sync('first')
  screen.voice(0.4)
  window = { handle: '12', pid: 321, executable: 'Player.exe', title: 'Player' }
  expect(await screen.observe('first', false)).toMatchObject({ application: 'Editor.exe' })
  screen.voice(0.4)
  expect(await screen.observe('first', false)).toMatchObject({ application: 'Player.exe' })
  first.stdout.write('crop /9j/test /9j/thumb\n')
  expect(crop).toHaveBeenCalledWith('first', { jpeg: '/9j/test', thumbnail: '/9j/thumb' })
  const pending = screen.observe('first', true)
  screen.sync('second')
  expect(await pending).toBeNull()
  expect(await screen.observe('first', false)).toBeNull()
  first.stdout.write('crop /9j/test /9j/thumb\n')
  expect(crop).toHaveBeenCalledTimes(1)
  screen.sync(null)
  expect(first.kill).toHaveBeenCalledOnce()
  expect(second.kill).toHaveBeenCalledOnce()
})
