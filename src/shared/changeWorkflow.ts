import { z } from 'zod'

const selection = z
  .object({
    path: z.string().min(1).max(4096),
    hunks: z.array(z.number().int().nonnegative()).max(500).optional(),
  })
  .strict()
export const changeWorkflowCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('roots') }).strict(),
  z.object({ action: z.literal('inspect') }).strict(),
  z
    .object({
      action: z.literal('prepare'),
      revision: z.string(),
      selection: z.array(selection).min(1).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal('validate'),
      planId: z.string().uuid(),
      scripts: z.array(z.string().regex(/^[a-zA-Z0-9:_-]+$/)).max(10),
    })
    .strict(),
  z
    .object({
      action: z.literal('save'),
      planId: z.string().uuid(),
      branch: z.string().min(1).max(150),
      message: z.string().trim().min(1).max(4000),
      acknowledgeNoTests: z.boolean(),
    })
    .strict(),
])
export type ChangeWorkflowCommand = z.infer<typeof changeWorkflowCommand>
export interface WorkflowFile {
  contentHash: string | null
  mode: string
  path: string
  patch: string
  hunks: string[]
  partial: boolean
  status: 'modified' | 'added' | 'deleted'
}
export interface WorkflowInspection {
  kind: 'inspection'
  root: string
  branch: string
  revision: string
  files: WorkflowFile[]
}
export interface WorkflowCheck {
  name: string
  ok: boolean
  output: string
}
export interface WorkflowPlan {
  kind: 'plan'
  id: string
  root: string
  base: string
  sourceBranch: string
  paths: string[]
  patch: string
  scripts: string[]
  checks: WorkflowCheck[]
  validated: boolean
  receipt?: { branch: string; commit: string }
}
export type ChangeWorkflowReply =
  | { kind: 'roots'; roots: { id: string; root: string }[] }
  | WorkflowInspection
  | WorkflowPlan
  | { kind: 'error'; reason: string }
