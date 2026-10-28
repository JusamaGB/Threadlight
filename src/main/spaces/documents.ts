import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { SpaceIdea, SpaceWorkspace, SpaceLocation } from '../../shared/spaces'
import type { MemoryStore } from '../memory/store'
import type { SpacesStore } from './store'

export const areas = ['notes', 'plans', 'handoffs', 'results'] as const
export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export const pathKey = (path: string) =>
  resolve(path).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
export function documentsRoot(workspace: SpaceWorkspace) {
  if (workspace.spaceDirectory && !/^[a-z0-9][a-z0-9-]{0,95}$/.test(workspace.spaceDirectory))
    throw new Error('Invalid shared space folder name.')
  return join(
    workspace.root,
    'shared-spaces',
    ...(workspace.spaceDirectory ? [workspace.spaceDirectory] : []),
  )
}
export function spaceFolderName(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70)
  if (!slug) throw new Error('Use a space name containing letters or numbers.')
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(slug) ? `space-${slug}` : slug
}
export function canonicalRoot(root: string): string {
  if (!isAbsolute(root)) throw new Error('Choose an absolute workspace directory.')
  const canonical = realpathSync.native(root)
  if (!lstatSync(canonical).isDirectory()) throw new Error('The workspace is not a directory.')
  return canonical
}
export function checkFolders(workspace: SpaceWorkspace, create = false) {
  if (pathKey(canonicalRoot(workspace.root)) !== pathKey(workspace.root))
    throw new Error(
      'The workspace location changed. Restore the original workspace before continuing.',
    )
  for (const path of [
    join(workspace.root, 'shared-spaces'),
    ...(workspace.spaceDirectory ? [documentsRoot(workspace)] : []),
    ...(!workspace.layout || workspace.spaceDirectory
      ? areas.map((area) =>
          join(
            documentsRoot(workspace),
            area === 'notes' &&
              !create &&
              !existsSync(join(documentsRoot(workspace), 'notes')) &&
              existsSync(join(documentsRoot(workspace), 'ideas'))
              ? 'ideas'
              : area,
          ),
        )
      : []),
  ]) {
    if (create && !existsSync(path)) mkdirSync(path)
    if (!existsSync(path))
      throw new Error(`Shared Spaces folder is missing: ${path}. Restore it or run setup again.`)
    if (
      !lstatSync(path).isDirectory() ||
      lstatSync(path).isSymbolicLink() ||
      pathKey(realpathSync.native(path)) !== pathKey(path)
    )
      throw new Error(
        `Shared Spaces requires a real folder at ${path}; redirected folders are not supported.`,
      )
  }
}
export function checkSpace(workspace: SpaceWorkspace, location: SpaceLocation, create = false) {
  const selected = { ...workspace, spaceDirectory: location.directory }
  checkFolders(selected, create)
  const manifest = join(documentsRoot(selected), 'space.json')
  const expected = {
    format: 'threadlight.shared-space',
    version: 1,
    id: location.spaceId,
    workspaceId: workspace.id,
    name: location.title,
    directory: location.directory,
  }
  if (create && !existsSync(manifest))
    writeFileSync(manifest, JSON.stringify(expected, null, 2) + '\n', { flag: 'wx' })
  if (
    !existsSync(manifest) ||
    lstatSync(manifest).isSymbolicLink() ||
    !lstatSync(manifest).isFile() ||
    lstatSync(manifest).size > 16384
  )
    throw new Error('The shared space identity file is missing or unavailable.')
  const actual = JSON.parse(readFileSync(manifest, 'utf8'))
  if (Object.entries(expected).some(([key, value]) => actual?.[key] !== value))
    throw new Error('The shared space identity file changed. Restore space.json before continuing.')
  const readme = join(documentsRoot(selected), 'README.md')
  if (create && !existsSync(readme))
    writeFileSync(
      readme,
      `# ${location.title}\n\nA Threadlight shared space in this workspace.\n\n- notes/: saved notes\n- plans/: reviewed plans\n- handoffs/: shared context and assignments\n- results/: saved outcomes\n- space.json: stable space identity and format version\n\nThreadlight keeps revision history, access permissions and conversations in its local database. Markdown files here are immutable snapshots; edit shared content in Threadlight. Original attachments stay in their existing storage.\n`,
      { flag: 'wx' },
    )
  return selected
}
export interface DocumentDraft {
  id: string
  area: (typeof areas)[number]
  body: string
}
export function ideaDocuments(idea: SpaceIdea): DocumentDraft[] {
  const docs: DocumentDraft[] = [
    {
      id: idea.id,
      area: 'notes',
      body: `# ${idea.title}\n\nDocument ID: ${idea.id}\nRevision: ${idea.revision}\n\n${idea.text}\n`,
    },
  ]
  if (idea.plan.trim())
    docs.push({
      id: `plan-${idea.id}`,
      area: 'plans',
      body: `# ${idea.title}\n\nNote or discussion ID: ${idea.id}\nRevision: ${idea.revision}\n\n${idea.plan}\n\n## Assignments\n\n${idea.assignments.map((a) => `### ${a.title}\n\nProvider: ${a.provider}\nChat: ${a.assignee}\n\n${a.brief}${a.rationale ? `\n\nAssignment rationale:\n${a.rationale}` : ''}`).join('\n\n')}\n`,
    })
  return docs
}
export function memoryDocuments(memory: MemoryStore, spaceIds: string[]): DocumentDraft[] {
  const data = memory.snapshot(),
    wanted = new Set(spaceIds)
  const resultIds = new Set(data.tasks.flatMap((t) => t.outputIds))
  const docs: DocumentDraft[] = data.items
    .filter((i) => wanted.has(i.spaceId))
    .map((item) => {
      const read = memory.read({}, item.id)
      return {
        id: item.id,
        area: resultIds.has(item.id) ? 'results' : 'handoffs',
        body: `# ${item.title}\n\nDocument ID: ${item.id}\nShared space: ${item.spaceId}\nRevision: ${item.revision}\nAuthor: ${read.revision.author}\nStatus: ${item.archived ? 'Archived' : 'Active'}\n${read.revision.filename ? `Attachment: ${read.revision.filename} (original retained in Threadlight)\n` : ''}\n${read.revision.body}\n`,
      }
    })
  for (const task of data.tasks.filter((t) => wanted.has(t.spaceId))) {
    docs.push({
      id: task.id,
      area: 'handoffs',
      body: `# ${task.title}\n\nAssignment ID: ${task.id}\nRecipient: ${task.assignee}\nStatus: ${task.state}\nPinned inputs: ${JSON.stringify(task.inputs)}\n\n${task.body}\n`,
    })
    if (task.reply || task.nativeReply || task.outputIds.length)
      docs.push({
        id: `result-${task.id}`,
        area: 'results',
        body: `# ${task.title}: result\n\nAssignment ID: ${task.id}\nStatus: ${task.state}\nSaved output IDs: ${task.outputIds.join(', ')}\n\n${task.reply || task.nativeReply}\n`,
      })
  }
  for (const message of data.messages.filter((m) => wanted.has(m.spaceId)))
    docs.push({
      id: message.id,
      area: 'handoffs',
      body: `# Discussion\n\nMessage ID: ${message.id}\nAuthor: ${message.author}\nItem: ${message.itemId ?? ''}\nAssignment: ${message.taskId ?? ''}\n\n${message.body}\n`,
    })
  return docs
}

