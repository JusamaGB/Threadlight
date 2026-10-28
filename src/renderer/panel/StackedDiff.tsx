import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { DiffLine } from '../../shared/types'
import { compactDiffText, stackedDiffHunks, type DiffHunk } from '../lib/stackedDiff'
import { en } from '../i18n/en'
import styles from './StackedDiff.module.css'

function lineRange(hunk: DiffHunk) {
  const added = hunk.groups.filter((group) => group.type === 'add').flatMap((g) => g.lines)
  const removed = hunk.groups.filter((group) => group.type === 'remove').flatMap((g) => g.lines)
  const lines = added.length
    ? added
    : removed.length
      ? removed
      : hunk.groups.flatMap((g) => g.lines)
  const numbers = lines
    .map((line) => (line.type === 'remove' ? line.oldLine : (line.newLine ?? line.oldLine)))
    .filter((number): number is number => number !== undefined)
  return numbers.length
    ? en.changes.lineRange(Math.min(...numbers), Math.max(...numbers))
    : en.changes.recordedEdit
}

export function StackedDiff({ lines, footer }: { lines: DiffLine[]; footer?: ReactNode }) {
  const hunks = useMemo(() => stackedDiffHunks(lines), [lines])
  const [wrap, setWrap] = useState(true)
  return (
    <div className={styles.root} data-stacked-diff="" data-wrap={wrap}>
      {hunks.map((hunk, hunkIndex) => (
        <section
          key={hunkIndex}
          className={styles.hunk}
          style={
            {
              '--diff-number-width': `${hunk.groups.reduce(
                (width, group) =>
                  group.lines.reduce(
                    (digits, line) =>
                      Math.max(
                        digits,
                        String(line.oldLine ?? '').length,
                        String(line.newLine ?? '').length,
                      ),
                    width,
                  ),
                3,
              )}ch`,
            } as CSSProperties
          }
        >
          <div className={styles.toolbar}>
            <span title={hunk.heading || undefined}>{lineRange(hunk)}</span>
            {hunkIndex === 0 && (
              <button
                type="button"
                aria-pressed={wrap}
                title={en.changes.wrapHint}
                onClick={() => setWrap(!wrap)}
              >
                {wrap ? en.changes.wrapOn : en.changes.wrapOff}
              </button>
            )}
          </div>
          {hunk.groups.map((group, groupIndex) => {
            const rows = (
              <div className={styles.codeLines}>
                {group.lines.map((line, index) => (
                  <div key={index} className={styles.line}>
                    <span
                      className={styles.number}
                      data-diff-number=""
                      title={
                        line.type === 'remove'
                          ? `Original line ${line.oldLine ?? ''}`
                          : `Updated line ${line.newLine ?? line.oldLine ?? ''}`
                      }
                    >
                      {line.type === 'remove' ? line.oldLine : (line.newLine ?? line.oldLine)}
                    </span>
                    <span className={styles.text} data-diff-text="">
                      {wrap ? compactDiffText(line.text, hunk.indent) : line.text}
                    </span>
                  </div>
                ))}
              </div>
            )
            if (group.type === 'context')
              return (
                <details key={groupIndex} className={styles.context}>
                  <summary>{en.changes.unchangedLines(group.lines.length)}</summary>
                  {rows}
                </details>
              )
            const label = group.type === 'remove' ? en.changes.removedLabel : en.changes.addedLabel
            return (
              <section
                key={groupIndex}
                className={styles.group}
                data-type={group.type}
                aria-label={`${label} · ${en.changes.lines(group.lines.length)}`}
              >
                <div className={styles.groupHead}>
                  <span>{label}</span>
                  <span>{en.changes.lines(group.lines.length)}</span>
                </div>
                {rows}
              </section>
            )
          })}
        </section>
      ))}
      {footer}
    </div>
  )
}
