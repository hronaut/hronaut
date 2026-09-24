import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Compose {
  services: Record<string, { network_mode?: string; networks?: unknown; ports?: unknown }>
  networks?: unknown
}

describe('single-container Docker test networking', () => {
  it.each([false, true])('does not allocate a subnet for a new project (focused: %s)', async focused => {
    const base = parse(await readFile('compose.test.ci.yaml', 'utf8')) as Compose
    const override = focused
      ? parse(await readFile('compose.test.focused.yaml', 'utf8')) as Compose
      : undefined
    // The sole test service runs Electron, fixture servers and MCP on its own
    // loopback interface. It needs neither cross-service DNS nor published ports.
    expect(Object.keys(base.services)).toEqual(['integration'])
    const service = { ...base.services.integration, ...override?.services.integration }
    expect(service.network_mode).toBe('bridge')
    expect(service.networks).toBeUndefined()
    expect(service.ports).toBeUndefined()
    expect(base.networks).toBeUndefined()
    expect(override?.networks).toBeUndefined()
  })
})
