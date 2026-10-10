import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'
import { projectSnapshot } from '../../src/main/capture-order-state.js'
const maximumAttachmentBytes = 1024 * 1024
const maximumAttempts = 266 // 133 original cases, normal one retry.
function expectedTitles(): string[] {
  return readFileSync(resolve('scripts/diagnostics/capture-order.txt'), 'utf8').trim().split('\n')
    .map(line => line.split(' › ').slice(1).join(' › '))
}
function manifestIndex(test: Pick<TestCase, 'title' | 'location'>): number {
  return expectedTitles().indexOf(`${basename(test.location.file)} › ${test.title}`) + 1
}
export function projectProcesses(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'omittedProcesses,processes' || !Array.isArray(row.processes) || row.processes.length > 4) return
  if (!Number.isSafeInteger(row.omittedProcesses) || (row.omittedProcesses as number) < 0) return
  const processes = []
  for (const item of row.processes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return
    const keys = Object.keys(item)
    if (keys.length !== 1) return
    if (keys[0] === 'missing' && item.missing === true) { processes.push({ missing: true }); continue }
    if (keys[0] === 'omitted' && item.omitted === true) { processes.push({ omitted: true }); continue }
    if (keys[0] !== 'data') return
    const data = projectSnapshot(item.data)
    if (!data) return
    processes.push({ data })
  }
  return { processes, omittedProcesses: row.omittedProcesses as number }
}
// Never export TestResult, arbitrary attachments, errors, stdout, titles, paths or traces.
export function boundedOutcome(test: Pick<TestCase, 'title' | 'location'>, result: Pick<TestResult, 'attachments' | 'status' | 'retry' | 'duration' | 'errors'>, ordinal: number, retainTelemetry = true) {
  const attachment = result.attachments.find(item => item.name === 'bounded-native-capture-events' && item.contentType === 'application/json')
  let telemetry: ReturnType<typeof projectProcesses>
  let telemetryOmitted = Boolean(attachment && !retainTelemetry)
  if (attachment && retainTelemetry) {
    try {
      if (attachment.path && !attachment.body && statSync(attachment.path).size > maximumAttachmentBytes) throw new Error('oversize')
      const body = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : undefined)
      if (!body || body.length > maximumAttachmentBytes) throw new Error('oversize')
      telemetry = projectProcesses(JSON.parse(body.toString('utf8')))
      if (!telemetry) telemetryOmitted = true
    } catch { telemetryOmitted = true }
  }
  return { ordinal, manifestIndex: manifestIndex(test), status: result.status,
    retry: result.retry, durationMs: result.duration,
    unknownVizError: result.errors.some(error => error.message?.includes('UnknownVizError')),
    telemetryMissing: !attachment, telemetryOmitted, ...(telemetry ? { telemetry } : {}) }
}
export default class CaptureOrderReporter implements Reporter {
  private ordinal = 0
  private outcomes: ReturnType<typeof boundedOutcome>[] = []
  private runnerErrors = 0
  private omittedOutcomes = 0
  private detailCount = 0
  private planned: number[] = []
  constructor(private readonly output = resolve('capture-order-evidence/outcomes.json')) {}
  onBegin(_config: FullConfig, suite: Suite): void {
    this.planned = suite.allTests().map(manifestIndex)
    this.save('running')
  }
  onTestEnd(test: TestCase, result: TestResult): void {
    this.ordinal++
    const index = manifestIndex(test)
    const detailed = this.detailCount < 8 && (result.status !== 'passed' || (index >= 63 && index <= 65))
    if (detailed) this.detailCount++
    if (this.outcomes.length < maximumAttempts) this.outcomes.push(boundedOutcome(test, result, this.ordinal, detailed))
    else this.omittedOutcomes++
    this.save('running')
  }
  onError(): void { this.runnerErrors++; this.save('running') }
  onEnd(result: FullResult): void { this.save(result.status) }
  private save(status: string): void {
    mkdirSync(dirname(this.output), { recursive: true })
    writeFileSync(this.output, JSON.stringify({ status, planned: this.planned, observedTests: this.ordinal,
      runnerErrors: this.runnerErrors, omittedOutcomes: this.omittedOutcomes, outcomes: this.outcomes }))
  }
}
