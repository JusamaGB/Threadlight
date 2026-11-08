const { randomUUID } = require('node:crypto')
const { basename } = require('node:path')

// Offsets use VS Code's UTF-16 units. Keep each tool response small enough to read in one turn.
const FILE_LIMIT = 32768
const PAGE_SIZE = 2048

function createWholeFileReview(vscode) {
  let pending, completed
  function read(nextPage) {
    const editor = vscode.window.activeTextEditor
    const doc = editor?.document
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    const activeSource =
      doc &&
      tab?.input instanceof vscode.TabInputText &&
      tab.input.uri.toString() === doc.uri.toString()
    let review
    if (nextPage !== undefined) {
      review = pending
      if (
        !review ||
        nextPage !== review.nextPage ||
        !activeSource ||
        editor !== review.editor ||
        doc !== review.document ||
        doc.version !== review.version
      ) {
        throw Error(
          'Whole-file review interrupted. Discard earlier pages and start a fresh review.',
        )
      }
    } else {
      pending = completed = undefined
      if (!activeSource || !['file', 'untitled', 'vscode-remote'].includes(doc.uri.scheme))
        throw Error('Open a source text tab in the connected editor to review the whole file.')
      // offsetAt clamps to EOF without materialising an arbitrarily long last line.
      const totalUnits = doc.offsetAt(new vscode.Position(doc.lineCount, 0))
      const metadata = {
        file: basename(doc.fileName),
        language: doc.languageId,
        version: doc.version,
        totalLines: doc.lineCount,
        totalUnits,
        dirty: doc.isDirty,
        unit: 'UTF-16',
      }
      if (totalUnits > FILE_LIMIT)
        return { ...metadata, status: 'limit', limit: FILE_LIMIT, coveredUnits: 0, coveredLines: 0 }
      review = {
        editor,
        document: doc,
        version: doc.version,
        metadata,
        id: randomUUID(),
        offset: 0,
        text: doc.getText(),
      }
      if (review.text.length !== totalUnits) throw Error('Could not verify the active buffer size.')
    }
    const start = review.offset
    const { text } = review
    let end = Math.min(start + PAGE_SIZE, text.length)
    if (
      end < text.length &&
      ((text[end - 1] === '\r' && text[end] === '\n') ||
        (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])))
    )
      end--
    const complete = end === text.length
    review.offset = end
    review.nextPage = complete ? undefined : randomUUID()
    pending = complete ? undefined : review
    const position = doc.positionAt(end)
    const page = {
      ...review.metadata,
      snapshot: review.id,
      status: complete ? 'complete' : 'partial',
      startOffset: start,
      endOffset: end,
      startLine: doc.positionAt(start).line + 1,
      coveredUnits: end,
      coveredLines: complete ? doc.lineCount : position.line,
      text: text.slice(start, end),
      nextPage: review.nextPage,
    }
    if (complete) {
      completed = review
      const reported = vscode.languages.getDiagnostics(doc.uri)
      page.diagnostics = {
        total: reported.length,
        items: reported.slice(0, 8).map((d) => ({
          line: d.range.start.line + 1,
          severity: vscode.DiagnosticSeverity[d.severity],
          message: d.message.slice(0, 200),
          messageTruncated: d.message.length > 200,
        })),
      }
    }
    return page
  }
  return {
    read,
    resolve(id) {
      const r = completed
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      if (
        !r ||
        r.id !== id ||
        !(tab instanceof vscode.TabInputText) ||
        tab.uri.toString() !== r.document.uri.toString() ||
        r.editor !== vscode.window.activeTextEditor ||
        r.document.version !== r.version ||
        r.document.isClosed
      )
        throw Error('Review the active buffer again before proposing changes.')
      return r
    },
    clear() {
      pending = completed = undefined
    },
  }
}

module.exports = { createWholeFileReview, FILE_LIMIT, PAGE_SIZE }
