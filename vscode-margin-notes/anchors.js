'use strict'

// Lines are zero-based. Map the start of the original row through each edit,
// including an insertion at column zero that shifts the original text down.
function moveLine(line, changes) {
  for (const change of changes) {
    const { start, end } = change.range
    const added = (change.text.match(/\r\n|\n|\r/g) || []).length
    if (line > end.line || (line === end.line && end.character === 0)) {
      line += added - (end.line - start.line)
    } else if (line > start.line) {
      line = start.line
    }
  }
  return line
}

function remember(note, doc) {
  note.line = Math.max(0, Math.min(note.line, doc.lineCount - 1))
  const at = (n) => (n >= 0 && n < doc.lineCount ? doc.lineAt(n).text : null)
  note.context = [at(note.line - 1), at(note.line), at(note.line + 1)]
}

// Files can also change while VS Code is closed. Prefer a matching passage,
// using the neighbouring lines to distinguish repeated or empty lines.
function relocate(note, doc) {
  if (note.context) {
    const [before, text, after] = note.context
    let best = note.line,
      score = -Infinity
    if (note.line >= doc.lineCount || doc.lineAt(note.line).text !== text) {
      for (let i = 0; i < doc.lineCount; i++) {
        if (doc.lineAt(i).text !== text) continue
        const neighbours =
          Number(i > 0 && doc.lineAt(i - 1).text === before) +
          Number(i + 1 < doc.lineCount && doc.lineAt(i + 1).text === after)
        const rank = neighbours + 1 / (2 + Math.abs(i - note.line))
        if (rank > score) {
          best = i
          score = rank
        }
      }
      note.line = best
    }
  }
  remember(note, doc)
}
module.exports = { moveLine, remember, relocate }
