/** A private, non-inheritable Windows job. Only the gated launcher is assigned to it. */
export interface ProcessJob {
  assign(pid: number): void
  terminate(): void
  active(): number
  close(): void
}

export function windowsProcessJob(): ProcessJob {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch))
    throw new Error('Owned Windows processes require a 64-bit Windows runtime.')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const kernel = koffi.load('kernel32.dll')
  const create = kernel.func('void * __stdcall CreateJobObjectW(void *, str16)')
  const configure = kernel.func(
    'int __stdcall SetInformationJobObject(void *, int, void *, uint32)',
  )
  const assign = kernel.func('int __stdcall AssignProcessToJobObject(void *, void *)')
  const terminate = kernel.func('int __stdcall TerminateJobObject(void *, uint32)')
  const query = kernel.func(
    'int __stdcall QueryInformationJobObject(void *, int, void *, uint32, void *)',
  )
  const open = kernel.func('void * __stdcall OpenProcess(uint32, int, uint32)')
  const close = kernel.func('int __stdcall CloseHandle(void *)')
  const job = create(null, null)
  if (!job) throw new Error('Could not create an Agent process job.')
  // JOBOBJECT_EXTENDED_LIMIT_INFORMATION on 64-bit Windows: LimitFlags at byte 16.
  const limits = Buffer.alloc(144)
  limits.writeUInt32LE(0x2000, 16) // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
  if (!configure(job, 9, limits, limits.length)) {
    close(job)
    throw new Error('Could not configure Agent process cleanup.')
  }
  let closed = false
  return {
    assign(pid) {
      const handle = open(0x0101, 0, pid) // PROCESS_SET_QUOTA | PROCESS_TERMINATE
      if (!handle) throw new Error('Could not open the Agent launcher for ownership.')
      try {
        if (!assign(job, handle)) throw new Error('Could not contain the Agent process tree.')
      } finally {
        close(handle)
      }
    },
    terminate() {
      if (!closed && !terminate(job, 1)) throw new Error('Could not stop the Agent process tree.')
    },
    active() {
      if (closed) return 0
      const accounting = Buffer.alloc(48)
      if (!query(job, 1, accounting, accounting.length, null))
        throw new Error('Could not verify Agent process cleanup.')
      return accounting.readUInt32LE(40)
    },
    close() {
      if (closed) return
      closed = true
      close(job)
    },
  }
}
