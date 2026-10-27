import { MemoryError } from './errors'

export function attachmentMime(data: Buffer, name: string): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  if (data.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  if (/\.(?:md|txt)$/i.test(name) && !data.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      throw new MemoryError('invalid_input', 'Text attachments must use UTF-8.')
    }
    return /\.md$/i.test(name) ? 'text/markdown' : 'text/plain'
  }
  throw new MemoryError(
    'invalid_input',
    'Choose a PNG, JPEG, WebP, PDF, Markdown or UTF-8 text file.',
  )
}
