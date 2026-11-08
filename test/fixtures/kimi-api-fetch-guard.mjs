// Opt-in test transport guard, not a production provider or OS isolation boundary.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export function guardedApiFetch(plan, send, save) {
  const synthetic = plan.mode === 'rehearsal'
  if (
    !(synthetic
      ? /^http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions$/.test(plan.url)
      : plan.mode === 'moonshot' && plan.url === 'https://api.moonshot.ai/v1/chat/completions') ||
    plan.model !== (synthetic ? 'threadlight-scripted-model' : 'kimi-k3.1-pro') ||
    !Number.isFinite(plan.deadline) ||
    plan.deadline <= Date.now() ||
    plan.deadline > Date.now() + 600000
  )
    throw Error('Invalid one-request API guard plan')
  const record = { attempts: 0, blocked: 0, outcome: 'not-sent' }
  let reserved = false
  return async (input, init = {}) => {
    try {
      if (
        record.attempts ||
        Date.now() >= plan.deadline ||
        String(input) !== plan.url ||
        init.method !== 'POST' ||
        typeof init.body !== 'string' ||
        Buffer.byteLength(init.body) > 32768
      )
        throw Error('Request gate')
      const body = JSON.parse(init.body)
      if (
        body.model !== plan.model ||
        body.stream !== true ||
        body.max_completion_tokens !== 4096 ||
        body.max_tokens !== undefined ||
        body.tools?.length ||
        body.n > 1 ||
        !Array.isArray(body.messages)
      )
        throw Error('Request envelope')
      record.attempts = 1
      record.outcome = 'delivery-uncertain'
      record.requestBytes = Buffer.byteLength(init.body)
      record.requestSha256 = createHash('sha256').update(init.body).digest('hex')
      record.maxCompletionTokens = body.max_completion_tokens
      record.model = body.model
      record.at = new Date().toISOString()
      save(record, true) // Durable reservation BEFORE handing anything to the network.
      reserved = true
    } catch {
      record.blocked++
      if (reserved) save(record, false)
      throw Error('One-request API guard refused admission; do not replay')
    }
    try {
      const timeout = AbortSignal.timeout(Math.max(1, plan.deadline - Date.now()))
      const response = await send(input, {
        ...init,
        redirect: 'error',
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      })
      record.httpStatus = response.status
      record.outcome = 'response-headers-received'
      save(record, false)
      return response
    } catch {
      save(record, false)
      throw Error('API delivery uncertain; no automatic replay')
    }
  }
}

// Installed only in the owned Kimi child using NODE_OPTIONS=--import; never on import in tests.
if (process.env.THREADLIGHT_KIMI_FETCH_PLAN) {
  const plan = JSON.parse(readFileSync(process.env.THREADLIGHT_KIMI_FETCH_PLAN, 'utf8'))
  globalThis.fetch = guardedApiFetch(plan, globalThis.fetch, (record, first) =>
    writeFileSync(plan.receipt, JSON.stringify(record), { flag: first ? 'wx' : 'w', flush: true }),
  )
}
