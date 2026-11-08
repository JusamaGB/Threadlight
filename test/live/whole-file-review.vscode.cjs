// Run inside the isolated extension host over the production EditorCoach connection.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')
const { FILE_LIMIT, PAGE_SIZE } = require('../../vscode-coach/wholeFileReview.cjs')

async function checkWholeFileReview(root, coach, session) {
  const file = path.join(root, 'review.py')
  const saved = '# saved contents\r\n'
  fs.writeFileSync(file, saved)
  const doc = await vscode.workspace.openTextDocument(file)
  let editor = await vscode.window.showTextDocument(doc)
  // Exercise boundaries inside a long line, across an astral character and at CRLF.
  const source =
    '#' +
    'x'.repeat(PAGE_SIZE - 2) +
    '🌱\r\n' +
    Array.from({ length: 96 }, (_, i) => '# review fixture ' + i).join('\r\n') +
    '\r\nprint(missing_lantern)\r\n'
  await editor.edit((edit) =>
    edit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(saved.length)), source),
  )
  const read = (nextPage) =>
    coach.run(session, nextPage ? { action: 'review', nextPage } : { action: 'review' })
  const diagnostics = vscode.languages.createDiagnosticCollection('review-test')
  try {
    diagnostics.set(doc.uri, [
      new vscode.Diagnostic(
        doc.lineAt(97).range,
        'Reported by test diagnostic',
        vscode.DiagnosticSeverity.Warning,
      ),
    ])
    const first = await read()
    assert.equal(first.status, 'partial')
    assert.equal(first.dirty, true)
    assert.equal(first.endOffset, PAGE_SIZE - 1)
    let page = first,
      received = page.text
    while (page.status === 'partial') {
      const previous = page
      page = await read(previous.nextPage)
      assert.equal(previous.endOffset, page.startOffset)
      assert.equal(page.snapshot, first.snapshot)
      assert.equal(page.version, first.version)
      received += page.text
    }
    assert.equal(page.status, 'complete')
    assert.equal(received, source)
    assert.equal(page.coveredLines, doc.lineCount)
    assert.equal(page.coveredUnits, source.length)
    assert.equal(doc.getText(), received)
    assert.equal(doc.isDirty, true)
    assert.equal(fs.readFileSync(file, 'utf8'), saved)
    assert.ok(
      page.diagnostics.items.some((item) => item.line === 98 && item.severity === 'Warning'),
    )
    const beforeSwitch = await read()
    const blank = await vscode.workspace.openTextDocument({ content: '' })
    await vscode.window.showTextDocument(blank)
    await vscode.window.showTextDocument(doc)
    await assert.rejects(read(beforeSwitch.nextPage), /interrupted/)
    editor = vscode.window.activeTextEditor
    const beforeEdit = await read()
    await editor.edit((edit) => edit.insert(doc.positionAt(0), '#'))
    await assert.rejects(read(beforeEdit.nextPage), /interrupted/)
    const beforeClose = await read()
    coach.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    await assert.rejects(read(beforeClose.nextPage), /interrupted/)
    editor = await vscode.window.showTextDocument(blank)
    const empty = await read()
    assert.equal(empty.status, 'complete')
    assert.equal(empty.text, '')
    assert.equal(empty.coveredLines, 1)
    await editor.edit((edit) => edit.insert(blank.positionAt(0), 'x'.repeat(FILE_LIMIT + 1)))
    const oversized = await read()
    assert.equal(oversized.status, 'limit')
    assert.equal(oversized.totalUnits, FILE_LIMIT + 1)
    assert.equal(oversized.coveredUnits, 0)
    assert.equal(oversized.text, undefined)
    console.log(
      'PASS whole-file review across pages, exact dirty CRLF/Unicode text, late error, diagnostics, stale switch/edit/disconnect, empty and oversized buffers.',
    )
  } finally {
    diagnostics.dispose()
  }
  return doc
}
module.exports = { checkWholeFileReview }
