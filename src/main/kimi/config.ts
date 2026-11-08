import { z } from 'zod'
import { kimiSetupSchema, kimiSetupKey, MOONSHOT_ENDPOINT } from '../../shared/kimi'

const metadataSchema = z
  .object({
    model: z.string().min(1),
    maxContextSize: z.number().int().positive(),
    capabilities: z.array(
      z.enum([
        'tool_use',
        'thinking',
        'always_thinking',
        'image_in',
        'video_in',
        'audio_in',
        'dynamically_loaded_tools',
      ]),
    ),
    source: z.enum(['operator-declared', 'scripted-fixture']),
  })
  .strict()
const credentialSchema = z
  .object({
    endpoint: z.string(),
    variable: z.string().regex(/^THREADLIGHT_KIMI_[A-Z0-9_]+$/),
    material: z.string().min(1),
  })
  .strict()
export type KimiModelMetadata = z.infer<typeof metadataSchema>
export type KimiCredentialMaterial = z.infer<typeof credentialSchema>

/** Pure translation, never discovery or launch. Supplied secrets become env references only. */
export function translateKimiConfiguration(
  input: unknown,
  metadata?: KimiModelMetadata,
  credential?: KimiCredentialMaterial,
  outputLimit?: number,
) {
  if (
    outputLimit !== undefined &&
    (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 4096)
  )
    return {
      status: 'invalid-configuration' as const,
      requirements: ['Output limit must be between 1 and 4096 tokens'],
    }
  const parsed = kimiSetupSchema.safeParse(input)
  if (!parsed.success)
    return {
      status: 'invalid-configuration' as const,
      requirements: ['Valid saved Kimi configuration'],
    }
  const setup = parsed.data
  if (setup.agent.kind !== 'local')
    return {
      status: 'unsupported-runtime-location' as const,
      requirements: ['A local agent runtime; remote agent connection is not implemented'],
    }
  const endpoint =
    setup.connection.kind === 'moonshot' ? MOONSHOT_ENDPOINT : setup.connection.endpoint
  const requirements: string[] = []
  if (!endpoint) requirements.push('Model endpoint')
  if (!setup.connection.model.trim()) requirements.push('Exact server-facing model ID')
  if (!setup.agent.installationPath) requirements.push('Local Kimi Code package folder')
  const facts = metadataSchema.safeParse(metadata)
  if (!facts.success || facts.data.model !== setup.connection.model)
    requirements.push('Explicit context size and capability metadata for this exact model')
  // Fixture metadata must never silently become a default for an arbitrary real model.
  if (
    facts.success &&
    facts.data.source === 'scripted-fixture' &&
    (setup.connection.kind !== 'local' || setup.connection.model !== 'threadlight-scripted-model')
  )
    requirements.push('Fixture metadata is restricted to the declared local scripted model')
  const credentials = credentialSchema.safeParse(credential)
  if (setup.connection.authentication === 'none')
    requirements.push(
      'Unauthenticated provider readiness is not implemented; no synthetic credential substitution is permitted',
    )
  else if (
    !credentials.success ||
    credentials.data.endpoint !== endpoint ||
    !credentials.data.material.trim()
  )
    requirements.push('Explicit endpoint-bound child-process credential material')
  if (requirements.length || !facts.success || !credentials.success)
    return { status: 'incomplete-configuration' as const, requirements }
  const alias = 'threadlight-selected-model'
  const provider = 'threadlight-selected-provider'
  const q = JSON.stringify
  const toml = `default_model = ${q(alias)}
default_provider = ${q(provider)}
default_permission_mode = "manual"
telemetry = false
auto_session_title = false
merge_all_available_skills = false
builtin_product_skills = false
hooks = []
extra_skill_dirs = []
extra_agent_dirs = []

[providers.${q(provider)}]
type = ${q(setup.connection.protocol === 'openai-chat' ? 'openai' : 'kimi')}
base_url = ${q(endpoint)}
api_key_env = ${q(credentials.data.variable)}

[models.${q(alias)}]
provider = ${q(provider)}
model = ${q(setup.connection.model)}
max_context_size = ${facts.data.maxContextSize}
capabilities = ${q(facts.data.capabilities)}
${outputLimit === undefined ? '' : `max_output_size = ${outputLimit}\n`}

[thinking]
enabled = ${facts.data.capabilities.includes('always_thinking')}

[loop_control]
max_steps_per_turn = 4
max_attempts_per_step = 1
reserved_context_size = 1024

[task]
max_running_tasks = 1
keep_alive_on_exit = false
bash_auto_background_on_timeout = false
bash_task_timeout_s = 10

[tools]
enabled = ["Write"]

[[permission.rules]]
decision = "ask"
pattern = "Write"
`
  return {
    status: 'translated' as const,
    configurationKey: kimiSetupKey(setup),
    endpoint,
    model: setup.connection.model,
    alias,
    provider,
    credentialVariable: credentials.data.variable,
    metadataSource: facts.data.source,
    toml,
  }
}
