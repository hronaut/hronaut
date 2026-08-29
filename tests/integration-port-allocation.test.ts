import { describe, expect, it } from 'vitest'
import { integrationMcpPort } from './integration/port-allocation.js'

describe('integration MCP port allocation', () => {
  it('reserves a distinct range for every Docker shard', () => {
    expect(integrationMcpPort('1', 0)).toBe(48_800)
    expect(integrationMcpPort('2', 0)).toBe(48_900)
    expect(integrationMcpPort('1', 3)).toBe(48_803)
  })

  it('keeps unsharded and invalid environments on the legacy range', () => {
    expect(integrationMcpPort(undefined, 0)).toBe(48_700)
    expect(integrationMcpPort('invalid', 2)).toBe(48_702)
    expect(integrationMcpPort('99', 0)).toBe(48_700)
  })
})
