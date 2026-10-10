import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

const allowedAttachments = new Set([
  'bounded-native-capture-events', 'capture-resources-before', 'capture-resources-after'
])
const maximumAttachmentBytes = 256 * 1024

// Explicit projection: never serialize TestResult, errors, stdout, attachment paths,
// screenshots, traces or Playwright HTML/JSON reports into the exported evidence.
export function boundedOutcome(test: Pick<TestCase, 'title'>, result: Pick<TestResult, 'attachments' | 'status' | 'retry' | 'duration' | 'errors'>, ordinal: number) {
  const telemetry = result.attachments
    .filter(attachment => allowedAttachments.has(attachment.name) && attachment.contentType === 'application/json')
    .slice(0, 3)
    .map(attachment => {
      if (attachment.path && !attachment.body && statSync(attachment.path).size > maximumAttachmentBytes) return { name: attachment.name, omitted: true }
      const body = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : undefined)
      if (!body || body.length > maximumAttachmentBytes) return { name: attachment.name, omitted: true }
      return { name: attachment.name, data: JSON.parse(body.toString('utf8')) as unknown }
    })
  return {
    ordinal,
    // Titles are matched to the checked-in 65-case manifest, never copied verbatim.
    titleMatchesManifest: expectedTitles().includes(test.title),
    manifestIndex: expectedTitles().indexOf(test.title) + 1,
    status: result.status, retry: result.retry, durationMs: result.duration,
    unknownVizError: result.errors.some(error => error.message?.includes('UnknownVizError')),
    telemetry
  }
}

function expectedTitles(): string[] {
  return readFileSync(resolve('scripts/diagnostics/capture-order.txt'), 'utf8').trim().split('\n')
    .map(line => line.split(' › ').slice(2).join(' › '))
}

export default class CaptureOrderReporter implements Reporter {
  private ordinal = 0
  private outcomes: ReturnType<typeof boundedOutcome>[] = []
  private runnerErrors = 0
  private readonly output = resolve('capture-order-evidence/outcomes.json')

  onTestEnd(test: TestCase, result: TestResult): void {
    this.ordinal++
    if (this.outcomes.length < 65) this.outcomes.push(boundedOutcome(test, result, this.ordinal))
    this.save('running')
  }

  onError(): void { this.runnerErrors++; this.save('running') }

  onEnd(result: FullResult): void { this.save(result.status) }

  private save(status: string): void {
    mkdirSync(dirname(this.output), { recursive: true })
    writeFileSync(this.output, JSON.stringify({ status, observedTests: this.ordinal, runnerErrors: this.runnerErrors, outcomes: this.outcomes }))
  }
}
