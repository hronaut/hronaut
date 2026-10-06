import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchToken, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { OAuthClientInformationSchema, OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js'

// This exercises explicit issuer binding, not refresh/discovery flows or legacy
// issuer-less storage. Upgrading alone does not migrate old stored credentials.
const issuer = 'https://issuer.synthetic.invalid'
const otherIssuer = 'https://other.synthetic.invalid'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network fetch is forbidden in this offline test') }))
})

afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

function syntheticProvider() {
  const clientInformation = { client_id: 'synthetic-client', client_secret: 'synthetic-secret', issuer }
  const addClientAuthentication = vi.fn<NonNullable<OAuthClientProvider['addClientAuthentication']>>((headers) => {
    headers.set('x-synthetic-authentication', 'offline-marker')
  })
  const prepareTokenRequest = vi.fn(() => new URLSearchParams({ grant_type: 'client_credentials' }))
  const unused = () => { throw new Error('Unexpected interactive or stored-token operation') }
  const provider: OAuthClientProvider = {
    redirectUrl: undefined,
    clientMetadata: { redirect_uris: [] },
    clientInformation: () => clientInformation,
    tokens: unused,
    saveTokens: unused,
    redirectToAuthorization: unused,
    saveCodeVerifier: unused,
    codeVerifier: unused,
    prepareTokenRequest,
    addClientAuthentication
  }
  return { provider, addClientAuthentication, prepareTokenRequest }
}

describe('SDK issuer binding with synthetic offline values', () => {
  it('preserves an issuer through the stored token schema', () => {
    const stored = { access_token: 'synthetic-access', token_type: 'Bearer', refresh_token: 'synthetic-refresh', issuer }
    expect(OAuthTokensSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
  })

  it('preserves an issuer through the stored client-information schema', () => {
    const stored = { client_id: 'synthetic-client', client_secret: 'synthetic-secret', issuer }
    expect(OAuthClientInformationSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored)
  })

  it('rejects a different issuer before preparing authentication or calling fetch', async () => {
    const { provider, addClientAuthentication, prepareTokenRequest } = syntheticProvider()
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: 'synthetic-response', token_type: 'Bearer' }))
    await expect(fetchToken(provider, otherIssuer, { fetchFn })).rejects.toThrow('bound to authorization server')
    expect(prepareTokenRequest).not.toHaveBeenCalled()
    expect(addClientAuthentication).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('keeps matching-issuer token requests working entirely through the mock', async () => {
    const { provider, addClientAuthentication } = syntheticProvider()
    const response = { access_token: 'synthetic-response', token_type: 'Bearer' }
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response))
    await expect(fetchToken(provider, `${issuer}/`, { fetchFn })).resolves.toEqual(response)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url)).toBe(`${issuer}/token`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('x-synthetic-authentication')).toBe('offline-marker')
    expect(String(init?.body)).toBe('grant_type=client_credentials')
    expect(addClientAuthentication).toHaveBeenCalledTimes(1)
  })
})
