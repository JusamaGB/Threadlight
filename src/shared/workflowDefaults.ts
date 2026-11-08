import type { ProcessDefinition, ProcessStep } from './workflowGraph'

export function newProcessStep(type: ProcessStep['type'], id: string, index = 0): ProcessStep {
  const base = {
    id,
    title: type[0]!.toUpperCase() + type.slice(1),
    x: 0,
    y: index * 76,
    inputs: {},
  }
  switch (type) {
    case 'context':
      return { ...base, type, items: [] }
    case 'script':
      return {
        ...base,
        type,
        executable: '',
        args: [],
        cwd: '',
        environment: {},
        timeoutMs: 60000,
        access: 'local-user',
      }
    case 'ai':
      return {
        ...base,
        type,
        roleId: '',
        folderId: '',
        brief: '',
        acceptance: '',
        items: [],
        milestone: 'submitted',
      }
    case 'save':
      return { ...base, type, folderId: '', body: 'Check evidence' }
    case 'condition':
      return { ...base, type, input: 'success', equals: true }
    case 'wait':
      return { ...base, type, durationMs: 1000 }
    case 'routine':
      return { ...base, type, definitionId: '', revision: 1, maxAttempts: 3 }
    case 'finish':
      return { ...base, type, success: true }
    case 'join':
      return { ...base, type }
    case 'review':
      return { ...base, type }
  }
}
export function newProcess(
  spaceId: string,
  template: 'custom' | 'parallel' | 'checks' = 'custom',
): ProcessDefinition {
  const nodes =
    template === 'parallel'
      ? [
          newProcessStep('wait', 'left', 0),
          newProcessStep('wait', 'right', 1),
          newProcessStep('join', 'join', 2),
          newProcessStep('finish', 'finish', 3),
        ]
      : [newProcessStep('context', 'context', 0), newProcessStep('finish', 'finish', 1)]
  if (template === 'parallel')
    nodes.forEach((node, index) => {
      node.x = index < 2 ? index * 110 : 55
      node.y = index < 2 ? 0 : (index - 1) * 76
    })
  if (template === 'checks') {
    nodes.splice(
      0,
      nodes.length,
      newProcessStep('script', 'check', 0),
      {
        ...newProcessStep('condition', 'branch', 1),
        type: 'condition',
        input: 'success',
        equals: true,
        inputs: { success: { node: 'check', field: 'success' } },
      },
      {
        ...newProcessStep('save', 'evidence', 2),
        type: 'save',
        folderId: '',
        body: 'Check evidence',
        inputs: {
          stdout: { node: 'check', field: 'stdout' },
          stderr: { node: 'check', field: 'stderr' },
        },
      },
      {
        ...newProcessStep('review', 'review', 3),
        inputs: {
          itemId: { node: 'evidence', field: 'itemId' },
          revision: { node: 'evidence', field: 'revision' },
        },
      },
      newProcessStep('finish', 'pass', 4),
      {
        ...newProcessStep('finish', 'fail', 5),
        type: 'finish',
        title: 'Failed checks',
        success: false,
      },
    )
  }
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    spaceId,
    revision: 1,
    name:
      template === 'parallel'
        ? 'Parallel paths'
        : template === 'checks'
          ? 'Checks and review'
          : 'New workflow',
    nodes,
    edges:
      template === 'checks'
        ? [
            { from: 'check', to: 'branch', route: 'always' },
            { from: 'branch', to: 'evidence', route: 'success' },
            { from: 'branch', to: 'fail', route: 'failure' },
            { from: 'evidence', to: 'review', route: 'always' },
            { from: 'review', to: 'pass', route: 'always' },
          ]
        : template === 'parallel'
          ? [
              { from: 'left', to: 'join', route: 'always' },
              { from: 'right', to: 'join', route: 'always' },
              { from: 'join', to: 'finish', route: 'always' },
            ]
          : [{ from: 'context', to: 'finish', route: 'always' }],
    trigger: { type: 'manual' },
    maxConcurrent: 2,
    maxOperations: 50,
  }
}
