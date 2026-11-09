// Inspect only the opening statement. This works on an unsaved or incomplete
// Python buffer and does not require executing the program or an interpreter.
function firstPythonStatement(doc) {
  const nextContent = (line) => {
    while (line < doc.lineCount && /^\s*(?:#|$)/u.test(doc.lineAt(line).text)) line++
    return line
  }
  const first = nextContent(0)
  if (first === doc.lineCount) return undefined
  let depth = 0,
    quote = '',
    sawString = false
  for (let line = first; line < doc.lineCount; line++) {
    const text = doc.lineAt(line).text
    let continued = false
    for (let i = 0; i < text.length;) {
      if (quote) {
        if (text[i] === '\\') {
          if (i + 1 === text.length) continued = true
          i += 2
        } else if (text.startsWith(quote, i)) {
          i += quote.length
          quote = ''
        } else i++
        continue
      }
      const ch = text[i++]
      if (/\s/u.test(ch)) continue
      if (ch === '#') break
      if (ch === '(' && !sawString) {
        depth++
        continue
      }
      if (ch === ')' && depth > 0 && sawString) {
        depth--
        continue
      }
      if (ch === '\\' && i === text.length) {
        continued = true
        break
      }
      if (ch === ';' && !depth && sawString) {
        if (!/^\s*(?:#|$)/u.test(text.slice(i))) return line + 1
        break
      }
      const string = /^(?:r|u)?("""|'''|"|')/i.exec(text.slice(i - 1))
      if (!string) return first + 1
      sawString = true
      quote = string[1]
      i += string[0].length - 1
    }
    if (quote.length === 1 && !continued) return first + 1
    if (quote || depth || continued) continue
    if (!sawString) return first + 1
    const next = nextContent(line + 1)
    return next === doc.lineCount ? undefined : next + 1
  }
  // An unfinished string or parenthesis is itself something to explain.
  return first + 1
}

module.exports = { firstPythonStatement }
