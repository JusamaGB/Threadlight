import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  COMPOSER_FILE_LIMIT,
  type ComposerAttachment,
  type ComposerFileInput,
} from '../../shared/composerAttachments'

export interface NativeAttachment extends ComposerAttachment {
  path: string
}
const schema = z.array(
  z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(255),
    size: z.number().int().nonnegative(),
    kind: z.enum(['image', 'file']),
    path: z.string().min(1),
  }),
)
/** Owned copies stay available to native history after sending; drafts are thread-scoped. */
export class ComposerAttachmentStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private root: string) {}
  private directory(threadId: string) {
    return join(this.root, createHash('sha256').update(threadId).digest('hex'))
  }
  private async read(threadId: string): Promise<NativeAttachment[]> {
    try {
      return schema.parse(
        JSON.parse(await readFile(join(this.directory(threadId), 'draft.json'), 'utf8')),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  private async save(threadId: string, items: NativeAttachment[]) {
    const dir = this.directory(threadId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'draft.tmp'), JSON.stringify(items))
    await rename(join(dir, 'draft.tmp'), join(dir, 'draft.json'))
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }
  async list(threadId: string): Promise<ComposerAttachment[]> {
    await this.tail
    return (await this.read(threadId)).map(({ id, name, size, kind }) => ({ id, name, size, kind }))
  }
  add(threadId: string, file: ComposerFileInput) {
    return this.serial(async () => {
      const name = basename(file.name)
        .replace(/[<>:"/\\|?*]/g, '_')
        .split('')
        .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
        .join('')
        .slice(0, 200)
      if (
        !name ||
        name === '.' ||
        name === '..' ||
        (!file.path && !(file.bytes instanceof Uint8Array))
      )
        throw Error('Choose a file to attach.')
      if (file.path && (!isAbsolute(file.path) || !(await stat(file.path)).isFile()))
        throw Error('Only files can be attached.')
      const size = file.path ? (await stat(file.path)).size : file.bytes!.byteLength
      if (size > COMPOSER_FILE_LIMIT) throw Error('Files must be 512 MiB or smaller.')
      const id = randomUUID(),
        dir = join(this.directory(threadId), id),
        path = join(dir, name)
      await mkdir(dir, { recursive: true })
      if (file.path) await copyFile(file.path, path)
      else await writeFile(path, file.bytes!)
      const actual = (await stat(path)).size
      if (actual > COMPOSER_FILE_LIMIT)
        throw Error('The file grew beyond the 512 MiB attachment limit.')
      const item: NativeAttachment = {
        id,
        name,
        size: actual,
        path,
        kind: ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(name).toLowerCase())
          ? 'image'
          : 'file',
      }
      const items = await this.read(threadId)
      items.push(item)
      await this.save(threadId, items)
    })
  }
  remove(threadId: string, ids: string[]) {
    return this.serial(async () => {
      await this.save(
        threadId,
        (await this.read(threadId)).filter((item) => !ids.includes(item.id)),
      )
    })
  }
  async resolve(threadId: string, ids: string[]): Promise<NativeAttachment[]> {
    await this.tail
    const items = await this.read(threadId)
    const selected = ids.map((id) => items.find((item) => item.id === id))
    if (new Set(ids).size !== ids.length || selected.some((item) => !item))
      throw Error('An attachment is no longer available in this draft.')
    for (const item of selected)
      if (!(await stat(item!.path)).isFile())
        throw Error('An attached file is no longer available.')
    return selected as NativeAttachment[]
  }
}
