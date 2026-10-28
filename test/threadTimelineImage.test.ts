import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTimelineImage } from '../src/main/threadTimelineImage'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
it('reads the actual raster bytes and rejects missing, non-image, remote and oversized sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'threadlight-image-'))
  directories.push(directory)
  const path = join(directory, 'first.png')
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='
  await writeFile(path, Buffer.from(png, 'base64'))
  expect(await readTimelineImage(path)).toEqual({
    ok: true,
    dataUrl: 'data:image/png;base64,' + png,
  })
  expect((await readTimelineImage(join(directory, 'missing.png'))).ok).toBe(false)
  expect((await readTimelineImage('https://example.com/image.png')).ok).toBe(false)
  expect((await readTimelineImage('relative.png')).ok).toBe(false)
  await writeFile(path, '<svg onload="alert(1)"/>')
  expect((await readTimelineImage(path)).ok).toBe(false)
  const file = await open(path, 'w')
  await file.truncate(6 * 1024 * 1024)
  await file.close()
  expect((await readTimelineImage(path)).ok).toBe(false)
})
