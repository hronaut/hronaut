import { connect, createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpPortRecovery, mcpListenErrorCode, mcpPortAvailable, mcpSystemPort, suggestMcpPort, type McpPortProbes } from '../src/main/mcp-runtime/mcp-port-suggestion.js'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))) })
const hold = (port = 0): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer()
  servers.push(server)
  server.once('error', reject)
  server.listen({ port, host: '127.0.0.1' }, () => resolve((server.address() as { port: number }).port))
})
const errno = (code: string) => Object.assign(new Error(`listen ${code}`), { code })
const probes = (busy: Set<number>, system?: number, asked: number[] = []): McpPortProbes => ({
  available: async (port) => { asked.push(port); return !busy.has(port) },
  system: async () => system
})

describe('MCP port suggestion', () => {
  it('names a busy or forbidden port, also when wrapped, and nothing else', () => {
    expect(mcpListenErrorCode(errno('EADDRINUSE'))).toBe('port-in-use')
    expect(mcpListenErrorCode(errno('EACCES'))).toBe('port-denied')
    expect(mcpListenErrorCode(errno('EPERM'))).toBe('port-denied')
    // setMcpPort's own error keeps the listen error as its cause.
    expect(mcpListenErrorCode(new Error('Could not listen on 127.0.0.1:47813', { cause: errno('EADDRINUSE') }))).toBe('port-in-use')
    expect(mcpListenErrorCode(new Error('listen EADDRINUSE'))).toBe('other')
    expect(mcpListenErrorCode(new Error('settings write failed', { cause: new Error('EIO') }))).toBe('other')
    expect(mcpListenErrorCode('EADDRINUSE')).toBe('other')
    expect(mcpListenErrorCode(undefined)).toBe('other')
  })

  it('suggests the first free port after the busy one, up to 20 above it, then one the system picks', async () => {
    const asked: number[] = []
    expect(await suggestMcpPort(47812, '127.0.0.1', probes(new Set([47813, 47814]), undefined, asked))).toBe(47815)
    expect(asked).toEqual([47813, 47814, 47815])
    asked.length = 0
    const none = { available: async (port: number) => { asked.push(port); return false }, system: async () => 51234 }
    // A run of refused ports, as inside a range Windows reserves, falls back to the system's choice.
    expect(await suggestMcpPort(47812, '127.0.0.1', none)).toBe(51234)
    expect(asked).toEqual(Array.from({ length: 20 }, (_, index) => 47813 + index))
    expect(await suggestMcpPort(47812, '127.0.0.1', { available: async () => false, system: async () => undefined })).toBeUndefined()
    expect(await suggestMcpPort(65_534, '127.0.0.1', probes(new Set()))).toBe(65_535)
    expect(await suggestMcpPort(65_535, '127.0.0.1', probes(new Set(), 50_000))).toBe(50_000)
  })

  it('sees a port another listener holds as busy and releases the ports it probes', async () => {
    const port = await hold()
    expect(await mcpPortAvailable(port, '127.0.0.1')).toBe(false)
    const free = await hold()
    await new Promise(resolve => servers.pop()!.close(resolve))
    expect(await mcpPortAvailable(free, '127.0.0.1')).toBe(true)
    expect(await hold(free)).toBe(free)
    const system = await mcpSystemPort('127.0.0.1')
    expect(system).toBeGreaterThanOrEqual(1024)
    expect(await hold(system)).toBe(system)
  })

  it('is not held open by a peer that connects to the probe and never hangs up', async () => {
    const free = await hold()
    await new Promise(resolve => servers.pop()!.close(resolve))
    const sockets: ReturnType<typeof connect>[] = []
    // Keep dialing the port while the probe binds it, as a neighbouring health check might.
    const dialer = setInterval(() => { const socket = connect(free, '127.0.0.1'); socket.on('error', () => undefined); sockets.push(socket) }, 1)
    try {
      const started = Date.now()
      expect(await mcpPortAvailable(free, '127.0.0.1', 2_000)).toBe(true)
      expect(Date.now() - started).toBeLessThan(1_500)
    } finally {
      clearInterval(dialer)
      for (const socket of sockets) socket.destroy()
    }
  })
})

