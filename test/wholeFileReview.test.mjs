import assert from 'node:assert/strict'
import { test } from 'vitest'
import wholeFileReview from '../vscode-coach/wholeFileReview.cjs'
const { createWholeFileReview, FILE_LIMIT, PAGE_SIZE } = wholeFileReview

// The extension-host test exercises the actual editor. This fixture targets exact size boundaries.
function fixture(text) {
  const doc = {
    fileName: 'Untitled-1',
    uri: { scheme: 'untitled' },
    version: 3,
    isDirty: true,
    lineCount: text.split('\n').length,
    offsetAt() {
      return text.length
    },
    positionAt(offset) {
      return { line: text.slice(0, offset).split('\n').length - 1 }
    },
    getText() {
      return text
    },
  }
  class TabInputText {
    uri = doc.uri
  }
  const vscode = {
    Position: class {},
    TabInputText,
    window: {
      activeTextEditor: { document: doc },
      tabGroups: { activeTabGroup: { activeTab: { input: new TabInputText() } } },
    },
    languages: { getDiagnostics: () => [] },
  }
  return { review: createWholeFileReview(vscode), doc, vscode }
}

for (const text of [
  '',
  'a',
  'x'.repeat(PAGE_SIZE - 1) + '\r\nb',
  'x'.repeat(PAGE_SIZE - 1) + '🌱b',
  'x'.repeat(FILE_LIMIT),
  '\r\n'.repeat(FILE_LIMIT / 2),
]) {
  test(
    'exact reconstruction of ' + text.length + ' units ending in ' + JSON.stringify(text.slice(-2)),
    () => {
      const { review, doc } = fixture(text)
      let page = review.read(),
        received = ''
      const id = page.snapshot
      for (;;) {
        assert.equal(page.snapshot, id)
        assert.equal(page.startOffset, received.length)
        assert.ok(page.text.length <= PAGE_SIZE)
        received += page.text
        assert.equal(received.length, page.endOffset)
        if (page.status === 'complete') break
        assert.equal(page.status, 'partial')
        assert.ok(!/[\r\uD800-\uDBFF]$/.test(page.text))
        page = review.read(page.nextPage)
      }
      assert.equal(received, text)
      assert.equal(page.coveredLines, doc.lineCount)
      assert.equal(page.coveredUnits, text.length)
      assert.equal(page.nextPage, undefined)
      assert.equal(page.diagnostics.total, 0)
    },
  )
}
test('limit declines before reading any text', () => {
  const { review, doc } = fixture('x'.repeat(FILE_LIMIT + 1))
  doc.getText = () => assert.fail('oversized source read')
  assert.equal(review.read().status, 'limit')
})
test('stale, replayed and cancelled continuation tokens cannot finish a review', () => {
  const { review, doc, vscode } = fixture('x'.repeat(3 * PAGE_SIZE))
  const first = review.read(),
    second = review.read(first.nextPage)
  assert.throws(() => review.read(first.nextPage), /interrupted/)
  doc.version++
  assert.throws(() => review.read(second.nextPage), /interrupted/)
  const fresh = review.read()
  review.clear()
  assert.throws(() => review.read(fresh.nextPage), /interrupted/)
  vscode.window.activeTextEditor = undefined
  assert.throws(() => review.read(), /source text tab/)
  doc.uri.scheme = 'threadlight-coach-preview'
  vscode.window.activeTextEditor = { document: doc }
  assert.throws(() => review.read(), /source text tab/)
  doc.uri.scheme = 'file'
  vscode.window.tabGroups.activeTabGroup.activeTab.input = {}
  assert.throws(() => review.read(), /source text tab/)
})
