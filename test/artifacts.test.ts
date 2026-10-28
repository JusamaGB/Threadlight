import { afterEach, beforeEach, expect, it } from 'vitest'
import { ArtifactStore, ARTIFACT_LIMIT } from '../src/main/artifacts'
import { sandbox, type Sandbox } from './helpers'

let box: Sandbox
beforeEach(async () => {
  box = await sandbox()
})
afterEach(async () => {
  await box.cleanup()
})

it('retains saved copies after reopening and isolates Claude and Codex threads', () => {
  const store = new ArtifactStore(box.root)
  const [item] = store.import('claude:one', 'storyboard.html', Buffer.from('<h1>Storyboard</h1>'))
  const reopened = new ArtifactStore(box.root)
  expect(reopened.list('claude:one')).toEqual([item])
  expect(reopened.list('codex:one')).toEqual([])
  expect(reopened.read('claude:one', item!.id)).toBe('<h1>Storyboard</h1>')
  expect(() => reopened.read('codex:one', item!.id)).toThrow('not found')
  expect(() => reopened.read('claude:one', '../../index.json')).toThrow('not found')
})

it('rejects oversized, invalid UTF-8 and unsupported files before saving', () => {
  const store = new ArtifactStore(box.root)
  expect(() => store.import('one', 'big.html', Buffer.alloc(ARTIFACT_LIMIT + 1))).toThrow('5 MiB')
  expect(() => store.import('one', 'bad.html', Buffer.from([0xff, 0xfe]))).toThrow()
  expect(() => store.import('one', 'run.exe', Buffer.from('MZ'))).toThrow()
  expect(store.list('one')).toEqual([])
})

it('renders text literally and identifies image bytes rather than trusting their filename', () => {
  const store = new ArtifactStore(box.root)
  const [text] = store.import('one', 'notes.md', Buffer.from('<script>bad()</script>'))
  expect(text!.kind).toBe('text')
  expect(store.read('one', text!.id)).toBe('<script>bad()</script>')
  const items = store.import(
    'one',
    'picture.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  expect(items[1]!.kind).toBe('image')
  expect(store.read('one', items[1]!.id)).toMatch(/^data:image\/png;base64,/)
})