describe('MCP port recovery', () => {
  function recovery(overrides: { busy?: Set<number>; listen?: (port: number) => Promise<unknown> } = {}) {
    let failed = true
    const changed = vi.fn()
    const listen = vi.fn(overrides.listen ?? (async () => { failed = false }))
    const instance = new McpPortRecovery({
      host: () => '127.0.0.1',
      failed: () => failed,
      listen,
      changed,
      probes: probes(overrides.busy ?? new Set())
    })
    return { instance, listen, changed, setFailed: (value: boolean) => { failed = value } }
  }

  it('offers a free port for a busy or refused port, and none for other failures', async () => {
    const { instance } = recovery({ busy: new Set([47813]) })
    expect(await instance.record(errno('EADDRINUSE'), 47812)).toEqual({ code: 'port-in-use', port: 47812, suggestedPort: 47814 })
    expect(await instance.record(errno('EACCES'), 47900)).toEqual({ code: 'port-denied', port: 47900, suggestedPort: 47901 })
    expect(await instance.record(new Error('boom'), 47812)).toEqual({ code: 'other', port: 47812 })
  })

  it('drops a failure whose listener started while the free port was being found', async () => {
    const { instance, setFailed } = recovery()
    const recording = instance.record(errno('EADDRINUSE'), 47812)
    setFailed(false)
    expect(await recording).toBeUndefined()
    expect(instance.failure).toBeUndefined()
    const second = recovery()
    const late = second.instance.record(errno('EADDRINUSE'), 47812)
    second.instance.clear()
    expect(await late).toBeUndefined()
  })

  it('moves only to the offered port, and shares one move between requests', async () => {
    let finish!: () => void
    const { instance, listen, setFailed } = recovery({ listen: () => new Promise<void>((resolve) => { finish = () => { setFailed(false); resolve() } }) })
    await instance.record(errno('EADDRINUSE'), 47812)
    expect(await instance.move(47900)).toEqual({ outcome: 'not-offered' })
    expect(await instance.move('47813')).toEqual({ outcome: 'not-offered' })
    const first = instance.move(47813)
    const second = instance.move(47813)
    expect(second).toBe(first)
    finish()
    expect(await first).toEqual({ outcome: 'moved', port: 47813 })
    expect(listen).toHaveBeenCalledTimes(1)
    expect(await instance.move(47813)).toEqual({ outcome: 'not-offered' })
  })

  it('offers the next free port when the offered one was taken, and keeps the offer when only saving failed', async () => {
    const taken = recovery({ listen: async () => { throw new Error('Could not listen', { cause: errno('EADDRINUSE') }) } })
    await taken.instance.record(errno('EADDRINUSE'), 47812)
    expect(await taken.instance.move(47813)).toEqual({ outcome: 'taken', port: 47813 })
    expect(taken.instance.failure).toEqual({ code: 'port-in-use', port: 47812, suggestedPort: 47814 })
    expect(taken.changed).toHaveBeenCalledTimes(1)

    const failed = recovery({ listen: async () => { throw new Error('Could not save settings') } })
    await failed.instance.record(errno('EADDRINUSE'), 47812)
    expect(await failed.instance.move(47813)).toEqual({ outcome: 'failed', port: 47813 })
    expect(failed.instance.failure?.suggestedPort).toBe(47813)
    expect(failed.changed).not.toHaveBeenCalled()
  })

  it('closes a dialog about the failure once it is cleared', async () => {
    const { instance } = recovery()
    await instance.record(errno('EADDRINUSE'), 47812)
    const signal = instance.signal
    expect(signal.aborted).toBe(false)
    instance.clear()
    expect(signal.aborted).toBe(true)
    expect(instance.signal.aborted).toBe(false)
  })
})
