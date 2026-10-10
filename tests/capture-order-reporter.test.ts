import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FullConfig, Suite, TestCase, TestResult } from '@playwright/test/reporter'
import CaptureOrderReporter from '../scripts/diagnostics/capture-order-reporter.js'
import { describe, expect, it } from 'vitest'
import { boundedOutcome, projectProcesses } from '../scripts/diagnostics/capture-order-reporter.js'
import { CaptureRing, projectEvent, projectSnapshot } from '../src/main/capture-order-state.js'
const test = { title: 'unknown', location: { file: '/private/canary.e2e.ts', line: 1, column: 1 } }
const ring = () => new CaptureRing().snapshot()
function outcome(body: string | Buffer, status: 'passed' | 'failed' = 'failed') {
  return boundedOutcome(test, { status, retry: 0, duration: 12,
    errors: [{ message: 'UnknownVizError /private/canary', stack: '/private/canary' }],
    attachments: [
      { name: 'trace', path: '/private/trace.zip', contentType: 'application/zip' },
      { name: 'bounded-native-capture-events', body: Buffer.from(body), contentType: 'application/json' }
    ] }, 1)
}
describe('diagnostic closed-schema projection', () => {
  it.each(['passed', 'failed'] as const)('retains safe %s telemetry and drops unrelated data', status => {
    const result = outcome(JSON.stringify({ processes: [{ data: ring() }], omittedProcesses: 0 }), status)
    expect(result.telemetry?.processes).toHaveLength(1)
    expect(result.unknownVizError).toBe(true)
    expect(result.manifestIndex).toBe(0)
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it.each(['not-json', '{"url":"private"}', JSON.stringify({ processes: [{ data: { ...ring(), path: 'private' } }], omittedProcesses: 0 })])('rejects malformed or unexpected payload', body => {
    expect(outcome(body)).toMatchObject({ telemetryOmitted: true })
    expect(outcome(body).telemetry).toBeUndefined()
  })
  it('rejects oversized, nonfinite, object-enum and arbitrary event fields', () => {
    expect(outcome(Buffer.alloc(1024 * 1024 + 1)).telemetryOmitted).toBe(true)
    expect(projectEvent({ event: 'created', ms: Infinity })).toBeUndefined()
    expect(projectEvent({ event: 'created', ms: 0, url: 'private' })).toBeUndefined()
    expect(projectEvent({ event: 'capture-start', ms: 0, owner: { toString: () => 'foreground' } })).toBeUndefined()
    expect(projectProcesses({ processes: Array.from({ length: 5 }, () => ({ missing: true })), omittedProcesses: 0 })).toBeUndefined()
    expect(projectSnapshot({ ...ring(), events: Array(641).fill({ event: 'created', ms: 0 }) })).toBeUndefined()
  })
  it('exports omission markers and explicit shutdown coverage without strings', () => {
    const data = projectProcesses({ processes: [{ missing: true }, { omitted: true }, { data: ring() }], omittedProcesses: 2 })
    expect(data?.omittedProcesses).toBe(2)
    expect(data?.processes[2]?.data?.willQuit).toBe(false)
  })
})
describe('bounded failure ring', () => {
  it('retains recent prehistory, freezes first failure and caps posthistory', () => {
    const state = new CaptureRing()
    for (let ms = 0; ms < 600; ms++) state.record({ event: 'created', ms })
    state.record({ event: 'capture-error', ms: 600, unknownViz: true })
    for (let ms = 601; ms < 901; ms++) state.record({ event: 'created', ms })
    state.record({ event: 'will-quit', ms: 901 })
    expect(state.events).toHaveLength(640)
    expect(state.events.some(event => event.event === 'capture-error')).toBe(true)
    expect(state.evicted).toBe(89)
    expect(state.dropped).toBe(173)
    expect(state.snapshot().willQuit).toBe(true)
    expect(projectSnapshot(state.snapshot())).toEqual(state.snapshot())
  })
})

it('retains every original test attempt and retry outcome independently of the detail budget', () => {
  const directory = mkdtempSync(join(tmpdir(), 'capture-reporter-'))
  try {
    const output = join(directory, 'outcomes.json')
    const reporter = new CaptureOrderReporter(output)
    const tests = readFileSync('scripts/diagnostics/capture-order.txt', 'utf8').trim().split('\n').map(row => {
      const [, file, ...title] = row.split(' › ')
      return { title: title.join(' › '), location: { file, line: 1, column: 1 } } as TestCase
    })
    reporter.onBegin({} as FullConfig, { allTests: () => tests } as Suite)
    for (const entry of tests) {
      for (const retry of [0, 1]) reporter.onTestEnd(entry, { status: retry ? 'passed' : 'failed', retry,
        duration: 1, errors: [], attachments: [{ name: 'bounded-native-capture-events', contentType: 'application/json',
          body: Buffer.from(JSON.stringify({ processes: [{ data: ring() }], omittedProcesses: 0 })) }] } as unknown as TestResult)
    }
    reporter.onEnd({ status: 'failed', startTime: new Date(), duration: 1 })
    const result = JSON.parse(readFileSync(output, 'utf8'))
    expect(result.planned).toEqual(Array.from({ length: 133 }, (_, i) => i + 1))
    expect(result.outcomes).toHaveLength(266)
    expect(result.outcomes.filter((row: { retry: number }) => row.retry === 1)).toHaveLength(133)
    expect(result.outcomes.filter((row: { telemetry?: unknown }) => row.telemetry)).toHaveLength(8)
    expect(result.omittedOutcomes).toBe(0)
    expect(result.status).toBe('failed')
  } finally { rmSync(directory, { recursive: true }) }
})
