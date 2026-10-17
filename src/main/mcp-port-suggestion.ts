import { createServer } from 'node:net'
import { isValidMcpPort } from '../shared/mcp-port.js'
import type { McpListenErrorCode } from '../shared/types.js'

/** Why the listener could not start, in the few kinds Hronaut can explain and offer a fix for. */
export function mcpListenErrorCode(error: unknown): McpListenErrorCode {
  const code = typeof error === 'object' && error !== null ? (error as NodeJS.ErrnoException).code : undefined
  if (code === 'EADDRINUSE') return 'port-in-use'
  if (code === 'EACCES' || code === 'EPERM') return 'port-denied'
  return 'other'
}

/** Whether `port` can be bound on `host` right now. The probe listener closes at once and accepts nothing. */
export function mcpPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

/** The first port after `port`, at most 20 above it, that is free on the listener's own host. */
export async function suggestMcpPort(
  port: number,
  host: string,
  available: (port: number, host: string) => Promise<boolean> = mcpPortAvailable
): Promise<number | undefined> {
  for (let next = port + 1; next <= port + 20; next++) {
    if (!isValidMcpPort(next)) break
    if (await available(next, host)) return next
  }
  return undefined
}
