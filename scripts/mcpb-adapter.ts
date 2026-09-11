import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:47812/mcp'
const MAX_STDIO_BUFFER_BYTES = 10 * 1024 * 1024

export interface MessageTransport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  start(): Promise<void>
  close(): Promise<void>
  send(message: JSONRPCMessage): Promise<void>
  setProtocolVersion?(version: string): void
}

type JsonRpcId = string | number

function requestId(message: JSONRPCMessage, method: string): JsonRpcId | undefined {
  if (!('method' in message) || message.method !== method || !('id' in message)) return undefined
  return typeof message.id === 'string' || typeof message.id === 'number' ? message.id : undefined
}

function negotiatedProtocolVersion(message: JSONRPCMessage, initializeId: JsonRpcId | undefined): string | undefined {
  if (initializeId === undefined || !('id' in message) || message.id !== initializeId || !('result' in message)) return undefined
  const result = message.result
  if (!result || typeof result !== 'object' || !('protocolVersion' in result)) return undefined
  return typeof result.protocolVersion === 'string' ? result.protocolVersion : undefined
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (normalized === 'localhost' || normalized === '::1') return true
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u)
  if (!ipv4) return false
  const octets = ipv4.slice(1).map(Number)
  return octets.every((octet) => octet >= 0 && octet <= 255) && octets[0] === 127
}

export function parseLoopbackEndpoint(value: string | undefined): URL {
  let endpoint: URL
  try {
    endpoint = new URL(value?.trim() || DEFAULT_ENDPOINT)
  } catch {
    throw new Error('Hronaut MCP endpoint must be a valid loopback HTTP URL.')
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !isLoopbackHostname(endpoint.hostname)) {
    throw new Error('Hronaut MCP endpoint must use HTTP on localhost, 127.0.0.0/8, or ::1.')
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('Hronaut MCP endpoint must not contain credentials.')
  }
  if (endpoint.hash) throw new Error('Hronaut MCP endpoint must not contain a URL fragment.')
  return endpoint
}

export function createRestrictedFetch(endpoint: URL, fetcher: typeof fetch = globalThis.fetch): typeof fetch {
  const allowedUrl = endpoint.href
  return async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString())
    if (requestUrl.href !== allowedUrl) {
      throw new Error('Hronaut MCP adapter blocked an unexpected upstream destination.')
    }
    const response = await fetcher(input, { ...init, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Hronaut MCP adapter does not follow upstream redirects.')
    }
    return response
  }
}

export async function bridgeTransports(
  downstream: MessageTransport,
  upstream: MessageTransport,
  reportError: () => void = () => undefined
): Promise<() => Promise<void>> {
  let closed = false
  let initializeId: JsonRpcId | undefined

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await Promise.allSettled([downstream.close(), upstream.close()])
  }
  const fail = (): void => {
    reportError()
    void close()
  }

  downstream.onmessage = (message) => {
    initializeId = requestId(message, 'initialize') ?? initializeId
    void upstream.send(message).catch(fail)
  }
  upstream.onmessage = (message) => {
    const protocolVersion = negotiatedProtocolVersion(message, initializeId)
    if (protocolVersion) upstream.setProtocolVersion?.(protocolVersion)
    void downstream.send(message).catch(fail)
  }
  downstream.onerror = fail
  upstream.onerror = fail
  downstream.onclose = () => void close()
  upstream.onclose = () => void close()

  try {
    await upstream.start()
    await downstream.start()
  } catch (error) {
    await close()
    throw error
  }
  return close
}

export async function runAdapter(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const endpoint = parseLoopbackEndpoint(environment.HRONAUT_MCP_URL)
  const token = environment.HRONAUT_MCP_TOKEN?.trim()
  const requestInit = token ? { headers: { authorization: `Bearer ${token}` } } : undefined
  const downstream = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: MAX_STDIO_BUFFER_BYTES
  })
  const upstream = new StreamableHTTPClientTransport(endpoint, {
    fetch: createRestrictedFetch(endpoint),
    ...(requestInit ? { requestInit } : {})
  })
  const close = await bridgeTransports(downstream, upstream, () => {
    process.stderr.write('Hronaut MCP adapter connection failed. Check that Hronaut is running and the endpoint and token match Hronaut Home.\n')
  })
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
  process.stdin.once('end', () => void close())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAdapter().catch(() => {
    process.stderr.write('Hronaut MCP adapter could not start. Check the local configuration shown in Hronaut Home.\n')
    process.exitCode = 1
  })
}