/** Immutable snapshots: stable IDs, content-addressed versions, and no overwrite operations. */
export class SpaceDocuments {
  constructor(private store: SpacesStore) {}
  private checkedFile(workspace: SpaceWorkspace, path: string): string {
    const base = resolve(workspace.root, 'shared-spaces') + sep
    if (!resolve(path).startsWith(base)) throw new Error('Invalid shared document mapping.')
    if (!existsSync(path))
      throw new Error(`Shared document is missing: ${path}. Restore it before continuing.`)
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000)
      throw new Error(`Shared document is unavailable: ${path}`)
    if (pathKey(realpathSync.native(path)) !== pathKey(path))
      throw new Error(`Shared document is redirected outside its fixed mapping: ${path}`)
    return readFileSync(path, 'utf8')
  }
  target(workspace: SpaceWorkspace, doc: DocumentDraft) {
    if (!/^[a-z0-9-]+$/i.test(doc.id)) throw new Error('Invalid document ID.')
    return join(documentsRoot(workspace), doc.area, `${doc.id}-${digest(doc.body)}.md`)
  }
  conflicts(workspace: SpaceWorkspace, docs: DocumentDraft[]): string[] {
    const errors: string[] = []
    try {
      checkFolders(workspace)
    } catch (error) {
      return [(error as Error).message]
    }
    const heads = this.store.documents().filter((d) => d.workspaceId === workspace.id)
    for (const doc of docs) {
      try {
        const head = heads.find((h) => h.id === doc.id)
        if (head && digest(this.checkedFile(workspace, head.path)) !== head.hash)
          throw new Error(
            `External edit preserved: ${head.path}. Copy your edits into the app and restore the tracked snapshot before publishing another version.`,
          )
        const target = this.target(workspace, doc)
        if (existsSync(target) && this.checkedFile(workspace, target) !== doc.body)
          throw new Error(`Existing document conflict: ${target}. Nothing will be overwritten.`)
      } catch (error) {
        errors.push((error as Error).message)
      }
    }
    return errors
  }
  publish(workspace: SpaceWorkspace, docs: DocumentDraft[]) {
    const conflicts = this.conflicts(workspace, docs)
    if (conflicts.length) throw new Error(conflicts.join('\n'))
    const notes = join(documentsRoot(workspace), 'notes')
    if (docs.some((doc) => doc.area === 'notes') && !existsSync(notes)) mkdirSync(notes)
    checkFolders(workspace)
    for (const doc of docs) {
      const path = this.target(workspace, doc)
      checkFolders(workspace)
      if (!existsSync(path)) {
        try {
          writeFileSync(path, doc.body, { encoding: 'utf8', flag: 'wx' })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      // Recheck after creation: a racing external writer is never overwritten or accepted silently.
      if (this.checkedFile(workspace, path) !== doc.body)
        throw new Error(`Document changed while saving: ${path}. Your edit has been preserved.`)
      this.store.recordDocument({
        workspaceId: workspace.id,
        id: doc.id,
        path,
        hash: digest(doc.body),
        sourceHash: digest(doc.body),
      })
    }
  }
}
