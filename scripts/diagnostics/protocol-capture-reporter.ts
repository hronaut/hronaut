import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

// Replaces console/HTML reporters only in the disposable diagnostic invocation.
// Raw stdout/stderr are also discarded by its parent, including renderer errors.
export default class ProtocolCaptureReporter implements Reporter {
  private attempts: number[][] = []
  private invalid = false
  private flaky = 0
  onTestEnd(test: TestCase, result: TestResult): void {
    const status = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].indexOf(result.status) + 1
    if (!status || this.attempts.length >= 2 || result.retry !== this.attempts.length) this.invalid = true
    else this.attempts.push([result.retry, status])
    if (test.outcome() === 'flaky') this.flaky = 1
  }
  onEnd(result: FullResult): void {
    const status = ['passed', 'failed', 'timedout', 'interrupted'].indexOf(result.status) + 1
    try {
      writeFileSync(join(process.cwd(), 'diagnostic-output/verdict.json'), JSON.stringify({ status: this.invalid ? 0 : status, flaky: this.flaky, attempts: this.attempts }), { flag: 'wx', mode: 0o600 })
    } catch { /* Missing verdict is unknown, never a passing test. */ }
  }
  printsToStdio(): boolean { return false }
}
