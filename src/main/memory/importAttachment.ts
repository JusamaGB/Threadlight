import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import { MEMORY_ATTACHMENT_LIMIT } from '../../shared/memory'
import { SOURCE_EXTENSIONS, SOURCE_LIMIT, isSourceFile } from '../../shared/sourceReview'
import { attachmentMime } from './attachments'
import type { MemoryStore } from './store'

export async function importSelectedAttachment(
  memory: MemoryStore,
  folderId: string,
  choose: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>,
) {
  const destinations = memory.snapshot()
  const folder = destinations.folders.find((entry) => entry.id === folderId && !entry.archived)
  const space = destinations.spaces.find((entry) => entry.id === folder?.spaceId)
  if (!folder || !space) throw Error('Choose an active shared folder.')
  const choice = await choose({
    title: `Share a copy in ${space.title} / ${folder.title} with Brainstorm and chats granted access to this folder`,
    buttonLabel: 'Share copy',
    properties: ['openFile'],
    filters: [
      {
        name: 'Source files, documents and images',
        extensions: [...SOURCE_EXTENSIONS, 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'pdf'],
      },
    ],
  })
  const file = choice.filePaths[0]
  if (choice.canceled || !file) return { cancelled: true } as const
  const info = await stat(file)
  if (isSourceFile(basename(file)) && info.size > SOURCE_LIMIT)
    throw Error('Choose a source file of 32 KiB or less.')
  if (!info.isFile() || info.size > MEMORY_ATTACHMENT_LIMIT)
    throw Error('Choose a file no larger than 10 MiB.')
  const data = await readFile(file)
  return memory.importAttachment(
    folderId,
    basename(file),
    attachmentMime(data, basename(file)),
    data,
  )
}
