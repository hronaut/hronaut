import type { BrowserContext, ElectronApplication, Page, Request, Response, TestInfo } from '@playwright/test'

type Operation = 'healthz' | 'mcp' | 'main'
type Label = 'connect' | 'open' | 'wait' | 'select' | 'state' | 'failure-probe' | 'workspace' | 'snapshot'
type Outcome = 'pending' | 'completed' | 'rejected' | 'returned-ok' | 'returned-error' | 'ok' | 'unauthorized' | 'forbidden' | 'rate-limited' | 'server-error' | 'other-http' | 'network-error' | 'deadline-exceeded'
type Navigation = 'request' | 'http-ok' | 'http-error' | 'finished' | 'failed' | 'commit' | 'dom-ready' | 'load' | 'close' | 'crash'
interface RecordEntry {
  kind: Operation | 'navigation'
  label: Label | 'target'
  at: number
  outcome: Outcome | Navigation
  elapsed?: number
}
type AttachmentInfo = Pick<TestInfo, 'status' | 'expectedStatus' | 'attach'>
const recorders = new WeakMap<object, ActivityFailureDiagnostics>()
const MAX_RECORDS = 64
const MAX_BYTES = 8192

export class ActivityFailureDiagnostics {
  private readonly started: number
  private readonly records: RecordEntry[] = []
  private readonly cleanup: Array<() => void> = []
  private closed = false
  private watching = false
  private finalBody: string | undefined
  private dropped = 0
  private cleanupFailures = 0

  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = now()
  }

  private time(): number {
    return Math.max(0, Math.min(600_000, Math.floor(this.now() - this.started))) || 0
  }

  private add(record: RecordEntry): RecordEntry | undefined {
    if (this.closed) return undefined
    if (this.records.length >= MAX_RECORDS) {
      this.dropped = Math.min(65535, this.dropped + 1)
      return undefined
    }
    this.records.push(record)
    return record
  }

  private observe<T>(kind: Operation, label: Label, operation: () => Promise<T>, classify: (value: T) => Outcome): Promise<T> {
    const record = this.add({ kind, label, at: this.time(), outcome: 'pending' })
    const settle = (outcome: Outcome) => {
      if (!this.closed && record) { record.outcome = outcome; record.elapsed = this.time() - record.at }
    }
    let pending: Promise<T>
    try { pending = operation() } catch (error) { settle('rejected'); throw error }
    // Observe without replacing the original promise, value or rejection. The
    // observer itself never creates an unhandled rejection or retains payloads.
    void pending.then(value => {
      try { settle(classify(value)) } catch { settle('rejected') }
    }, () => settle(kind === 'healthz' ? 'network-error' : 'rejected')).catch(() => undefined)
    return pending
  }

  health<T extends { status: number }>(operation: () => Promise<T>): Promise<T> {
    return this.observe('healthz', 'connect', operation, ({ status }) => status >= 200 && status < 300 ? 'ok'
      : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 ? 'rate-limited'
        : status >= 500 && status < 600 ? 'server-error' : 'other-http')
  }

  mcp<T>(label: 'connect' | 'open' | 'wait' | 'select' | 'workspace' | 'snapshot', operation: () => Promise<T>): Promise<T> {
    return this.observe('mcp', label, operation, value => value && typeof value === 'object' && 'isError' in value && value.isError === true ? 'returned-error' : 'returned-ok')
  }

  main<T>(operation: () => Promise<T>, label: 'state' | 'failure-probe' = 'state'): Promise<T> {
    return this.observe('main', label, operation, value => label === 'failure-probe' && value && typeof value === 'object' && 'unavailable' in value
      ? value.unavailable === 'Main process did not respond to diagnostics within 1000ms' ? 'deadline-exceeded' : 'rejected'
      : 'completed')
  }

  watchNavigation(context: BrowserContext, fixtureUrl: string): void {
    if (this.closed || this.watching) return
    this.watching = true
    const requests = new WeakSet<Request>()
    const pages = new WeakSet<Page>()
    let pageCount = 0
    const record = (outcome: Navigation) => { this.add({ kind: 'navigation', label: 'target', at: this.time(), outcome }) }
    const request = (request: Request) => {
      if (this.closed) return
      try {
        if (!request.isNavigationRequest() || request.url() !== fixtureUrl || request.frame().parentFrame()) return
        requests.add(request)
        record('request')
        const page = request.frame().page()
        if (pages.has(page) || pageCount >= 4) return
        pages.add(page)
        pageCount++
        const committed = (frame: ReturnType<Page['mainFrame']>) => {
          try { if (frame === page.mainFrame() && frame.url() === fixtureUrl) record('commit') } catch { /* Closed frame. */ }
        }
        page.on('framenavigated', committed)
        this.cleanup.push(() => page.off('framenavigated', committed))
        const domReady = () => { try { if (page.url() === fixtureUrl) record('dom-ready') } catch { /* Closed page. */ } }
        const loaded = () => { try { if (page.url() === fixtureUrl) record('load') } catch { /* Closed page. */ } }
        const closed = () => record('close')
        const crashed = () => record('crash')
        page.on('domcontentloaded', domReady)
        this.cleanup.push(() => page.off('domcontentloaded', domReady))
        page.on('load', loaded)
        this.cleanup.push(() => page.off('load', loaded))
        page.on('close', closed)
        this.cleanup.push(() => page.off('close', closed))
        page.on('crash', crashed)
        this.cleanup.push(() => page.off('crash', crashed))
      } catch { /* Metadata may disappear with a closed page; never affect the test. */ }
    }
    const response = (response: Response) => {
      try { if (requests.has(response.request())) record(response.status() < 400 ? 'http-ok' : 'http-error') } catch { /* Closed response. */ }
    }
    const finished = (request: Request) => { if (requests.has(request)) record('finished') }
    const failed = (request: Request) => { if (requests.has(request)) record('failed') }
    try {
      context.on('request', request)
      this.cleanup.push(() => context.off('request', request))
      context.on('response', response)
      this.cleanup.push(() => context.off('response', response))
      context.on('requestfinished', finished)
      this.cleanup.push(() => context.off('requestfinished', finished))
      context.on('requestfailed', failed)
      this.cleanup.push(() => context.off('requestfailed', failed))
    } catch { this.cleanupFailures++ }
  }

  finish(): string {
    if (this.finalBody !== undefined) return this.finalBody
    this.closed = true
    for (const cleanup of this.cleanup.splice(0)) {
      try { cleanup() } catch { this.cleanupFailures++ }
    }
    const records = this.records.map(record => ({ ...record, ...(record.outcome === 'pending' ? { elapsed: this.time() - record.at } : {}) }))
    const encode = () => JSON.stringify({ version: 1, records, dropped: this.dropped, cleanupFailures: this.cleanupFailures })
    while (Buffer.byteLength(encode(), 'utf8') > MAX_BYTES && records.length) { records.pop(); this.dropped = Math.min(65535, this.dropped + 1) }
    this.finalBody = encode()
    return this.finalBody
  }
}

export function enableActivityDiagnostics(app: ElectronApplication): ActivityFailureDiagnostics {
  const existing = recorders.get(app)
  if (existing) return existing
  const recorder = new ActivityFailureDiagnostics()
  recorders.set(app, recorder)
  return recorder
}

export function activityDiagnostics(app: ElectronApplication): ActivityFailureDiagnostics | undefined {
  return recorders.get(app)
}

export async function attachActivityDiagnostics(app: ElectronApplication, info: AttachmentInfo): Promise<void> {
  const recorder = recorders.get(app)
  recorders.delete(app)
  if (!recorder) return
  try {
    const body = recorder.finish()
    if (info.status !== info.expectedStatus) await info.attach('activity-failure-diagnostics', { body, contentType: 'application/json' })
  } catch { /* Best effort: preserve the original test error. */ }
}
