import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { mcpListenErrorCode, mcpPortAvailable, suggestMcpPort } from '../src/main/mcp-port-suggestion.js'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))) })
const hold = (port = 0): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer()
  servers.push(server)
  server.once('error', reject)
  server.listen({ port, host: '127.0.0.1' }, () => resolve((server.address() as { port: number }).port))
})

describe('MCP port suggestion', () => {
  it('names a busy or forbidden port, and nothing else', () => {
    expect(mcpListenErrorCode(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }))).toBe('port-in-use')
    expect(mcpListenErrorCode(Object.assign(new Error('listen EACCES'), { code: 'EACCES' }))).toBe('port-denied')
    expect(mcpListenErrorCode(Object.assign(new Error('listen EPERM'), { code: 'EPERM' }))).toBe('port-denied')
    expect(mcpListenErrorCode(new Error('listen EADDRINUSE'))).toBe('other')
    expect(mcpListenErrorCode('EADDRINUSE')).toBe('other')
    expect(mcpListenErrorCode(undefined)).toBe('other')
  })

  it('suggests the first free port after the busy one, up to 20 above it', async () => {
    const busy = new Set([47813, 47814])
    const asked: number[] = []
    const available = async (port: number) => { asked.push(port); return !busy.has(port) }
    expect(await suggestMcpPort(47812, '127.0.0.1', available)).toBe(47815)
    expect(asked).toEqual([47813, 47814, 47815])
    expect(await suggestMcpPort(47812, '127.0.0.1', async () => false)).toBeUndefined()
    asked.length = 0
    await suggestMcpPort(47812, '127.0.0.1', async (port) => { asked.push(port); return false })
    expect(asked).toEqual(Array.from({ length: 20 }, (_, index) => 47813 + index))
    expect(await suggestMcpPort(65_534, '127.0.0.1', async () => true)).toBe(65_535)
    expect(await suggestMcpPort(65_535, '127.0.0.1', async () => true)).toBeUndefined()
  })

  it('sees a port another listener holds as busy and releases the ports it probes', async () => {
    const port = await hold()
    expect(await mcpPortAvailable(port, '127.0.0.1')).toBe(false)
    const free = await hold()
    await new Promise(resolve => servers.pop()!.close(resolve))
    expect(await mcpPortAvailable(free, '127.0.0.1')).toBe(true)
    expect(await hold(free)).toBe(free)
  })
})
