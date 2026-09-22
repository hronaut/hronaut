import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserContext, TestInfo } from '@playwright/test'

type TraceTarget = { context(): { tracing: Pick<BrowserContext['tracing'], 'start' | 'stop'> } }
type TraceInfo = Pick<TestInfo, 'title' | 'retry' | 'status' | 'expectedStatus' | 'attach'> & {
  project: { use: Pick<TestInfo['project']['use'], 'trace'> }
}

interface Recording {
  path: string
  stopped?: Promise<void>
  saved: boolean
}

export class ElectronTraceRecorder {
  private readonly recordings = new Map<TraceTarget, Recording>()
  private readonly errors: string[] = []
  private directory: Promise<string> | undefined
  private finished = false
  private cleanedUp = false

  constructor(private readonly info: TraceInfo) {}

  private get options() {
    const trace = this.info.project.use.trace ?? 'off'
    return typeof trace === 'string'
      ? { mode: trace === 'retry-with-trace' ? 'on-first-retry' as const : trace, screenshots: true, snapshots: true, sources: true }
      : trace
  }

  private shouldRecord(): boolean {
    const mode = this.options.mode
    if (mode === 'off') return false
    if (mode === 'on-first-retry') return this.info.retry === 1
    if (mode === 'on-all-retries') return this.info.retry > 0
    if (mode === 'retain-on-first-failure') return this.info.retry === 0
    return true
  }

  private shouldKeep(): boolean {
    if (!this.shouldRecord()) return false
    const mode = this.options.mode
    if (mode === 'retain-on-failure' || mode === 'retain-on-first-failure') {
      return this.info.status !== this.info.expectedStatus
    }
    if (mode === 'retain-on-failure-and-retries') {
      return this.info.retry > 0 || this.info.status !== this.info.expectedStatus
    }
    return true
  }

  async start(app: TraceTarget): Promise<void> {
    if (this.finished || !this.shouldRecord() || this.recordings.has(app)) return
    const directory = await (this.directory ??= mkdtemp(join(tmpdir(), 'hronaut-electron-traces-')))
    if (this.finished || this.recordings.has(app)) return
    const recording: Recording = { path: join(directory, `electron-${this.recordings.size + 1}.zip`), saved: false }
    this.recordings.set(app, recording)
    const options = this.options
    try {
      await app.context().tracing.start({
        title: this.info.title,
        screenshots: options.screenshots ?? true,
        snapshots: options.snapshots ?? true,
        sources: options.sources ?? true
      })
    } catch (error) {
      this.recordings.delete(app)
      this.errors.push(`Could not start Electron tracing: ${String(error).slice(0, 500)}`)
    }
  }

  async stop(app: TraceTarget): Promise<void> {
    const recording = this.recordings.get(app)
    if (!recording) return
    // A manually closed instance may precede a later failure or restart. Save
    // now, but decide retention only after the entire test has finished.
    recording.stopped ??= this.stopRecording(app, recording)
    await recording.stopped
  }

  private async stopRecording(app: TraceTarget, recording: Recording): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const exportTrace = Promise.resolve().then(() => app.context().tracing.stop({ path: recording.path })).then(() => {
      recording.saved = true
    }).catch(error => {
      this.errors.push(`Could not finish Electron tracing: ${String(error).slice(0, 500)}`)
    }).finally(async () => {
      clearTimeout(timer)
      // A timed-out export may finish after teardown removed its directory.
      // Remove any late archive instead of leaving it behind in /tmp.
      if (this.cleanedUp && this.directory) await rm(await this.directory, { recursive: true, force: true }).catch(() => undefined)
    })
    await Promise.race([
      exportTrace,
      new Promise<void>(resolve => {
        timer = setTimeout(() => {
          this.errors.push('Electron trace export exceeded the 5 second cleanup deadline')
          resolve()
        }, 5_000)
      })
    ])
  }

  async finish(): Promise<void> {
    if (this.finished) return
    this.finished = true
    try {
      await Promise.all([...this.recordings.keys()].map(app => this.stop(app)))
      if (this.shouldKeep()) {
        for (const recording of this.recordings.values()) {
          if (recording.saved) await this.info.attach('trace', { path: recording.path, contentType: 'application/zip' })
        }
        if (this.errors.length) await this.info.attach('electron-trace-errors', {
          body: JSON.stringify(this.errors.slice(0, 8)), contentType: 'application/json'
        })
      }
    } finally {
      this.recordings.clear()
      this.cleanedUp = true
      if (this.directory) await rm(await this.directory, { recursive: true, force: true })
    }
  }
}
