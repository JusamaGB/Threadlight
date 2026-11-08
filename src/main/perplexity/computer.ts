import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { PerplexityVault } from './vault'

export const COMPUTER_URL = 'https://www.perplexity.ai/rest/computer/mcp'
const ALLOWED_TOOLS = new Set([
  'call_perplexity_computer',
  'read_thread',
  'cancel_task',
  'models_list',
  'projects_list',
  'list_thread_assets',
])
export function trustedPerplexityUrl(value: string | URL) {
  const url = new URL(value)
  if (url.origin !== 'https://www.perplexity.ai' || url.username || url.password)
    throw new Error('Untrusted Perplexity endpoint.')
  return url
}
export function validCallback(
  requestUrl: string,
  host: string | undefined,
  redirectUrl: string,
  state: string,
) {
  try {
    const target = new URL(redirectUrl),
      url = new URL(requestUrl, target)
    const received = url.searchParams.get('state') ?? ''
    return (
      host === target.host &&
      url.origin === target.origin &&
      url.pathname === target.pathname &&
      /^[a-f0-9]{64}$/.test(received) &&
      /^[a-f0-9]{64}$/.test(state) &&
      timingSafeEqual(Buffer.from(received), Buffer.from(state)) &&
      (!url.searchParams.has('iss') || url.searchParams.get('iss') === COMPUTER_URL)
    )
  } catch {
    return false
  }
}

/** All OAuth and MCP requests stay on the verified provider origin, with bounded bodies. */
export const perplexityFetch: typeof fetch = async (input, init) => {
  trustedPerplexityUrl(typeof input === 'string' || input instanceof URL ? input : input.url)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(150000)])
    : AbortSignal.timeout(150000)
  const result = await fetch(input, { ...init, signal, redirect: 'error' })
  if (!result.body) return result
  let bytes = 0
  const body = result.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > 4 * 1024 * 1024) throw new Error('Perplexity response exceeded the limit.')
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  })
}

class PerplexityOAuth implements OAuthClientProvider {
  private verifier = ''
  readonly nonce = randomBytes(32).toString('hex')
  constructor(
    readonly redirectUrl: string,
    private vault: PerplexityVault,
    private open: (url: string) => Promise<void>,
    private active: () => boolean,
  ) {}
  private check() {
    if (!this.active()) throw new Error('Connection closed.')
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Threadlight',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }
  state() {
    return this.nonce
  }
  clientInformation() {
    return this.vault.value.client
  }
  async saveClientInformation(value: NonNullable<PerplexityVault['value']['client']>) {
    this.check()
    this.vault.value.client = value
    await this.vault.save()
  }
  tokens() {
    return this.vault.value.tokens
  }
  async saveTokens(value: NonNullable<PerplexityVault['value']['tokens']>) {
    this.check()
    this.vault.value.tokens = value
    await this.vault.save()
  }
  async redirectToAuthorization(value: URL) {
    await this.open(trustedPerplexityUrl(value).href)
  }
  saveCodeVerifier(value: string) {
    this.verifier = value
  }
  codeVerifier() {
    if (!this.verifier) throw new Error('Perplexity sign-in expired.')
    return this.verifier
  }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    this.check()
    if (scope === 'all' || scope === 'client') delete this.vault.value.client
    if (scope === 'all' || scope === 'tokens') delete this.vault.value.tokens
    if (scope === 'all' || scope === 'verifier') this.verifier = ''
    await this.vault.save()
  }
}

