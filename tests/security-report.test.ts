import { describe, expect, it } from 'vitest'
import { buildBrowserSecurityReport } from '../src/shared/security-report.js'

describe('buildBrowserSecurityReport', () => {
  it('summarizes bounded TLS and certificate metadata without raw certificate material', () => {
    const nowMs = Date.UTC(2026, 7, 15)
    const report = buildBrowserSecurityReport({
      tabId: 'tab-1',
      url: 'https://example.test/account',
      title: 'Account\u0000',
      nowMs,
      checkedAt: '2026-08-15T00:00:00.000Z',
      securityState: 'secure',
      details: {
        protocol: 'TLS 1.3',
        cipher: 'AES_128_GCM',
        keyExchangeGroup: 'X25519',
        subjectName: 'example.test',
        issuer: 'Test CA',
        sanList: ['example.test', 'www.example.test', 'example.test'],
        validFrom: Date.UTC(2026, 7, 1) / 1_000,
        validTo: Date.UTC(2026, 8, 14) / 1_000,
        certificateTransparencyCompliance: 'compliant',
        encryptedClientHello: false
      }
    })

    expect(report).toMatchObject({
      tabId: 'tab-1',
      title: 'Account',
      state: 'secure',
      secureTransport: true,
      connection: {
        protocol: 'TLS 1.3',
        cipher: 'AES_128_GCM',
        keyExchangeGroup: 'X25519',
        certificateTransparencyCompliance: 'compliant',
        encryptedClientHello: false
      },
      certificate: {
        subjectName: 'example.test',
        issuer: 'Test CA',
        sanList: ['example.test', 'www.example.test'],
        sanCount: 2,
        valid: true,
        expired: false,
        notYetValid: false,
        daysUntilExpiry: 30
      }
    })
    expect(JSON.stringify(report)).not.toContain('certificateId')
    expect(JSON.stringify(report)).not.toContain('BEGIN CERTIFICATE')
  })

  it('marks plain HTTP as unencrypted even without a captured response', () => {
    const report = buildBrowserSecurityReport({
      tabId: 'tab-2',
      url: 'http://example.test/',
      title: 'Example',
      nowMs: 0,
      securityState: 'secure'
    })
    expect(report).toMatchObject({
      origin: 'http://example.test',
      state: 'insecure',
      secureTransport: false
    })
    expect(report.connection).toBeUndefined()
    expect(report.certificate).toBeUndefined()
  })
})
