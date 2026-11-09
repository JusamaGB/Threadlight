// Build each excerpt from complete buffer lines so partial and same-line edits keep their context.
function matchingEdges(before, after) {
  const limit = Math.min(before.length, after.length)
  let head = 0,
    tail = 0
  while (head < limit && before[head] === after[head]) head++
  while (tail < limit - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail++
  return { head, tail }
}

function reviewRows(doc, edits) {
  const text = doc.getText()
  const groups = []
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    const start = doc.positionAt(edit.start).line,
      end = doc.positionAt(edit.end).line
    const previous = groups.at(-1)
    if (previous && start <= previous.end) {
      previous.end = end
      previous.edits.push(edit)
    } else groups.push({ start, end, edits: [edit] })
  }
  const rows = []
  let shift = 0,
    lastLine = -1
  function context(line) {
    if (line < 0 || line <= lastLine || line >= doc.lineCount) return
    if (lastLine >= 0 && line > lastLine + 1) rows.push({ kind: 'gap', text: '…' })
    rows.push({ kind: 'context', line: line + 1 + shift, text: doc.lineAt(line).text })
    lastLine = line
  }
  for (const [index, group] of groups.entries()) {
    if (!index) context(group.start - 2)
    context(group.start - 1)
    const offset = doc.offsetAt(doc.lineAt(group.start).range.start)
    const original = text.slice(offset, doc.offsetAt(doc.lineAt(group.end).range.end))
    let result = original
    for (const edit of group.edits.slice().reverse())
      result =
        result.slice(0, edit.start - offset) + edit.replacement + result.slice(edit.end - offset)
    const before = original.split(/\r?\n/),
      after = result.split(/\r?\n/)
    const { head, tail } = matchingEdges(before, after)
    for (let i = 0; i < head; i++) context(group.start + i)
    const removed = before.slice(head, before.length - tail)
    const added = after.slice(head, after.length - tail)
    const startLine = group.start + head + 1
    // Zip replacements inside this edit so each old line immediately precedes its new line.
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      if (removed[i] === added[i]) {
        rows.push({ kind: 'context', line: startLine + shift + i, text: added[i] })
        continue
      }
      for (const [kind, lines, other, first] of [
        ['remove', removed, added, startLine],
        ['add', added, removed, startLine + shift],
      ]) {
        if (i >= lines.length) continue
        const row = { kind, line: first + i, text: lines[i], sourceLine: startLine + i }
        if (kind === 'add') row.afterLine = startLine - 1 + Math.min(i + 1, removed.length)
        if (i < other.length) {
          const chars = Array.from(row.text)
          const { head, tail } = matchingEdges(chars, Array.from(other[i]))
          row.parts = [
            chars.slice(0, head),
            chars.slice(head, chars.length - tail),
            chars.slice(chars.length - tail),
          ].map((part) => part.join(''))
        }
        rows.push(row)
      }
    }
    shift += after.length - before.length
    lastLine = group.end - tail
    for (let i = before.length - tail; i < before.length; i++) context(group.start + i)
    lastLine = group.end
    // The next group may start immediately after this one.
    const next = groups[index + 1]
    if (!next || next.start > group.end + 1) context(group.end + 1)
  }
  return rows
}

function sourceChanges(rows) {
  const originals = new Map(),
    insertions = new Map()
  for (const row of rows) {
    if (row.kind === 'remove') originals.set(row.sourceLine, row)
    if (row.kind === 'add') {
      if (!insertions.has(row.afterLine)) insertions.set(row.afterLine, [])
      insertions.get(row.afterLine).push(row)
    }
  }
  return { originals, insertions }
}

const resultCommand = 'threadlight.coach.toggleProposalResult'
const whyCommand = 'threadlight.coach.toggleProposalExplanation'
module.exports = { reviewRows, sourceChanges, resultCommand, whyCommand }
