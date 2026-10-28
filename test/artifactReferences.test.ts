import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join, toNamespacedPath } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ArtifactDiscovery,
  localArtifactPath,
  presentedPaths,
  referenceAllowed,
  type ArtifactSource,
} from '../src/main/artifactReferences'
import { ArtifactStore, artifactContent, readArtifactBytes } from '../src/main/artifacts'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox
let source: ArtifactSource
let original: string
beforeEach(async () => {
  box = await sandbox()
  const workspace = join(box.root, 'workspace')
  await mkdir(workspace)
  original = join(workspace, 'story board.html')
  await writeFile(original, '<h1>Original</h1>')
  source = {
    provider: 'claude',
    transcript: join(box.root, 'thread.jsonl'),
    transcriptRoots: [box.root],
    cwd: workspace,
    roots: [workspace],
  }
})
afterEach(async () => {
  await box.cleanup()
})
const claude = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})
const codex = (text: string) => ({
  type: 'response_item',
  payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
})
const line = (record: unknown) => JSON.stringify(record) + '\n'

describe.each(['claude', 'codex'] as const)('%s artifact references', (provider) => {
  it('discovers presented files, deduplicates paths, isolates IDs and leaves original bytes untouched', async () => {
    source.provider = provider
    const record = provider === 'claude' ? claude : codex
    await writeFile(
      source.transcript,
      line(record(`[Storyboard](<${original}>)`)) + line(record('[Again](<story board.html>)')),
    )
    const before = await readdir(box.root)
    const discovery = new ArtifactDiscovery()
    const result = await discovery.scan(`${provider}:one`, source)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      title: 'story board.html',
      source: 'reference',
      path: original,
    })
    expect(await readdir(box.root)).toEqual(before)
    expect(await readFile(original, 'utf8')).toBe('<h1>Original</h1>')
    const other = await discovery.scan(`${provider}:two`, source)
    expect(other.items[0]!.id).not.toBe(result.items[0]!.id)
    expect(await discovery.scan(`${provider}:one`, source)).toEqual(result)
  })
})

it('recognizes user envelopes and structured local images, ignoring tool results, code examples and reasoning', () => {
  expect(
    presentedPaths(
      {
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: `# Files mentioned by the user:\n\n## story board.html: ${original}\n\n## My request:\nReview this.`,
        },
      },
      'codex',
    ),
  ).toEqual([original])
  expect(
    presentedPaths(
      { type: 'user', message: { content: [{ type: 'image', source: { path: original } }] } },
      'claude',
    ),
  ).toEqual([original])
  expect(
    presentedPaths(
      {
        type: 'response_item',
        payload: { type: 'function_call_output', output: `[Link](${original})` },
      },
      'codex',
    ),
  ).toEqual([])
  expect(
    presentedPaths(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: `[Link](${original})` },
            { type: 'tool_use', input: { file_path: original } },
          ],
        },
      },
      'claude',
    ),
  ).toEqual([])
  expect(presentedPaths(claude('```md\n[file](story.html)\n```'), 'claude')).toEqual([])
  expect(
    presentedPaths(
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          channel: 'analysis',
          content: [{ type: 'output_text', text: `[Link](${original})` }],
        },
      },
      'codex',
    ),
  ).toEqual([])
})

it('continues incremental scans, completes split UTF-8 records and resets after replacement', async () => {
  const discovery = new ArtifactDiscovery()
  const record = line(claude(`[Résumé](<${original}>)`))
  const bytes = Buffer.from(record)
  const cut = bytes.indexOf(Buffer.from('é')) + 1
  await writeFile(source.transcript, bytes.subarray(0, cut))
  const partial = await discovery.scan('one', source)
  expect(partial.items).toHaveLength(0)
  expect(partial.notice).toContain('incomplete')
  await appendFile(source.transcript, bytes.subarray(cut))
  expect((await discovery.scan('one', source)).items).toHaveLength(1)
  await rename(source.transcript, source.transcript + '.old')
  await writeFile(source.transcript, line(claude('No artifact.')))
  expect((await discovery.scan('one', source)).items).toHaveLength(0)
})

it.skipIf(process.platform !== 'win32')(
  'discovers new Codex links under a Windows namespaced workspace while scanning live',
  async () => {
    source.provider = 'codex'
    source.cwd = toNamespacedPath(source.cwd)
    source.roots = [source.cwd]
    await writeFile(source.transcript, line(codex('Work in progress.')))
    const discovery = new ArtifactDiscovery()
    expect((await discovery.scan('codex:live', source)).items).toEqual([])
    await appendFile(source.transcript, line(codex(`[Storyboard](<${original}>)`)))
    const discovered = await discovery.scan('codex:live', source)
    expect(discovered.items).toHaveLength(1)
    expect(discovered.items[0]).toMatchObject({ path: original, source: 'reference' })
    expect(await referenceAllowed(original, source.roots)).toBe(true)
    expect(localArtifactPath('story board.html', source.cwd)).toBe(original)
    expect(await referenceAllowed(join(box.root, 'outside.html'), source.roots)).toBe(false)
    await appendFile(source.transcript, line(codex('[Again](<story board.html>)')))
    expect((await discovery.scan('codex:live', source)).items).toHaveLength(1)
  },
)

