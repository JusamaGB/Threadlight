import { z } from 'zod'

const pinId = z.string().min(1).max(200)
export const MAX_PIN_VERSIONS = 50
const versionNumber = z.number().int().positive()
export const codeReference = z
  .object({
    id: pinId,
    code: z.string().max(5_000_000),
    language: z.string().max(200),
    title: z.string().max(4096).optional(),
    origin: z.string().max(8192).optional(),
    file: z
      .object({
        name: z.string().min(1).max(4096),
        path: z.string().max(4096).optional(),
        kind: z.enum(['copy', 'reference', 'reply']),
      })
      .strict()
      .optional(),
    collapsed: z.boolean().optional(),
    revision: versionNumber.default(1),
    history: z
      .array(z.object({ revision: versionNumber, code: z.string().max(5_000_000) }).strict())
      .max(MAX_PIN_VERSIONS - 1)
      .optional(),
    viewedRevision: versionNumber.optional(),
  })
  .strict()
  .refine((pin) => {
    const previous = pin.history ?? []
    return (
      previous.every(
        (v, i) => v.revision < pin.revision && (!i || v.revision > previous[i - 1]!.revision),
      ) &&
      (pin.viewedRevision === undefined ||
        pin.viewedRevision === pin.revision ||
        previous.some((v) => v.revision === pin.viewedRevision))
    )
  }, 'Invalid pinned version history.')
export type CodeReference = z.input<typeof codeReference>
export type CodeFile = NonNullable<CodeReference['file']>
export const pinState = z
  .object({
    version: z.literal(1),
    generation: z.number().int().nonnegative(),
    selectedId: pinId.nullable(),
    files: z.array(codeReference).max(512),
  })
  .strict()
export type PinState = z.infer<typeof pinState>
export const pinCommand = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('open'), legacy: z.string().max(6_000_000).nullable().optional() })
    .strict(),
  z.object({ action: z.literal('add'), file: codeReference }).strict(),
  z.object({ action: z.literal('remove'), id: pinId }).strict(),
  z.object({ action: z.literal('select'), id: pinId }).strict(),
  z.object({ action: z.literal('browse'), id: pinId, revision: versionNumber }).strict(),
  z.object({ action: z.literal('fold'), id: pinId, collapsed: z.boolean() }).strict(),
])
export type PinCommand = z.input<typeof pinCommand>
export const PIN_READ_SIZE = 8000
export function pinVersion(pin: CodeReference, revision = pin.viewedRevision ?? pin.revision ?? 1) {
  return revision === (pin.revision ?? 1)
    ? { revision, code: pin.code }
    : pin.history?.find((v) => v.revision === revision)
}
export function versionNumbers(pin: CodeReference) {
  return [...(pin.history ?? []).map((v) => v.revision), pin.revision ?? 1]
}
