import { z } from 'zod'

// Configuration only: neither authentication material nor observed capabilities belong here.
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) => [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
      'Use a single line',
    )
const model = text(200)
export const MOONSHOT_ENDPOINT = 'https://api.moonshot.ai/v1'

const endpoint = text(2048).refine((value) => {
  if (!value) return true // An incomplete draft may be saved, never executed.
  try {
    const url = new URL(value)
    return (
      /^https?:\/\//.test(value) &&
      !/[\s\\]/.test(value) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !value.includes('?') &&
      !value.includes('#')
    )
  } catch {
    return false
  }
}, 'Use an HTTP(S) URL without credentials, query parameters or fragments')

export const localInstallationPath = text(1000).refine(
  (value) =>
    !value ||
    ((/^[A-Za-z]:[\\/]/.test(value) || /^\/(?!\/)/.test(value)) &&
      !/["'`$;&|<>]/.test(value) &&
      !/\s--?\w/.test(value) &&
      !value.startsWith('/dev/') &&
      !value.startsWith('/proc/')),
  'Use an absolute local package folder, without a command or arguments',
)

const compatible = {
  endpoint,
  model,
  protocol: z.literal('openai-chat'),
  authentication: z.enum(['none', 'external-api-key']),
}
export const kimiSetupSchema = z
  .object({
    connection: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('local'), ...compatible }).strict(),
      z.object({ kind: z.literal('server'), ...compatible }).strict(),
      z
        .object({
          kind: z.literal('moonshot'),
          model,
          protocol: z.literal('kimi'),
          authentication: z.literal('external-api-key'),
        })
        .strict(),
    ]),
    agent: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('local'), installationPath: localInstallationPath }).strict(),
      z
        .object({
          kind: z.literal('server'),
          host: text(253).refine(
            (value) => !value || /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(value),
            'Use a server hostname only, without credentials or a command',
          ),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.connection.kind === 'local' && value.connection.endpoint) {
      try {
        const host = new URL(value.connection.endpoint).hostname
        if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
          context.addIssue({
            code: 'custom',
            path: ['connection', 'endpoint'],
            message: 'Use a loopback address for Local model, or choose Server model',
          })
      } catch {
        /* The endpoint field already reports the invalid URL. */
      }
    }
  })

export type KimiSetup = z.infer<typeof kimiSetupSchema>
export const DEFAULT_KIMI_SETUP: KimiSetup = {
  connection: {
    kind: 'local',
    endpoint: '',
    model: '',
    protocol: 'openai-chat',
    authentication: 'none',
  },
  agent: { kind: 'local', installationPath: '' },
}

export function kimiSetupKey(setup: KimiSetup): string {
  return JSON.stringify(kimiSetupSchema.parse(setup))
}

export function kimiSetupIncomplete(setup: KimiSetup): boolean {
  return (
    !setup.connection.model.trim() ||
    (setup.connection.kind !== 'moonshot' && !setup.connection.endpoint) ||
    (setup.agent.kind === 'local' ? !setup.agent.installationPath : !setup.agent.host)
  )
}

export interface KimiRuntimeInspection {
  configurationKey: string
  checkedAt: string
  status: 'missing' | 'unverified' | 'verified' | 'unavailable'
  detail: string
  version?: string
  entrySha256?: string
}
