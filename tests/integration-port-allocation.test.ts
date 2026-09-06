import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { integrationMcpPort } from './integration/port-allocation.js'

describe('integration MCP port allocation', () => {
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

  it('keeps unsharded and invalid environments on the unsharded range', () => {
    expect(integrationMcpPort(undefined, 0)).toBe(18_000)
    expect(integrationMcpPort('invalid', 2)).toBe(18_002)
    expect(integrationMcpPort('99', 0)).toBe(18_000)
  })
})
