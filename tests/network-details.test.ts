import { describe, expect, it } from 'vitest'
import { redactNetworkHeaders, redactNetworkUrl, sanitizeNetworkBody } from '../src/shared/network-details.js'

describe('network detail redaction', () => {
  it('redacts credentials and sensitive query values without hiding useful URL data', () => {
    expect(redactNetworkUrl('https://person:password@example.test/api?token=secret&view=compact#private')).toBe(
      'https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/api?view=compact&token=%5BREDACTED%5D'
    )
  })

  it('redacts security headers while preserving diagnostic headers', () => {
    expect(redactNetworkHeaders({
      Authorization: 'Bearer secret',
      Cookie: ['session=private'],
      'X-Api-Key': 'private',
      'Content-Type': 'application/json',
      'X-Request-Id': 'request-42'
    })).toEqual({
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'X-Api-Key': '[REDACTED]',
      'Content-Type': 'application/json',
      'X-Request-Id': 'request-42'
    })
  })

  it('redacts nested JSON secrets and bounds the formatted output', () => {
    const result = sanitizeNetworkBody(JSON.stringify({
      ok: true,
      access_token: 'private',
      nested: { password: 'private', visible: 'kept' }
    }), 'application/json', 10_000)

    expect(JSON.parse(result.text)).toEqual({
      ok: true,
      access_token: '[REDACTED]',
      nested: { password: '[REDACTED]', visible: 'kept' }
    })
    expect(result).toMatchObject({ truncated: false, redacted: true })
  })

  it.each(['text/plain', 'application/json', undefined])('omits deeply nested JSON instead of exposing secrets (%s)', (contentType) => {
    for (const [open, close] of [['[', ']'], ['{"child":', '}']]) {
      const body = '{"password":"fixture-secret","nested":'
        + open!.repeat(12_000) + '0' + close!.repeat(12_000) + '}'
      const result = sanitizeNetworkBody(body, contentType, 1_000)

      expect(result.text).toBe('[JSON body omitted: could not safely redact]')
      expect(result.text).not.toContain('fixture-secret')
      expect(result).toMatchObject({ originalChars: body.length, redacted: true, truncated: false })
    }
  })

  it('retains incomplete plain-text JSON as bounded text', () => {
    expect(sanitizeNetworkBody('{"status":', 'text/plain', 1_000).text).toBe('{"status":')
  })

  it('redacts form fields and omits binary or multipart bodies', () => {
    expect(sanitizeNetworkBody('name=Ada&password=private', 'application/x-www-form-urlencoded', 1_000).text)
      .toBe('name=Ada&password=%5BREDACTED%5D')
    expect(sanitizeNetworkBody('base64-data', 'image/png', 1_000, { base64Encoded: true }).text)
      .toBe('[binary body omitted]')
    expect(sanitizeNetworkBody('multipart-data', 'multipart/form-data; boundary=test', 1_000).text)
      .toBe('[multipart body omitted]')
  })

  it('marks long text responses as truncated', () => {
    const result = sanitizeNetworkBody('abcdefghijkl', 'text/plain', 5)
    expect(result.text).toBe('abcde\n[truncated after 5 characters]')
    expect(result).toMatchObject({ originalChars: 12, truncated: true, redacted: false })
  })
})
