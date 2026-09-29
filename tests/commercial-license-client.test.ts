import { describe, expect, it, vi } from 'vitest'
import { CommercialLicenseClient } from '../src/main/commercial-license-client.js'

describe('CommercialLicenseClient', () => {
  it('activates through the Hronaut server and parses the sanitized result', async () => {
    const request = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      valid: true,
      status: 'active',
      productId: 'prod_hronaut',
      instanceId: 'inst_abcdefgh1234',
      activations: 1,
      activationLimit: 3,
      expiresAt: null
    }))
    const client = new CommercialLicenseClient('https://hronaut.example/api/creem-license', request as unknown as typeof fetch)
    const result = await client.activate('ABCD-EFGH-IJKL-MNOP', 'Hronaut 123456789abc')

    expect(result).toMatchObject({ valid: true, status: 'active', instanceId: 'inst_abcdefgh1234' })
    expect(request).toHaveBeenCalledWith(
      'https://hronaut.example/api/creem-license/activate',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(String((request.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({ licenseKey: 'ABCD-EFGH-IJKL-MNOP', instanceName: 'Hronaut 123456789abc' })
  })

  it('maps a sanitized service error', async () => {
    const request = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json(
      { valid: false, reason: 'activation_limit_reached' },
      { status: 403 }
    ))
    const client = new CommercialLicenseClient('https://hronaut.example/api/creem-license', request as unknown as typeof fetch)
    await expect(client.activate('ABCD-EFGH-IJKL-MNOP', 'Hronaut 123456789abc')).rejects.toMatchObject({
      reason: 'activation_limit_reached',
      status: 403
    })
  })

  it.each([
    'not json', 'null', '[]', 'true', '{}',
    '{"valid":false}',
    '{"valid":"false","status":"inactive","productId":"prod_hronaut"}',
    '{"valid":false,"status":"","productId":"prod_hronaut"}',
    '{"valid":false,"status":"inactive","productId":""}'
  ])('rejects malformed successful validation without manufacturing an inactive result: %s', async body => {
    const request = vi.fn(async () => new Response(body, { status: 200 }))
    const client = new CommercialLicenseClient('https://hronaut.example/api/creem-license', request)
    await expect(client.validate('test-key', 'test-instance')).rejects.toMatchObject({
      name: 'CommercialLicenseError', reason: 'service_unavailable', status: 200
    })
  })

  it('preserves an explicit inactive validation result', async () => {
    const request = vi.fn(async () => Response.json({ valid: false, status: 'inactive', productId: 'prod_hronaut' }))
    const client = new CommercialLicenseClient('https://hronaut.example/api/creem-license', request)
    await expect(client.validate('test-key', 'test-instance')).resolves.toMatchObject({
      valid: false, status: 'inactive', productId: 'prod_hronaut'
    })
  })

  it('maps a null error response to a service failure', async () => {
    const request = vi.fn(async () => Response.json(null, { status: 503 }))
    const client = new CommercialLicenseClient('https://hronaut.example/api/creem-license', request)
    await expect(client.validate('test-key', 'test-instance')).rejects.toMatchObject({
      name: 'CommercialLicenseError', reason: 'service_unavailable', status: 503
    })
  })

  it('allows plain HTTP only for local development', () => {
    expect(() => new CommercialLicenseClient('http://127.0.0.1:8788/api/creem-license')).not.toThrow()
    expect(() => new CommercialLicenseClient('http://hronaut.example/api/creem-license')).toThrow('must use HTTPS')
  })
})
