import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

export const SCRIPTED_MODEL = 'threadlight-scripted-model'
export const FIXTURE_CREDENTIAL = 'threadlight-synthetic-not-a-secret'
export const WRITE_CONTENT = 'Scripted Kimi write.\n'

/** Inert on import. Only this owned server may supply the fixture endpoint. */
export async function createScriptedModelServer({
  onRequest = () => {},
  apiRehearsal = false,
} = {}) {
  let scenario = null,
    step = 0,
    requests = 0,
    failure = null,
    closed = false
  const records = [],
    sockets = new Set()
  let heldResponse
  const fail = (message) => {
    failure ??= message
  }
  const server = createServer(async (req, res) => {
    const record = { number: ++requests, scenario, at: new Date().toISOString(), closed: false }
    records.push(record)
    res.once('close', () => {
      record.closed = true
      record.finished = res.writableFinished
    })
    try {
      onRequest()
      if (
        closed ||
        failure ||
        requests > 24 ||
        req.method !== 'POST' ||
        req.url !== '/v1/chat/completions'
      )
        throw Error('Unexpected request or request bound')
      if (!scenario) throw Error('No declared scenario')
      if (req.headers.authorization !== `Bearer ${FIXTURE_CREDENTIAL}`)
        throw Error('Unexpected synthetic authentication')
      let body = '',
        bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 1024 * 1024) throw Error('Request body limit')
        body += chunk
      }
      const data = JSON.parse(body)
      if (data.model !== SCRIPTED_MODEL || data.stream !== true || !Array.isArray(data.messages))
        throw Error('Unexpected model/stream/messages')
      record.body = data // Only the synthetic scenario's messages; never persist Authorization.
      record.syntheticAuthentication = true
      if (
        apiRehearsal &&
        (data.max_completion_tokens !== 4096 || data.max_tokens !== undefined || data.tools?.length)
      )
        throw Error('API rehearsal requires max_completion_tokens=4096 and no tools')
      const tool = data.tools?.find((item) => item.function?.name === 'Write')
      if (data.tools?.some((item) => item.function?.name !== 'Write'))
        throw Error('Unexpected enabled tool')
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const id = `scripted-${randomUUID()}`
      const chunk = (delta, finish_reason = null) =>
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: SCRIPTED_MODEL, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        )
      const finish = (text) => {
        chunk({ role: 'assistant', content: text.slice(0, 8) })
        chunk({ content: text.slice(8) })
        chunk({}, 'stop')
        res.end('data: [DONE]\n\n')
        scenario = null
      }
      if (scenario === 'stream' && step++ === 0) return finish('Scripted stream complete.')
      if (scenario === 'cancel' && step++ === 0) {
        chunk({ role: 'assistant', content: 'Held scripted response.' })
        heldResponse = res
        return
      }
      if (scenario === 'approve' || scenario === 'deny') {
        if (step++ === 0) {
          if (
            !tool ||
            tool.function.parameters?.properties?.path?.type !== 'string' ||
            tool.function.parameters?.properties?.content?.type !== 'string'
          )
            throw Error('Runtime did not advertise the inspected Write schema')
          record.advertisedWriteSchema = tool.function.parameters
          const args = { path: `${scenario}.txt`, content: WRITE_CONTENT }
          record.scriptedTool = {
            name: tool.function.name,
            arguments: args,
            id: `phase2b-${scenario}`,
          }
          chunk({
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `phase2b-${scenario}`,
                type: 'function',
                function: { name: tool.function.name, arguments: JSON.stringify(args) },
              },
            ],
          })
          chunk({}, 'tool_calls')
          res.end('data: [DONE]\n\n')
          return
        }
        if (step === 2) {
          if (!data.messages.some((message) => message.role === 'tool'))
            throw Error('Missing tool outcome')
          return finish(`Scripted ${scenario} terminal.`)
        }
      }
      throw Error('Unexpected scenario transition')
    } catch (error) {
      fail(error.message)
      if (!res.headersSent) res.writeHead(400)
      res.end()
    }
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const deadline = setTimeout(
    () => {
      fail('Fixture lifetime exceeded')
      void close()
    },
    10 * 60 * 1000,
  )
  let closing
  function close() {
    if (closing) return closing
    closed = true
    closing = (async () => {
      clearTimeout(deadline)
      const drained = [...sockets].map(
        (socket) => new Promise((done) => socket.once('close', done)),
      )
      heldResponse?.destroy()
      server.closeAllConnections()
      for (const socket of sockets) socket.destroy()
      await new Promise((done) => server.close(done))
      await Promise.all(drained)
    })()
    return closing
  }
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    arm(next) {
      if (closed || failure || scenario || !['stream', 'approve', 'deny', 'cancel'].includes(next))
        throw Error('Fixture cannot enter scenario')
      scenario = next
      step = 0
    },
    snapshot: () =>
      structuredClone({ requests, records, failure, closed, openSockets: sockets.size }),
    close,
  }
}
