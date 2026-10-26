import { workspaceFolder } from '../../shared/providers'

export type KnownWorkspace = { id: string; name: string }
export interface WorkspaceFolder {
  key: string
  path: string
  name: string
  parent: string
  root: string
  /** Original adapter ID; absent for folders that only contain workspaces. */
  workspace?: KnownWorkspace
  children: WorkspaceFolder[]
  count: number
}

/** Display the folder without provider prefixes or Windows device-path syntax. */
export function workspacePath(id: string): string {
  const path = id
    .replace(/^(claude|codex):/, '')
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\/UNC\//i, '//')
    .replace(/^\/\/\?\/(?=[a-z]:\/)/i, '')
  return path.replace(/\/+$/, '') || '/'
}

function pathParts(path: string): { root: string; parts: string[] } {
  const drive = path.match(/^([a-z]:)(?:\/|$)/i)
  if (drive)
    return { root: drive[1]!.toUpperCase(), parts: path.slice(2).split('/').filter(Boolean) }
  const unc = path.match(/^(\/\/[^/]+\/[^/]+)(?:\/|$)/)
  if (unc) return { root: unc[1]!, parts: path.slice(unc[1]!.length).split('/').filter(Boolean) }
  if (path.startsWith('/')) return { root: '/', parts: path.split('/').filter(Boolean) }
  return { root: 'Other locations', parts: path.split('/').filter(Boolean) }
}

/** Build only the ancestors of known workspaces; never scan unrelated disk folders. */
export function workspaceExplorer(workspaces: KnownWorkspace[]) {
  const folderKey = (path: string) => (path === '/' ? '/' : workspaceFolder(path))
  const folders = new Map<string, WorkspaceFolder>()
  const roots: WorkspaceFolder[] = []
  for (const workspace of workspaces) {
    const path = workspacePath(workspace.id)
    const { root, parts } = pathParts(path)
    let parent = ''
    for (let index = -1; index < parts.length; index++) {
      const name = index < 0 ? root : parts[index]!
      const current = index < 0 ? root : `${parent === '/' ? '' : parent}/${name}`
      const key = folderKey(current)
      let folder = folders.get(key)
      if (!folder) {
        folder = {
          key,
          path: current,
          name,
          parent: folderKey(parent),
          root: folderKey(root),
          children: [],
          count: 0,
        }
        folders.set(key, folder)
        if (index < 0) roots.push(folder)
        else folders.get(folderKey(parent))!.children.push(folder)
      }
      if (index === parts.length - 1) folder.workspace = workspace
      parent = folder.path
    }
  }
  const sort = (items: WorkspaceFolder[]) => {
    items.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    )
    for (const item of items) {
      sort(item.children)
      item.count =
        Number(!!item.workspace) + item.children.reduce((count, child) => count + child.count, 0)
    }
  }
  sort(roots)
  return { folders, roots }
}

/** Search all known locations in the selected drive, including nested workspaces. */
export function searchWorkspaces(folders: WorkspaceFolder[], query: string, root: string) {
  const terms = query.trim().toLowerCase().replace(/\\/g, '/').split(/\s+/).filter(Boolean)
  const rank = (folder: WorkspaceFolder) =>
    folder.name.toLowerCase().startsWith(terms[0] ?? '') ? 0 : 1
  return folders
    .filter(
      (folder) =>
        folder.workspace &&
        (!root || folder.root === root) &&
        terms.every((term) =>
          `${folder.workspace!.name} ${folder.path}`.toLowerCase().includes(term),
        ),
    )
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path, undefined, { numeric: true }))
}
