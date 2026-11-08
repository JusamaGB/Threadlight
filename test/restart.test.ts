import { afterEach, expect, it, vi } from 'vitest'
import { restartAction } from '../src/main/restart'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it('arms the independent guard before scheduling one relaunch and allows graceful cleanup', () => {
  vi.useFakeTimers()
  const order: string[] = []
  const application = {
    relaunch: vi.fn(() => {
      order.push('relaunch')
    }),
    quit: vi.fn(() => {
      order.push('quit')
    }),
    exit: vi.fn(),
  }
  const cancel = vi.fn()
  const restart = restartAction(application, () => {
    order.push('watchdog')
    return cancel
  })
  restart()
  restart()
  expect(order).toEqual(['watchdog', 'relaunch', 'quit'])
  expect(cancel).not.toHaveBeenCalled()
  vi.advanceTimersByTime(6000)
  expect(application.exit).toHaveBeenCalledWith(0)
})
it('keeps the current app when the guard cannot arm and permits a later retry', () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const application = { relaunch: vi.fn(), quit: vi.fn(), exit: vi.fn() }
  const watchdog = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('not ready')
    })
    .mockReturnValue(() => {})
  const restart = restartAction(application, watchdog)
  restart()
  expect(application.quit).not.toHaveBeenCalled()
  restart()
  expect(application.relaunch).toHaveBeenCalledOnce()
})
it('cancels the guard if relaunch scheduling fails, leaving the current app alive', () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const cancel = vi.fn()
  const application = {
    relaunch: vi.fn(() => {
      throw new Error('cannot relaunch')
    }),
    quit: vi.fn(),
    exit: vi.fn(),
  }
  restartAction(application, () => cancel)()
  expect(cancel).toHaveBeenCalledOnce()
  expect(application.quit).not.toHaveBeenCalled()
  vi.advanceTimersByTime(9000)
  expect(application.exit).not.toHaveBeenCalled()
})
