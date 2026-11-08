import { expect, it } from 'vitest'
import { checkWindowsLogon, verifyWindowsLogon } from '../src/main/communication/windowsLogon'

it('requires both Windows user and logon identity', () => {
  const own = { sid: 'current-user', authenticationId: 'session-one' }
  expect(() => checkWindowsLogon(own, own)).not.toThrow()
  expect(() => checkWindowsLogon(own, { ...own, sid: 'another-user' })).toThrow('different')
  expect(() => checkWindowsLogon(own, { ...own, authenticationId: 'session-two' })).toThrow(
    'different',
  )
  expect(() =>
    checkWindowsLogon({ sid: '', authenticationId: '' }, { sid: '', authenticationId: '' }),
  ).toThrow()
})
it.runIf(process.platform === 'win32' && process.arch === 'x64')(
  'reads the real Windows process token without leaking handles and rejects invalid handles',
  () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const k = koffi.load('kernel32.dll')
    const current = k.func('void * __stdcall GetCurrentProcess()')
    const count = k.func('int __stdcall GetProcessHandleCount(void *, _Out_ uint32 *)')
    verifyWindowsLogon(current())
    const before = [0],
      after = [0]
    expect(count(current(), before)).toBe(1)
    for (let i = 0; i < 20; i++) verifyWindowsLogon(current())
    expect(count(current(), after)).toBe(1)
    expect(after[0]).toBeLessThanOrEqual(before[0]!)
    expect(() => verifyWindowsLogon(null)).toThrow('token')
  },
)
