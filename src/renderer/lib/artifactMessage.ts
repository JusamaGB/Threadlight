import type { ThreadArtifact } from '../../shared/artifacts'

export type ArtifactMessagePart =
  { type: 'text'; text: string } | { type: 'artifact'; label: string; id?: string }

/** Match local references to this chat's catalog only; never open a transcript path directly. */
function pathKey(value: string, cwd: string, encoded = true): string | null {
  let path = value.trim().replace(/^<|>$/g, '')
  try {
    if (encoded && /^file:/i.test(path)) {
      const url = new URL(path)
      if (url.hostname) return null
      path = decodeURIComponent(url.pathname)
    } else if (encoded) path = decodeURIComponent(path)
  } catch {
    return null
  }
  path = path.replace(/\\/g, '/').replace(/^\/\/\?\/(?=[a-z]:\/)/i, '')
  path = path.replace(/^\/([a-z]:\/)/i, '$1').replace(/:\d+(?::\d+)?$/, '')
  if (/^[a-z][\w+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path)) return null
  if (path.startsWith('//') || [...path].some((character) => character.charCodeAt(0) < 32))
    return null
  if (!/^([a-z]:\/|\/)/i.test(path)) {
    if (!cwd) return null
    return pathKey(`${cwd.replace(/[\\/]+$/, '')}/${path}`, '', false)
  }
  const drive = /^[a-z]:\//i.test(path)
  const prefix = drive ? path.slice(0, 3) : '/'
  const parts: string[] = []
  for (const part of path.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const normalized = prefix + parts.join('/')
  return drive ? normalized.toLowerCase() : normalized
}

/** Native previews and local Markdown files become named links, keeping prose/code intact. */
export function artifactMessageParts(
  text: string,
  items: readonly ThreadArtifact[],
  cwd: string,
): ArtifactMessagePart[] {
  const catalog = new Map<string, ThreadArtifact>()
  for (const item of items) {
    const key = item.path ? pathKey(item.path, cwd, false) : null
    if (key && (!catalog.has(key) || item.source === 'reference')) catalog.set(key, item)
  }
  const parts: ArtifactMessagePart[] = []
  // Code examples remain literal. The Markdown destination syntax matches discovery.
  const tokens =
    /```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]*`|\uE200visualize\uE202([^\uE200\uE201]*)\uE201|!?\[[^\]\n]*\]\((<[^>\n]+>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g
  let cursor = 0
  for (const match of text.matchAll(tokens)) {
    if (match[0].startsWith('`')) continue
    let path: string | undefined
    let previewTitle: string | undefined
    const native = match[1] !== undefined
    if (native) {
      try {
        const value: unknown = JSON.parse(match[1]!)
        if (
          value &&
          typeof value === 'object' &&
          'path' in value &&
          typeof value.path === 'string'
        ) {
          path = value.path
          if ('title' in value && typeof value.title === 'string') previewTitle = value.title.trim()
        }
      } catch {
        // Incomplete/malformed source remains visible rather than becoming a fabricated link.
      }
    } else path = match[2]?.replace(/\s+"[^"\n]*"$/, '')
    const key = path ? pathKey(path, cwd) : null
    if (!key) continue
    const artifact = catalog.get(key)
    // Ordinary file links that have not been discovered retain their original text.
    if (!artifact && !native) continue
    if (match.index > cursor) parts.push({ type: 'text', text: text.slice(cursor, match.index) })
    parts.push({
      type: 'artifact',
      label:
        artifact?.title || previewTitle || path!.replace(/\\/g, '/').split('/').at(-1) || 'Preview',
      id: artifact?.id,
    })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) })
  return parts
}
