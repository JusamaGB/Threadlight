import { isObject, str } from '../sessions/json'

/** Display text only: never load attachment URLs or interpret HTML from a transcript. */
export function codexDisplayText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\((?:<[^>]*>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g, '')
    .replace(/\[([^\]]+)\]\((?:<[^>]*>|[^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g, '$1')
    .replace(/^[ \t]*```[^\n]*$/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/<\/?proposed_plan>/g, '')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim()
}

/** Desktop attachment envelopes put the real request after their generated file inventory. */
export function codexUserRequest(text: string): string | null {
  let request = text.trim()
  if (/^<external_codex_apps_open_page>/.test(request) || /^<environment_context>/.test(request))
    return null
  const reply = request.match(
    /^<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>$/,
  )
  if (reply) {
    try {
      const values: unknown = JSON.parse(reply[1]!)
      if (!Array.isArray(values)) return null
      return (
        values
          .filter(isObject)
          .map((item) => str(item['answer']) || '')
          .filter(Boolean)
          .join('; ') || null
      )
    } catch {
      return null
    }
  }
  if (/^# Files mentioned by the user:/i.test(request)) {
    const marker = /^## My request:\s*$/m.exec(request)
    if (!marker) return 'Shared an attachment'
    request = request.slice(marker.index + marker[0].length).trim()
    request = request.replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, '').trim()
  }
  return codexDisplayText(request) || null
}

/** A fallback for periods without an agent progress update; never expose launcher commands. */
export function codexToolActivity(name: string, input: Record<string, unknown> = {}): string {
  const description = str(input['description'])
  if (description?.trim()) return codexDisplayText(description).slice(0, 300)
  const tool = name.split(/[.:]/).at(-1) || name
  const command = str(input['command']) || str(input['cmd']) || ''
  if (/exec_command|shell|Bash|commandExecution/.test(tool)) {
    if (/\b(?:vitest|pytest|jest|cargo test|npm (?:run )?test)\b/i.test(command))
      return 'Running tests'
    if (/\b(?:tsc|typecheck)\b/i.test(command)) return 'Checking types'
    if (/\b(?:eslint|prettier|lint)\b/i.test(command)) return 'Checking code style'
    if (/\b(?:npm run build|vite build|cargo build)\b/i.test(command))
      return 'Building the application'
    if (/\bgit\s+(?:status|diff|log)\b/i.test(command)) return 'Reviewing repository changes'
    if (/\b(?:rg|grep|findstr)\b/i.test(command)) return 'Searching the project'
    if (/\b(?:Get-Content|cat|sed|head|tail)\b/i.test(command)) return 'Reading project files'
    return 'Running a command'
  }
  if (/apply_patch|edit_file|write_file/.test(tool)) return 'Updating project files'
  if (/request_user_input/.test(tool)) return 'Waiting for your answer'
  if (/update_plan/.test(tool)) return 'Updating the plan'
  if (/view_image/.test(tool)) return 'Inspecting an image'
  if (/write_stdin/.test(tool)) return 'Checking command progress'
  if (/web|search/.test(tool)) return 'Looking up information'
  return 'Using a tool'
}
