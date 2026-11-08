export const SOURCE_EXTENSIONS = ['py', 'js', 'jsx', 'ts', 'tsx']
export const SOURCE_LIMIT = 32 * 1024

export function isSourceFile(filename?: string): boolean {
  return (
    !!filename &&
    SOURCE_EXTENSIONS.includes(filename.split('.').pop()?.toLowerCase() ?? '') &&
    filename.includes('.')
  )
}

export function sourceLines(body: string): string[] {
  if (!body) return []
  const lines = body.split(/\r\n|\r|\n/)
  if (!lines.at(-1)) lines.pop()
  return lines
}
