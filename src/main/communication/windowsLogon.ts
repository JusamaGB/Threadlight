export interface WindowsLogon {
  sid: string
  authenticationId: string
}
export function checkWindowsLogon(ours: WindowsLogon, theirs: WindowsLogon) {
  if (
    !ours.sid ||
    !ours.authenticationId ||
    ours.sid !== theirs.sid ||
    ours.authenticationId !== theirs.authenticationId
  )
    throw new Error('Native inbox belongs to a different Windows user or logon.')
}

let native: ReturnType<typeof windows> | undefined
function windows() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('Unsupported Windows token verification.')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const a = koffi.load('advapi32.dll'),
    k = koffi.load('kernel32.dll')
  const open = a.func('int __stdcall OpenProcessToken(void *, uint32, _Out_ void **)')
  const info = a.func(
    'int __stdcall GetTokenInformation(void *, int, void *, uint32, _Out_ uint32 *)',
  )
  const sidLength = a.func('uint32 __stdcall GetLengthSid(void *)')
  const close = k.func('int __stdcall CloseHandle(void *)')
  const current = k.func('void * __stdcall GetCurrentProcess()')
  const read = (processHandle: unknown): WindowsLogon => {
    const token = [null]
    if (!open(processHandle, 8, token)) throw new Error('Cannot inspect native inbox token.')
    try {
      const user = Buffer.alloc(1024),
        stats = Buffer.alloc(128),
        length = [0]
      if (
        !info(token[0], 1, user, user.length, length) ||
        !info(token[0], 10, stats, stats.length, length)
      )
        throw new Error('Cannot inspect native inbox logon.')
      const sid = koffi.decode(user, 'void *'),
        lengthOfSid = sidLength(sid)
      if (!lengthOfSid || lengthOfSid > 1024) throw new Error('Invalid Windows SID.')
      return {
        sid: Buffer.from(koffi.view(sid, lengthOfSid)).toString('hex'),
        authenticationId: stats.subarray(8, 16).toString('hex'),
      }
    } finally {
      close(token[0])
    }
  }
  return { read, current }
}
/** Called on the process obtained from the already-open pipe, before any credential write. */
export function verifyWindowsLogon(processHandle: unknown) {
  const api = (native ??= windows())
  checkWindowsLogon(api.read(api.current()), api.read(processHandle))
}
