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
    for (const [kind, lines, other, first] of [
      ['remove', removed, added, startLine],
      ['add', added, removed, startLine + shift],
    ]) {
      lines.forEach((value, i) => {
        const row = { kind, line: first + i, text: value }
        if (lines.length === other.length) {
          const chars = Array.from(value)
          const { head, tail } = matchingEdges(chars, Array.from(other[i]))
          row.parts = [
            chars.slice(0, head),
            chars.slice(head, chars.length - tail),
            chars.slice(chars.length - tail),
          ].map((part) => part.join(''))
        }
        rows.push(row)
      })
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

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// VS Code permits span background colours in Markdown comments. Taper the tint
// over four spaces after the code; the rest of the native comment stays clear.
const colors = {
  add: { rgb: '439c69', strong: 'var(--vscode-diffEditor-insertedTextBackground)' },
  remove: { rgb: 'd35c69', strong: 'var(--vscode-diffEditor-removedTextBackground)' },
}
const tint = (color, text) => '<span style="background-color:' + color + ';">' + text + '</span>'

function formatRow(row, width, result, plain = false) {
  if (row.kind === 'gap') return ' '.repeat(width) + '  …'
  const number = String(row.line).padStart(width)
  if (result || row.kind === 'context')
    return number + '   ' + (plain ? row.text : escapeHtml(row.text))
  const marker = row.kind === 'add' ? '+' : '−'
  if (plain) return number + ' ' + marker + ' ' + row.text
  const { rgb, strong } = colors[row.kind]
  let body = escapeHtml(row.text)
  if (row.parts) {
    const [prefix, change, suffix] = row.parts
    const changed = /^ +$/.test(change) ? '·'.repeat(change.length) : escapeHtml(change)
    body = escapeHtml(prefix) + tint(strong, changed) + escapeHtml(suffix)
  }
  return (
    tint('#' + rgb + '29', number + ' ' + marker + ' ' + body) +
    ['20', '17', '0e', '06'].map((alpha) => tint('#' + rgb + alpha, ' ')).join('')
  )
}

const resultCommand = 'threadlight.coach.toggleProposalResult'
const whyCommand = 'threadlight.coach.toggleProposalExplanation'

function reviewBodies(vscode, q, explanation) {
  const rows = q.rows.filter((row) => !q.result || row.kind !== 'remove')
  const width = String(Math.max(...q.rows.map((row) => row.line || 0))).length
  const html = rows.map((row) => formatRow(row, width, q.result)).join('\n')
  const bodies = []
  const md = new vscode.MarkdownString()
  md.supportHtml = true
  md.isTrusted = { enabledCommands: [resultCommand, whyCommand] }
  if (html.length < 96000) md.appendMarkdown('<pre><code>' + html + '</code></pre>\n\n')
  else {
    // VS Code truncates individual Markdown bodies at 100,000 characters.
    // Keep unusually large previews readable using literal, untrusted code blocks.
    let chunk = ''
    for (const row of rows) {
      const line = '    ' + formatRow(row, width, q.result, true) + '\n'
      if (chunk && chunk.length + line.length > 96000) {
        bodies.push(new vscode.MarkdownString(chunk))
        chunk = ''
      }
      chunk += line
    }
    if (chunk) bodies.push(new vscode.MarkdownString(chunk))
  }
  const link = (label, cmd) =>
    '[' + label + '](command:' + cmd + '?' + encodeURIComponent(JSON.stringify([q.token])) + ')'
  md.appendMarkdown(
    link(q.result ? 'Hide result' : 'Result', resultCommand) +
      '　' +
      link('Why this edit?', whyCommand),
  )
  if (q.why)
    md.appendMarkdown('\n\n<p>' + escapeHtml(explanation).replace(/\r\n?|\n/g, '<br>') + '</p>')
  return [...bodies, md]
}

module.exports = { reviewRows, reviewBodies, resultCommand, whyCommand }