export interface ComputerConnection {
  connect(): Promise<string[]>
  call(
    name: string,
    args: Record<string, unknown>,
    progress?: (message: string) => void,
  ): Promise<unknown>
  close(): Promise<void>
}
export class PerplexityComputer implements ComputerConnection {
  private client?: Client
  private transport?: StreamableHTTPClientTransport
  private callback?: Server
  private cancelAuth?: () => void
  private closed = false
  private abort = new AbortController()
  private tools = new Set<string>()
  constructor(
    private vault: PerplexityVault,
    private open: (url: string) => Promise<void>,
    private authorizing: () => void,
  ) {}
  async connect() {
    if (this.closed) throw new Error('Connection closed.')
    const prior = this.vault.value.redirectUrl
    if (prior && !/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/.test(prior))
      throw new Error('Invalid saved callback.')
    let receive: (code: string) => void = () => {}
    let rejectCode: (error: Error) => void = () => {}
    let provider: PerplexityOAuth
    let used = false
    const server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      if (
        !provider ||
        used ||
        request.method !== 'GET' ||
        request.headers.origin ||
        !validCallback(
          request.url ?? '',
          request.headers.host,
          provider.redirectUrl,
          provider.nonce,
        )
      ) {
        response.writeHead(400).end('Invalid or expired sign-in.')
        return
      }
      const url = new URL(request.url!, provider.redirectUrl),
        code = url.searchParams.get('code')
      used = true
      if (!code || code.length > 8192 || url.searchParams.has('error')) {
        response.writeHead(400).end('Sign-in was not completed. Return to Threadlight.')
        rejectCode(new Error('Perplexity sign-in was declined.'))
        return
      }
      response.end('Sign-in received. Return to Threadlight to check the connection.')
      receive(code)
    })
    this.callback = server
    const code = new Promise<string>((resolve, reject) => {
      receive = resolve
      rejectCode = reject
    })
    // The callback may fail while registration is still in progress.
    void code.catch(() => {})
    this.cancelAuth = () => rejectCode(new Error('Sign-in cancelled.'))
    let timer: NodeJS.Timeout | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(prior ? Number(new URL(prior).port) : 0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Cannot start secure sign-in callback.')
      const redirect = `http://127.0.0.1:${address.port}/oauth/callback`
      this.vault.value.redirectUrl = redirect
      provider = new PerplexityOAuth(
        redirect,
        this.vault,
        async (url) => {
          if (this.closed) throw new Error('Connection closed.')
          this.authorizing()
          timer = setTimeout(
            () => rejectCode(new Error('Perplexity sign-in timed out.')),
            5 * 60000,
          )
          await this.open(url)
        },
        () => !this.closed,
      )
      await this.vault.save()
      const attempt = async () => {
        if (this.closed) throw new Error('Connection closed.')
        this.client = new Client(
          { name: 'threadlight-perplexity', version: '0.1.0' },
          { capabilities: {} },
        )
        this.transport = new StreamableHTTPClientTransport(new URL(COMPUTER_URL), {
          authProvider: provider,
          fetch: (input, init) =>
            perplexityFetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, this.abort.signal])
                : this.abort.signal,
            }),
          reconnectionOptions: {
            maxRetries: 0,
            maxReconnectionDelay: 1000,
            initialReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
          },
        })
        await this.client.connect(this.transport, { timeout: 25000 })
      }
      try {
        await attempt()
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error
        await this.transport!.finishAuth(await code)
        await this.client?.close()
        await attempt()
      }
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const result = await this.client!.listTools(cursor ? { cursor } : undefined, {
          timeout: 15000,
        })
        for (const tool of result.tools) if (ALLOWED_TOOLS.has(tool.name)) this.tools.add(tool.name)
        cursor = result.nextCursor
        if (!cursor) break
      }
      if (cursor) throw new Error('Perplexity tool discovery was incomplete.')
      if (!this.tools.has('read_thread') || !this.tools.has('call_perplexity_computer'))
        throw new Error('Computer task tools are unavailable for this account.')
      return [...this.tools]
    } finally {
      if (timer) clearTimeout(timer)
      server.close()
      server.closeAllConnections()
      this.callback = undefined
      this.cancelAuth = undefined
    }
  }
  async call(name: string, args: Record<string, unknown>, progress?: (message: string) => void) {
    if (!this.client || this.closed || !this.tools.has(name) || !ALLOWED_TOOLS.has(name))
      throw new Error('Connect Perplexity Computer first.')
    return this.client.callTool({ name, arguments: args }, undefined, {
      timeout: 145000,
      maxTotalTimeout: 150000,
      onprogress: (value) => {
        if (typeof value.message === 'string') progress?.(value.message.slice(0, 500))
      },
    })
  }
  async close() {
    this.closed = true
    this.abort.abort()
    this.cancelAuth?.()
    this.callback?.close()
    this.callback?.closeAllConnections()
    await this.client?.close()
  }
}
