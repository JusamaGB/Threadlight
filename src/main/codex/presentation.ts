import { isObject, str } from '../sessions/json'
import { commandActivity } from '../../shared/commandActivity'

/** Smart Thread renders the provider's Markdown. The voice-mode marker is desktop UI metadata. */
export const codexReplyMarkdown = (text: string): string =>
  text.replace(/^::codex-realtime-inline\{\}\r?\n/, '')

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

/** Only the short public display heading, never the summary body or raw content. */
export function publicActivityHeading(raw: Record<string, unknown>): string | undefined {
  if (!Array.isArray(raw.summary)) return undefined
  for (const part of raw.summary.toReversed()) {
    if (typeof part !== 'string') continue
    const heading = part.match(/^\s*\*\*([^\r\n]{1,160}?)\*\*/)?.[1]?.trim()
    if (heading) return heading
  }
  return undefined
}

/** A fallback for periods without an agent progress update; never expose launcher commands. */
export function codexToolActivity(name: string, input: Record<string, unknown> = {}): string {
  const description = str(input['description'])
  if (description?.trim()) return codexDisplayText(description).slice(0, 300)
  const tool = name.split(/[.:]/).at(-1) || name
  const command = str(input['command']) || str(input['cmd']) || ''
  if (/exec_command|shell|Bash|commandExecution/.test(tool)) return commandActivity(command)
  if (/apply_patch|edit_file|write_file/.test(tool)) return 'Updating project files'
  if (/request_user_input/.test(tool)) return 'Waiting for your answer'
  if (/update_plan/.test(tool)) return 'Updating the plan'
  if (/view_image/.test(tool)) return 'Inspecting an image'
  if (/write_stdin/.test(tool)) return 'Checking command progress'
  if (/web|search/.test(tool)) return 'Looking up information'
  return 'Using a tool'
}