it('resets after truncation and refuses transcripts outside configured roots', async () => {
  const discovery = new ArtifactDiscovery()
  await writeFile(source.transcript, line(claude(`[View](<${original}>)`)))
  expect((await discovery.scan('one', source)).items).toHaveLength(1)
  await writeFile(source.transcript, '\n')
  expect((await discovery.scan('one', source)).items).toHaveLength(0)
  await expect(discovery.scan('two', { ...source, transcriptRoots: [source.cwd] })).rejects.toThrow(
    'outside',
  )
})

it('retains the newest 200 references and explains the limit', async () => {
  await writeFile(
    source.transcript,
    line(claude(Array.from({ length: 205 }, (_, i) => `[File ${i}](file-${i}.txt)`).join('\n'))),
  )
  const result = await new ArtifactDiscovery().scan('one', source)
  expect(result.items).toHaveLength(200)
  expect(result.items[0]!.title).toBe('file-204.txt')
  expect(result.notice).toContain('200 most recently')
})

it('bounds large records and continues to later artifacts with an explicit notice', async () => {
  await writeFile(
    source.transcript,
    line(claude('x'.repeat(3 * 1024 * 1024))) + line(claude('[View](<story board.html>)')),
  )
  const discovery = new ArtifactDiscovery()
  expect((await discovery.scan('one', source)).notice).toContain('Discovering')
  const result = await discovery.scan('one', source)
  expect(result.items).toHaveLength(1)
  expect(result.notice).toContain('too large')
})

it('does not restart an active transcript when more than 100 chats are refreshed', async () => {
  await writeFile(
    source.transcript,
    line(claude('[First](first.txt)')) +
      line({ type: 'tool_result', text: 'x'.repeat(2 * 1024 * 1024) }) +
      line(claude('[Last](last.txt)')),
  )
  let now = 0
  const discovery = new ArtifactDiscovery(() => now)
  const first = await discovery.scan('watched', source)
  expect(first.items.map((item) => item.title)).toEqual(['first.txt'])
  const complete = await discovery.scan('watched', source)
  expect(complete.items.map((item) => item.title)).toEqual(['last.txt', 'first.txt'])
  // The renderer needs more than a minute to warm its background catalog.
  for (let i = 0; i < 101; i++) {
    now += 900
    await discovery.scan(`other-${i}`, source)
  }
  expect(await discovery.scan('watched', source)).toEqual(complete)
  await rm(source.transcript)
  await expect(discovery.scan('watched', source)).rejects.toThrow()
  expect(discovery.lastKnown('watched')).toEqual(complete.items)
  // Once a real transcript replacement is readable, it can authoritatively clear the list.
  await writeFile(source.transcript, line(claude('No artifacts.')))
  expect((await discovery.scan('watched', source)).items).toEqual([])
  expect(discovery.lastKnown('watched')).toEqual([])
})

it('retires inactive transcript cursors after the warm-sweep grace period', async () => {
  await writeFile(source.transcript, line(claude('[First](first.txt)')))
  let now = 0
  const discovery = new ArtifactDiscovery(() => now)
  for (let i = 0; i < 100; i++) await discovery.scan(`old-${i}`, source)
  now = 300001
  await discovery.scan('new', source)
  expect(discovery.lastKnown('old-0')).toEqual([])
  expect(discovery.lastKnown('new')).toHaveLength(1)
})

it('refuses remote/device/ADS paths, traversal and symlink escapes', async () => {
  for (const candidate of [
    'https://example.com/a.png',
    '\\\\server\\a.png',
    '//server/a.png',
    '\\\\?\\C:\\a.png',
    'C:\\a.png:secret',
    'data:image/png;base64,AA',
  ])
    expect(localArtifactPath(candidate, source.cwd)).toBeNull()
  expect(await referenceAllowed(join(source.cwd, '..', 'private.txt'), source.roots)).toBe(false)
  const outside = join(box.root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'private.txt'), 'private')
  await symlink(
    outside,
    join(source.cwd, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  expect(await referenceAllowed(join(source.cwd, 'escape', 'private.txt'), source.roots)).toBe(
    false,
  )
  await rm(join(source.cwd, 'escape'))
})

it('links metadata only, reads updated originals, and explicitly preserves a copy', async () => {
  const directory = join(box.root, 'saved')
  const store = new ArtifactStore(directory)
  const linked = store.link('one', original)
  const subdir = (await readdir(directory))[0]!
  expect(await readdir(join(directory, subdir))).toEqual(['index.json'])
  expect(store.link('one', original)).toEqual(linked)
  await writeFile(original, '<h1>Updated</h1>')
  const bytes = await readArtifactBytes(original)
  expect(artifactContent(bytes, original).content).toBe('<h1>Updated</h1>')
  const saved = store.import('one', 'story board.html', bytes).at(-1)!
  await rm(original)
  await expect(readArtifactBytes(original)).rejects.toThrow()
  expect(store.read('one', saved.id)).toBe('<h1>Updated</h1>')
})
