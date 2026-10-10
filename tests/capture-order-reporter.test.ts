import { describe, expect, it } from 'vitest'
import { boundedOutcome } from '../scripts/diagnostics/capture-order-reporter.js'

describe('diagnostic artifact projection', () => {
  it.each(['passed', 'failed'] as const)('retains bounded telemetry for %s without unrelated evidence', status => {
    const privatePath = '/tmp/private-profile-canary'
    const result = {
      status, retry: 0, duration: 12,
      errors: [{ message: `UnknownVizError at ${privatePath}`, stack: privatePath }],
      stdout: [privatePath], stderr: [privatePath],
      attachments: [
        { name: 'trace', path: `${privatePath}/trace.zip`, contentType: 'application/zip' },
        { name: 'screenshot', body: Buffer.from(privatePath), contentType: 'image/png' },
        { name: 'sources', body: Buffer.from(privatePath), contentType: 'text/plain' },
        { name: 'error-context', body: Buffer.from(privatePath), contentType: 'text/markdown' },
        { name: 'bounded-native-capture-events', contentType: 'application/json', body: Buffer.from('{"events":[{"event":"capture-error","ms":1,"unknownViz":true}],"dropped":0}') },
        { name: 'capture-resources-before', contentType: 'application/json', body: Buffer.from('{"/sys/fs/cgroup/memory.current":"1024"}') },
        { name: 'capture-resources-after', contentType: 'application/json', body: Buffer.from('{"/sys/fs/cgroup/memory.current":"2048"}') }
      ]
    }
    const outcome = boundedOutcome({ title: privatePath }, result, 1)
    expect(outcome.status).toBe(status)
    expect(outcome.unknownVizError).toBe(true)
    expect(outcome.telemetry).toHaveLength(3)
    expect(outcome.telemetry[0]).toMatchObject({ data: { dropped: 0, events: [{ event: 'capture-error', ms: 1 }] } })
    expect(outcome.manifestIndex).toBe(0)
    expect(JSON.stringify(outcome)).not.toContain(privatePath)
    expect(JSON.stringify(outcome)).not.toContain('trace.zip')
  })

  it('omits oversized attachments and rejects non-JSON telemetry', () => {
    const outcome = boundedOutcome({ title: 'unknown' }, {
      status: 'failed', retry: 0, duration: 1, errors: [],
      attachments: [
        { name: 'capture-resources-before', contentType: 'application/json', body: Buffer.alloc(256 * 1024 + 1) },
        { name: 'capture-resources-after', contentType: 'text/plain', body: Buffer.from('private-canary') }
      ]
    }, 1)
    expect(outcome.telemetry).toEqual([{ name: 'capture-resources-before', omitted: true }])
  })
})
