import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ThreadArtifact } from '../shared/artifacts'
import { attachmentMime } from './memory/attachments'
import { open } from 'node:fs/promises'
import { reference, referenceKind } from './artifactReferences'

export const ARTIFACT_LIMIT = 5 * 1024 * 1024

export async function readArtifactBytes(path: string): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > ARTIFACT_LIMIT)
      throw new Error('This file exceeds the 5 MiB viewer limit or is not a regular file.')
    const data = Buffer.alloc(ARTIFACT_LIMIT + 1)
    let length = 0
    while (length < data.length) {
      const { bytesRead } = await file.read(data, length, data.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > ARTIFACT_LIMIT) throw new Error('This file exceeds the 5 MiB viewer limit.')
    return data.subarray(0, length)
  } finally {
    await file.close()
  }
}

export function artifactContent(data: Buffer, filename: string) {
  const kind = referenceKind(filename)
  if (!kind || kind === 'unsupported')
    throw new Error('This file format is not supported by the viewer yet.')
  if (data.length > ARTIFACT_LIMIT) throw new Error('Choose a file smaller than 5 MiB.')
  if (kind === 'image') {
    const mime = attachmentMime(data, filename)
    if (!mime.startsWith('image/')) throw new Error('The file is not a supported image.')
    return { kind, mime, content: `data:${mime};base64,${data.toString('base64')}` }
  }
  const content = new TextDecoder('utf-8', { fatal: true }).decode(data)
  if (content.includes('\0')) throw new Error('The file is not UTF-8 text.')
  return { kind, mime: kind === 'html' ? 'text/html' : 'text/plain', content }
}

/** Explicit user imports, isolated by the provider-qualified thread ID. */
export class ArtifactStore {
  constructor(private root: string) {}

  private directory(threadId: string) {
    return join(this.root, createHash('sha256').update(threadId).digest('hex'))
  }

  list(threadId: string): ThreadArtifact[] {
    const file = join(this.directory(threadId), 'index.json')
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  }

  link(threadId: string, path: string): ThreadArtifact[] {
    const items = this.list(threadId)
    const item = reference(threadId, path)
    if (items.some((existing) => existing.id === item.id)) return items
    items.push(item)
    this.saveIndex(threadId, items)
    return items
  }

  private saveIndex(threadId: string, items: ThreadArtifact[]) {
    const directory = this.directory(threadId)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'index.tmp'), JSON.stringify(items))
    renameSync(join(directory, 'index.tmp'), join(directory, 'index.json'))
  }

  import(threadId: string, filename: string, data: Buffer): ThreadArtifact[] {
    if (data.length > ARTIFACT_LIMIT) throw new Error('Choose a file smaller than 5 MiB.')
    const items = this.list(threadId)
    if (items.filter((item) => item.source !== 'reference').length >= 20)
      throw new Error('This first version supports 20 saved copies per thread.')
    const { kind, mime, content } = artifactContent(data, filename)
    const item: ThreadArtifact = {
      id: randomUUID(),
      title: basename(filename),
      kind,
      mime,
      createdAt: Date.now(),
      source: 'copy',
    }
    const directory = this.directory(threadId)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, `${item.id}.txt`), content)
    items.push(item)
    this.saveIndex(threadId, items)
    return items
  }

  read(threadId: string, id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id) || !this.list(threadId).some((item) => item.id === id))
      throw new Error('Artifact not found in this thread.')
    return readFileSync(join(this.directory(threadId), `${id}.txt`), 'utf8')
  }
}
