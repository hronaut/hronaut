import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUSY_PORT_BLOCK, integrationBusyMcpPort, integrationMcpPort } from './integration/port-allocation.js'

describe('integration MCP port allocation', () => {
  it('isolates nested trace fixture workers from every parent shard and retry slot', () => {
    const parentPorts = new Set<number>()
    for (let shard = 0; shard <= 8; shard += 1) {
      for (let worker = 0; worker < 1_000; worker += 1) parentPorts.add(integrationMcpPort(String(shard), worker))
    }
    const childPorts = new Set<number>()
    for (let worker = 0; worker < 1_000; worker += 1) {
      const port = integrationMcpPort(undefined, worker, 'trace-fixtures')
      expect(parentPorts.has(port), `nested worker ${worker} overlaps parent port ${port}`).toBe(false)
      childPorts.add(port)
    }
    expect(childPorts.size).toBe(1_000)
    expect(integrationMcpPort(undefined, 2, 'trace-fixtures')).toBe(27_002)
  })

  it.runIf(process.platform === 'linux')('keeps nested trace ports outside the kernel ephemeral range', () => {
    const [first, last] = readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/).map(Number)
    for (let worker = 0; worker < 1_000; worker += 1) {
      const port = integrationMcpPort('8', worker, 'trace-fixtures')
      expect(port < first! || port > last!).toBe(true)
    }
  })

  it('rejects an unknown namespace rather than silently sharing parent ports', () => {
    expect(() => integrationMcpPort(undefined, 2, 'unknown')).toThrow(RangeError)
  })

  it.runIf(process.platform === 'linux')('keeps reserved listener slots outside the running kernel ephemeral range', () => {
    const [first, last] = readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/).map(Number)
    expect(first).toBeGreaterThan(0)
    expect(last).toBeGreaterThan(first!)
    for (let shard = 0; shard <= 8; shard += 1) {
      for (let worker = 0; worker < 1_000; worker += 1) {
        const port = integrationMcpPort(String(shard), worker)
        expect(port < first! || port > last!, `reserved port ${port} overlaps ephemeral ${first}-${last}`).toBe(true)
      }
    }
  })

  it('keeps every reserved shard and worker slot distinct', () => {
    const ports = new Set<number>()
    for (let shard = 0; shard <= 8; shard += 1) {
      for (let worker = 0; worker < 1_000; worker += 1) {
        ports.add(integrationMcpPort(String(shard), worker))
      }
    }
    expect(ports.size).toBe(9_000)
  })

  it.each([-1, 1_000, 0.5, Number.NaN])('rejects worker index %s instead of overlapping another shard', (worker) => {
    expect(() => integrationMcpPort('1', worker)).toThrow(RangeError)
  })

  it('reserves a distinct range for every Docker shard', () => {
    expect(integrationMcpPort('1', 0)).toBe(19_000)
    expect(integrationMcpPort('2', 0)).toBe(20_000)
    expect(integrationMcpPort('1', 3)).toBe(19_003)
    expect(integrationMcpPort('8', 0)).toBe(26_000)
  })

  describe('busy-port blocks', () => {
    /** Every port a busy-port case may use: the occupied one and the 20 above it that Hronaut may offer. */
    const block = (shard: number, slot: number): number[] => {
      const port = integrationBusyMcpPort(String(shard), slot)
      return Array.from({ length: 21 }, (_, offset) => port + offset)
    }

    it('keeps the occupied port and every offer clear of all reserved fixture ports and of each other', () => {
      const reserved = new Set<number>()
      for (let worker = 0; worker < 1_000; worker += 1) {
        for (let shard = 0; shard <= 8; shard += 1) reserved.add(integrationMcpPort(String(shard), worker))
        reserved.add(integrationMcpPort(undefined, worker, 'trace-fixtures'))
      }
      const used = new Set<number>()
      for (let shard = 0; shard <= 8; shard += 1) {
        for (let slot = 0; slot < 16; slot += 1) {
          for (const port of block(shard, slot)) {
            expect(reserved.has(port), `busy port ${port} overlaps a fixture port`).toBe(false)
            expect(used.has(port), `busy port ${port} overlaps another block`).toBe(false)
            used.add(port)
          }
        }
      }
      expect(BUSY_PORT_BLOCK).toBeGreaterThanOrEqual(21)
      expect(integrationBusyMcpPort(undefined, 0)).toBe(28_000)
      expect(integrationBusyMcpPort('1', 2)).toBe(28_000 + 18 * BUSY_PORT_BLOCK)
    })

    it.runIf(process.platform === 'linux')('keeps busy-port blocks below the running kernel ephemeral range', () => {
      const [first, last] = readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/).map(Number)
      for (let shard = 0; shard <= 8; shard += 1) {
        for (let slot = 0; slot < 16; slot += 1) {
          for (const port of block(shard, slot)) expect(port < first! || port > last!, `busy port ${port} overlaps ephemeral ${first}-${last}`).toBe(true)
        }
      }
    })

    it.each([-1, 16, 0.5, Number.NaN])('rejects parallel index %s instead of sharing a block', (slot) => {
      expect(() => integrationBusyMcpPort('1', slot)).toThrow(RangeError)
    })
  })

  it('keeps unsharded and invalid environments on the unsharded range', () => {
    expect(integrationMcpPort(undefined, 0)).toBe(18_000)
    expect(integrationMcpPort('invalid', 2)).toBe(18_002)
    expect(integrationMcpPort('99', 0)).toBe(18_000)
  })

  // A restart on mcpPort + 1 took the next worker's port, and the port-in-use dialog then covered the Settings button.
  it('relaunches every e2e app on its own worker\'s MCP port', () => {
    const files = readdirSync('tests/integration').filter((name) => name.endsWith('.e2e.ts'))
    expect(files.length).toBeGreaterThan(100)
    for (const file of files) {
      const source = readFileSync(join('tests/integration', file), 'utf8')
      expect(source, file).not.toMatch(/mcpPort\s*[+-]\s*\d/)
      // Without a port Hronaut listens on its default one, which every worker shares. Only the case that checks the
      // port a profile saved relaunches without one.
      if (file !== 'mcp-authentication.e2e.ts') expect(source, file).not.toMatch(/launchHronaut\(\s*profileDirectory\s*\)/)
    }
  })
})
