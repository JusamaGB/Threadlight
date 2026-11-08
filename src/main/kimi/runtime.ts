import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'

import { kimiSetupKey, kimiSetupSchema, type KimiRuntimeInspection } from '../../shared/kimi'

// Main-owned identity from the artifact/provenance proof. Never accept a caller's hash.
const knownEntry = 'fd15d5c9b48892bb4f1d5fe82df9f790c8c19a44ca9a81054cc592b6fb9e2c90'
let inspecting = false

async function readBounded(file: string, root: string, maximum: number, deadline: number) {
  const canonical = await realpath(file)
  if (!canonical.startsWith(root + sep)) throw Error('Outside selected installation')
  const handle = await open(canonical, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maximum) throw Error('Not a bounded regular file')
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      if (Date.now() > deadline) throw Error('Inspection time limit')
      const buffer = Buffer.alloc(65536)
      const { bytesRead } = await handle.read(buffer)
      if (!bytesRead) break
      total += bytesRead
      if (total > maximum) throw Error('File changed or exceeded limit')
      chunks.push(buffer.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks)
  } finally {
    await handle.close()
  }
}

/** Reads only package.json and dist/main.mjs. No subprocess, session, credential or network API. */
export async function inspectLocalRuntime(input: unknown): Promise<KimiRuntimeInspection> {
  const setup = kimiSetupSchema.parse(input)
  const base = { configurationKey: kimiSetupKey(setup), checkedAt: new Date().toISOString() }
  if (setup.agent.kind !== 'local')
    return { ...base, status: 'unavailable', detail: 'Remote agent connection is not implemented.' }
  const selected = setup.agent.installationPath
  if (!selected)
    return { ...base, status: 'missing', detail: 'Choose the local Kimi Code package folder.' }
  if (!isAbsolute(selected))
    return { ...base, status: 'unavailable', detail: 'This path is not local to this computer.' }
  if (inspecting)
    return { ...base, status: 'unavailable', detail: 'Another runtime inspection is in progress.' }
  inspecting = true
  const work = (async (): Promise<KimiRuntimeInspection> => {
    try {
      const deadline = Date.now() + 3000
      const root = await realpath(selected)
      if (root.startsWith('\\\\') || root.startsWith('//')) throw Error('Remote path')
      const metadata: unknown = JSON.parse(
        (await readBounded(join(root, 'package.json'), root, 65536, deadline)).toString('utf8'),
      )
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        !('name' in metadata) ||
        metadata.name !== '@moonshot-ai/kimi-code' ||
        !('version' in metadata) ||
        typeof metadata.version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version) ||
        metadata.version.length > 80
      )
        return {
          ...base,
          status: 'unverified',
          detail: 'The selected folder is not a recognized Kimi Code package.',
        }
      const entry = await readBounded(
        join(root, 'dist', 'main.mjs'),
        root,
        32 * 1024 * 1024,
        deadline,
      )
      const entrySha256 = createHash('sha256').update(entry).digest('hex')
      const verified = metadata.version === '2.4.1' && entrySha256 === knownEntry
      return {
        ...base,
        status: verified ? 'verified' : 'unverified',
        version: metadata.version,
        entrySha256,
        detail: verified
          ? 'Package version and entry match the verified artifact. Dependencies and model are not checked.'
          : 'Package detected; its entry does not match the verified artifact. Nothing was executed.',
      }
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      return {
        ...base,
        status: missing ? 'missing' : 'unverified',
        detail: missing
          ? 'Kimi Code package or entry was not found.'
          : 'Could not verify this installation. Nothing was executed.',
      }
    } finally {
      inspecting = false
    }
  })()
  // Bound the caller's wait even if the filesystem stalls. Keep admission closed until
  // that owned read finishes; its finally blocks still close only its own handles.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<KimiRuntimeInspection>((done) => {
        timer = setTimeout(
          () =>
            done({
              ...base,
              status: 'unverified',
              detail: 'Runtime inspection timed out. Nothing was executed.',
            }),
          3000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
