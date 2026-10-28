import { workspaceFolder } from '../../shared/providers'

/** Same folder normalization as the chooser; only supplied known locations are considered. */
export function controlWorkspaces(known: { id: string; name: string }[]) {
  const unique = [...new Map(known.map((w) => [workspaceFolder(w.id), w])).entries()]
  return unique.map(([id, w]) => ({
    id,
    name: w.name.replace(/^(Claude|Codex) · /, ''),
    path: w.id.replace(/^(claude|codex):/, ''),
    parentId:
      unique
        .map(([key]) => key)
        .filter((key) => id.startsWith(`${key}/`))
        .sort((a, b) => b.length - a.length)[0] ?? null,
  }))
}
