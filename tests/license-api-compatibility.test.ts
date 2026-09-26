import { describe, expect, it } from 'vitest'
import { CommercialLicenseClient } from '../src/main/commercial-license-client.js'
import fixtures from '../src/shared/license-api-fixtures.json' with { type: 'json' }

describe('published license API compatibility', () => {
  it('consumes the success fixture without losing device or product fields', async () => {
    const client = new CommercialLicenseClient('https://example.test/license', async () => Response.json(fixtures.active))
    expect(await client.validate('EXAMPLE', fixtures.active.instanceId)).toEqual(fixtures.active)
  })
  it.each([['pending', 503], ['inactive', 403]] as const)('preserves the %s reason for recovery', async (kind, status) => {
    const client = new CommercialLicenseClient('https://example.test/license', async () => Response.json(fixtures[kind], { status }))
    await expect(client.validate('EXAMPLE', fixtures.active.instanceId)).rejects.toMatchObject({ reason: fixtures[kind].reason, status })
  })
})
