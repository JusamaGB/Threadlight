import type { AgentRequest, AgentResponse } from '../../shared/agent'
import { isObject, str, type JsonObject } from '../sessions/json'

export interface PendingCodexRequest {
  view: AgentRequest
  respond: (answer: AgentResponse) => JsonObject
}

/** A small, explicit allowlist of protocol request families. Never guess a response body. */
export function codexRequest(
  method: string,
  params: JsonObject,
  key: string,
  item?: JsonObject,
): PendingCodexRequest | null {
  const detail = JSON.stringify({ ...params, ...(item ? { item } : {}) }, null, 2)
  const view: AgentRequest = {
    id: key,
    kind: 'approval',
    title: 'Codex action',
    detail,
    canAllow: true,
  }
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  ) {
    view.title = method.includes('commandExecution') ? 'Run command' : 'Change files'
    if (params.networkApprovalContext) view.title = 'Network access'
    const decisions = params.availableDecisions
    view.canAllow = !Array.isArray(decisions) || decisions.includes('accept')
    return {
      view,
      respond: (answer) => {
        if (answer.action === 'answer') throw new Error('This request needs an approval decision.')
        if (answer.action === 'allow' && !view.canAllow)
          throw new Error('Allow once is not supported for this request.')
        return { decision: answer.action === 'allow' ? 'accept' : 'decline' }
      },
    }
  }
  if (method === 'item/permissions/requestApproval') {
    view.kind = 'permissions'
    view.title = 'Grant permissions for this turn'
    return {
      view,
      respond: (answer) => {
        if (answer.action === 'answer') throw new Error('This request needs a permission decision.')
        const requested = isObject(params.permissions) ? params.permissions : {}
        const permissions: JsonObject = {}
        for (const field of ['network', 'fileSystem'])
          if (isObject(requested[field])) permissions[field] = requested[field]
        return { permissions: answer.action === 'allow' ? permissions : {}, scope: 'turn' }
      },
    }
  }
  if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') {
    if (
      !Array.isArray(params.questions) ||
      params.questions.length === 0 ||
      params.questions.length > 10
    )
      return null
    const questions = params.questions.filter(isObject).map((q) => ({
      id: str(q.id) ?? '',
      text: str(q.question) ?? '',
      other: q.isOther === true || !Array.isArray(q.options) || !q.options.length,
      secret: q.isSecret === true,
      options: Array.isArray(q.options)
        ? q.options
            .filter(isObject)
            .map((o) => str(o.label) ?? '')
            .filter(Boolean)
        : [],
    }))
    if (
      questions.length !== params.questions.length ||
      questions.some((q) => !q.id || !q.text) ||
      new Set(questions.map((q) => q.id)).size !== questions.length
    )
      return null
    view.kind = 'questions'
    view.title = 'Codex needs your input'
    view.questions = questions
    view.detail = ''
    return {
      view,
      respond: (answer) => {
        if (answer.action !== 'answer') throw new Error('Answer the question or stop the turn.')
        const answers: JsonObject = {}
        for (const q of questions) {
          const text = answer.answers[q.id]?.trim()
          if (!text || text.length > 8000 || (!q.other && !q.options.includes(text)))
            throw new Error('Answer each question using a supported choice.')
          answers[q.id] = { answers: [text] }
        }
        return { answers }
      },
    }
  }
  if (method === 'mcpServer/elicitation/request') {
    view.kind = 'elicitation'
    view.title = str(params.message) ?? 'Connected app request'
    // Form schemas are validated locally. URL and unsupported schemas can be declined,
    // never represented as a generic approval for an unknown action.
    const schema = isObject(params.requestedSchema) ? params.requestedSchema : {}
    const properties = isObject(schema.properties) ? schema.properties : {}
    const supported =
      params.mode === 'form' &&
      schema.type === 'object' &&
      Object.values(properties).every(
        (v) =>
          isObject(v) &&
          v.type === 'string' &&
          !v.pattern &&
          !v.format &&
          !v.minLength &&
          !v.maxLength,
      )
    view.canAllow = supported
    if (supported && Object.keys(properties).length)
      view.questions = Object.entries(properties).map(([id, raw]) => {
        const p = raw as JsonObject
        return {
          id,
          text: str(p.title) ?? str(p.description) ?? id,
          options: Array.isArray(p.enum)
            ? p.enum.filter((v): v is string => typeof v === 'string')
            : [],
          other: !Array.isArray(p.enum),
        }
      })
    else if (!supported)
      view.detail = `This request cannot be completed in Threadlight. Decline it or stop the turn.\n\n${detail}`
    return {
      view,
      respond: (answer) => {
        if (answer.action === 'deny') return { action: 'decline', content: null, _meta: null }
        if (!supported || (view.questions?.length && answer.action !== 'answer'))
          throw new Error('This form is not supported. Decline it or stop the turn.')
        const content: JsonObject = {}
        for (const q of view.questions ?? []) {
          const text = answer.action === 'answer' ? (answer.answers[q.id] ?? '') : ''
          if (
            text.length > 8000 ||
            (Array.isArray(schema.required) && schema.required.includes(q.id) && !text) ||
            (q.options.length && !q.options.includes(text))
          )
            throw new Error('Complete the requested fields.')
          content[q.id] = text
        }
        return { action: 'accept', content, _meta: null }
      },
    }
  }
  return null
}
