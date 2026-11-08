/** Conservative display labels, never executable command rewriting or a success claim. */
export function commandActivity(command: string, complete = false): string {
  // Ignore environment setup so a dependency path alone cannot claim that a test ran.
  const source = command.replace(/\$env:[\w]+\s*=\s*(?:'[^']*'|"[^"]*")\s*;?/gi, '')
  const normalized = source.replace(/\\/g, '/').replace(/\s+/g, ' ')
  const labels: [RegExp, string, string][] = [
    [
      /\bplaywright(?:\.cmd)?\s+test\b|\bnode(?:\.exe)?["']?\s+["']?[^;\s"']*test\/ui\/[^;\s"']+\.(?:mjs|cjs|js)\b/i,
      'Running UI checks',
      'Ran UI checks',
    ],
    [
      /\b(?:vitest|pytest|jest)\b|\bcargo\s+test\b|\bnpm\s+(?:run\s+)?test\b/i,
      'Running tests',
      'Ran tests',
    ],
    [/\b(?:tsc|typecheck)\b/i, 'Checking types', 'Checked types'],
    [/\b(?:eslint|prettier|lint)\b/i, 'Checking code style', 'Checked code style'],
    [
      /\b(?:npm\s+run\s+build|vite\s+build|cargo\s+build)\b/i,
      'Building the application',
      'Ran the build',
    ],
    [
      /\bgit\s+(?:status|diff|log)\b/i,
      'Reviewing repository changes',
      'Reviewed repository changes',
    ],
    [/\b(?:rg|grep|findstr)\b/i, 'Searching the project', 'Searched the project'],
    [/\b(?:Get-Content|cat|sed|head|tail)\b/i, 'Reading project files', 'Read project files'],
  ]
  const match = labels.find(([pattern]) => pattern.test(normalized))
  return match ? match[complete ? 2 : 1] : complete ? 'Ran a command' : 'Running a command'
}
