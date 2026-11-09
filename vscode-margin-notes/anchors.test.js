const { test } = require('node:test')
const assert = require('node:assert/strict')
const { moveLine, relocate } = require('./anchors')

function change(startLine, startCol, endLine, endCol, text) {
  return {
    range: {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    },
    text,
  }
}
test('pins follow original rows through insertions, replacements and deletions', () => {
  assert.equal(moveLine(76, [change(76, 0, 76, 0, '\r\n')]), 77)
  assert.equal(moveLine(76, [change(76, 5, 76, 5, '\n')]), 76)
  assert.equal(moveLine(76, [change(2, 0, 3, 0, ''), change(1, 0, 1, 0, '\n\n')]), 77)
  assert.equal(moveLine(76, [change(75, 0, 79, 0, '')]), 75)
})
test('reopening uses neighbouring code to distinguish repeated passages', () => {
  const lines = ['print("hi")', 'else:', 'before', 'print("hi")', 'after']
  const doc = { lineCount: lines.length, lineAt: (i) => ({ text: lines[i] }) }
  const n = { line: 2, context: ['before', 'print("hi")', 'after'] }
  relocate(n, doc)
  assert.equal(n.line, 3)
  const removed = { line: 90, context: ['deleted', 'missing', 'lines'] }
  relocate(removed, doc)
  assert.equal(removed.line, 4)
})
