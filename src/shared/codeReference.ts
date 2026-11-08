import type { ThreadArtifact } from './artifacts'

import type { CodeFile, CodeReference } from './pinnedCode'
export type { CodeFile, CodeReference } from './pinnedCode'

/** Fence metadata labels a reply. It does not establish a local file association. */
export function replyFile(meta: unknown): CodeFile | undefined {
  if (typeof meta !== 'string') return
  const fields = meta.matchAll(/(?:^|\s+)([^\s=]+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?=\s|$)/g)
  const match = Array.from(fields).find((field) => field[1]?.toLowerCase() === 'filename')
  const path = (match?.[2] ?? match?.[3] ?? match?.[4])?.trim()
  if (
    !path ||
    path.length > 4096 ||
    path.includes('\n') ||
    path.includes('\r') ||
    path.includes('\0')
  )
    return
  const name = path.split(/[\\/]/).at(-1)
  if (name) return { name, kind: 'reply', ...(path !== name ? { path } : {}) }
}

export function artifactCodeFile(item: ThreadArtifact): CodeFile {
  return {
    name: (item.path || item.title).split(/[\\/]/).at(-1) || item.title,
    kind: item.path || item.source === 'reference' ? 'reference' : 'copy',
    path: item.path,
  }
}

export function fileLanguage(name: string) {
  const extension = name.toLowerCase().split('.').at(-1) ?? ''
  const languages: Record<string, string> = {
    py: 'python',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    css: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    svg: 'xml',
    toml: 'toml',
    md: 'markdown',
    txt: 'text',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    sh: 'bash',
    ps1: 'powershell',
    html: 'html',
    go: 'go',
    rs: 'rust',
    java: 'java',
    sql: 'sql',
  }
  return Object.hasOwn(languages, extension) ? languages[extension]! : ''
}

export function pinLabel(pin: CodeReference) {
  if (pin.file) return pin.file.name
  const line = pin.code.trimStart().slice(0, 80).split(/\r?\n/, 1)[0]
  return line ? 'Snippet · ' + line.slice(0, 80) : 'Code snippet'
}

export function pinInfo(pin: CodeReference) {
  const file = pin.file
  return [
    file ? file.name : 'Unnamed code snippet',
    file &&
      {
        reference: 'Recorded file',
        copy: 'Saved file copy',
        reply: 'Filename supplied in the reply',
      }[file.kind],
    file?.path,
    pin.title && 'Conversation · ' + pin.title,
    pin.origin ? 'Source · ' + pin.origin : 'Pin · ' + pin.id,
    (pin.revision ?? 1) > 1 && 'Latest pinned revision · ' + pin.revision,
  ]
    .filter(Boolean)
    .join('\n')
}
