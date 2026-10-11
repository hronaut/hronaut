import { describe, expect, it } from 'vitest'
import { fixtureObserver, safeDiagnostic } from './integration/oopif-diagnostic.js'

describe('diagnostic-only OOPIF export', () => {
  it('reconstructs an allowlist and removes page bodies, URLs, paths, payloads and arbitrary strings', () => {
    const secret = 'private-page-profile-token'
    const report = safeDiagnostic({ arm: secret, assertion: secret, result: secret, rootEvents: [{ kind: secret, role: secret, target: secret, text: secret, x: secret }], framesBefore: [{ url: secret, processId: 9, routingId: 2 }] })
    expect(report).not.toContain(secret)
    expect(JSON.parse(report).framesBefore).toEqual([{ role: 'unknown', processId: 9, routingId: 2 }])
  })
  it('caps arrays, rejects nonfinite numbers and retains the failed immediate observation', () => {
    const event = { kind: 'click', role: 'child', target: 'button', x: Infinity, at: 123 }
    const report = JSON.parse(safeDiagnostic({ assertion: 'failed', immediateHits: 0, settledHits: 1, childHits: 1, rootEvents: Array(2000).fill(event), commands: Array(2000).fill(event) }))
    expect(report.rootEvents).toHaveLength(32)
    expect(report.commands).toHaveLength(12)
    expect(report.rootEvents[0].x).toBeNull()
    expect(report).toMatchObject({ assertion: 'failed', immediateHits: 0, settledHits: 1, childHits: 1 })
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(65536)
  })
  it('does not coerce malicious objects into allowed enum values', () => {
    const report = safeDiagnostic({ rootEvents: [{ kind: { toString: () => 'click', secret: 'private-token' }, target: { toString: () => 'button', secret: 'private-token' } }] })
    expect(report).not.toContain('private-token')
  })
  it('emits a fixed role and bounded observer without storing message payloads', () => {
    const script = fixtureObserver('child')
    expect(script).toContain("role:'child'")
    expect(script).toContain('state.events.length<32')
    expect(script).not.toContain('innerHTML')
  })
})
