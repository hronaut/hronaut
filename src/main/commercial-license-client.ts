import type { CommercialLicenseProviderResult } from '../shared/types.js'

export class CommercialLicenseError extends Error {
  constructor(
    readonly reason: string,
    readonly status?: number
  ) {
    super(reason)
    this.name = 'CommercialLicenseError'
  }
}

type RequestFunction = typeof fetch

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  const localDevelopment = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new Error('Commercial license service API must use HTTPS outside local development')
  }
  return url.toString().replace(/\/$/, '')
}

export class CommercialLicenseClient {
  private readonly baseUrl: string

  constructor(baseUrl: string, private readonly request: RequestFunction = fetch) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  activate(licenseKey: string, instanceName: string): Promise<CommercialLicenseProviderResult> {
    return this.call('activate', { licenseKey, instanceName })
  }

  validate(licenseKey: string, instanceId: string): Promise<CommercialLicenseProviderResult> {
    return this.call('validate', { licenseKey, instanceId })
  }

  deactivate(licenseKey: string, instanceId: string): Promise<CommercialLicenseProviderResult> {
    return this.call('deactivate', { licenseKey, instanceId })
  }

  private async call(operation: string, body: Record<string, string>): Promise<CommercialLicenseProviderResult> {
    let response: Response
    try {
      response = await this.request(`${this.baseUrl}/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new CommercialLicenseError('service_unavailable')
    }

    let payload: Record<string, unknown> = {}
    try {
      payload = await response.json() as Record<string, unknown>
    } catch {
      // A malformed upstream response is handled as a service failure below.
    }
    if (!response.ok) {
      const reason = typeof payload.reason === 'string' ? payload.reason : 'service_unavailable'
      throw new CommercialLicenseError(reason, response.status)
    }

    const status = typeof payload.status === 'string' ? payload.status : 'inactive'
    return {
      valid: payload.valid === true,
      status,
      productId: typeof payload.productId === 'string' ? payload.productId : '',
      instanceId: typeof payload.instanceId === 'string' ? payload.instanceId : undefined,
      activations: typeof payload.activations === 'number' ? payload.activations : undefined,
      activationLimit: typeof payload.activationLimit === 'number' ? payload.activationLimit : null,
      expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null
    }
  }
}
