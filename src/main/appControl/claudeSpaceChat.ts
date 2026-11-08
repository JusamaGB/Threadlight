import { execFile } from 'node:child_process'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { CliCommand } from '../relay'
import type { ClaudePaths } from '../sessions/paths'

/** The new session is usable only after Claude has persisted its opening turn in this root. */
export async function startClaudeSpaceChat(
  cli: CliCommand,
  paths: ClaudePaths,
  cwd: string,
  id: string,
  message: string,
) {
  z.string().uuid().parse(id)
  await new Promise<void>((done, reject) => {
    const command = execFile(
      cli.command,
      [
        ...cli.prefixArgs,
        '--print',
        '--output-format',
        'json',
        '--session-id',
        id,
        '--tools',
        '',
        '--strict-mcp-config',
        '--disable-slash-commands',
      ],
      { cwd, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error?.killed)
          return reject(
            new Error(
              'Claude timed out. Check its saved history and network connection before retrying.',
            ),
          )
        if (error)
          return reject(
            new Error('Claude did not confirm the opening turn. Check Claude before retrying.'),
          )
        try {
          z.object({
            type: z.literal('result'),
            subtype: z.literal('success'),
            is_error: z.literal(false),
            session_id: z.literal(id),
          }).parse(JSON.parse(stdout))
          done()
        } catch {
          reject(new Error('Claude returned no successful result for this session.'))
        }
      },
    )
    command.stdin?.on('error', () =>
      reject(new Error('Claude could not receive the opening message.')),
    )
    command.stdin?.end(message)
  })
  for (const project of await readdir(paths.projectsDir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const file = join(paths.projectsDir, project.name, id + '.jsonl')
    const info = await lstat(file).catch(() => null)
    if (!info?.isFile() || info.size > 4 * 1024 * 1024) continue
    const records = (await readFile(file, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (row) =>
          row.sessionId === id &&
          typeof row.cwd === 'string' &&
          resolve(row.cwd).toLowerCase() === resolve(cwd).toLowerCase(),
      )
    const opening = records.findIndex(
      (row) =>
        row.type === 'user' &&
        (row.message?.content === message ||
          (Array.isArray(row.message?.content) &&
            row.message.content.some(
              (part: { type?: string; text?: string }) =>
                part?.type === 'text' && part.text === message,
            ))),
    )
    const model =
      opening < 0
        ? undefined
        : records
            .slice(opening + 1)
            .find((row) => row.type === 'assistant' && typeof row.message?.model === 'string')
            ?.message.model
    if (typeof model === 'string' && model.trim() && model.length <= 100)
      return { target: id, model }
  }
  throw new Error('Claude has not confirmed the saved chat and model in the selected space.')
}
