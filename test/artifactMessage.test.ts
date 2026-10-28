import { expect, it } from 'vitest'
import { artifactMessageParts } from '../src/renderer/lib/artifactMessage'
import type { ThreadArtifact } from '../src/shared/artifacts'

const artifact = (id: string, path: string): ThreadArtifact => ({
  id,
  path,
  title: path.replace(/\\/g, '/').split('/').at(-1)!,
  kind: 'html',
  mime: 'text/html',
  createdAt: 1,
  source: 'reference',
})
const marker = (path: string) => `\uE200visualize\uE202${JSON.stringify({ path })}\uE201`

it('replaces a native preview marker with this chat’s exact artifact name and ID', () => {
  const items = [
    artifact('one', 'C:\\previews\\Narrow diff.html'),
    artifact('two', 'C:/other/Narrow diff.html'),
  ]
  expect(
    artifactMessageParts(
      `Before\n${marker('c:/PREVIEWS/Narrow diff.html')}\nAfter`,
      items,
      'C:/work',
    ),
  ).toEqual([
    { type: 'text', text: 'Before\n' },
    { type: 'artifact', label: 'Narrow diff.html', id: 'one' },
    { type: 'text', text: '\nAfter' },
  ])
  expect(artifactMessageParts(marker('C:/unknown/Narrow diff.html'), items, 'C:/work')).toEqual([
    { type: 'artifact', label: 'Narrow diff.html', id: undefined },
  ])
})

it('shows a readable pending name until discovery supplies the matching artifact', () => {
  const text = marker('C:/previews/preview.html')
  expect(artifactMessageParts(text, [], '')).toEqual([
    { type: 'artifact', label: 'preview.html', id: undefined },
  ])
  expect(artifactMessageParts(text, [artifact('found', 'C:/previews/preview.html')], '')).toEqual([
    { type: 'artifact', label: 'preview.html', id: 'found' },
  ])
})

it('links local Markdown images/files in presentation order and leaves web links alone', () => {
  const items = [
    artifact('image', 'C:/work/image (one).png'),
    artifact('notes', 'C:/work/notes.md'),
  ]
  const text =
    '![Screenshot](<image (one).png>) then [Notes](file:///C:/work/notes.md:12) and [Web](https://example.com)'
  expect(artifactMessageParts(text, items, 'C:/work')).toEqual([
    { type: 'artifact', label: 'image (one).png', id: 'image' },
    { type: 'text', text: ' then ' },
    { type: 'artifact', label: 'notes.md', id: 'notes' },
    { type: 'text', text: ' and [Web](https://example.com)' },
  ])
})

it('matches encoded names, device-style workspaces and original percent characters without double decoding', () => {
  const items = [
    artifact('encoded', 'C:/work/100% preview.html'),
    artifact('literal', 'C:/work/part%20two.html'),
  ]
  expect(
    artifactMessageParts('[Preview](100%25%20preview.html)', items, '\\\\?\\C:\\work')[0],
  ).toMatchObject({ id: 'encoded' })
  expect(artifactMessageParts(marker('C:/work/part%2520two.html'), items, '')[0]).toMatchObject({
    id: 'literal',
  })
})

it('keeps code, malformed/remote markers and unrelated file references literal', () => {
  const preview = marker('C:/work/preview.html')
  for (const text of [
    `\`\`\`text\n${preview}\n\`\`\``,
    `\`${preview}\``,
    '\uE200visualize\uE202{bad json}\uE201',
    marker('https://example.com/preview.html'),
    marker('file://server/share/preview.html'),
    '[Unknown](C:/work/other.html)',
  ])
    expect(artifactMessageParts(text, [artifact('known', 'C:/work/preview.html')], '')).toEqual([
      { type: 'text', text },
    ])
})

it('keeps case-sensitive local paths distinct and renders hostile artifact titles as plain labels', () => {
  const item = artifact('exact', '/work/Preview.html')
  item.title = '<img src=x onerror=bad()>'
  expect(artifactMessageParts(marker('/work/Preview.html'), [item], '')[0]).toEqual({
    type: 'artifact',
    label: item.title,
    id: 'exact',
  })
  expect(artifactMessageParts(marker('/work/preview.html'), [item], '')[0]).toMatchObject({
    id: undefined,
  })
})
