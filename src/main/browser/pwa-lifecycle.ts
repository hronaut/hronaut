import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  PWA_LIFECYCLE_LIMITS, pwaLifecyclePageScript,
  type PwaLifecycleOptions, type PwaLifecyclePageSnapshot, type PwaLifecycleReport,
  type PwaLifecycleWorker
} from '../../shared/pwa-lifecycle.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { redactDiagnosticText } from '../../shared/debug-report.js'

const WORLD_ID = 1019
interface CaptureTab {
  id: string
  url: string
  mcpGroupId?: string
  sleeping?: boolean
  pageLifecycleState?: string
  navigationGeneration: number
  observationGeneration: number
  webContents: WebContents
}
interface Capture<T> {
  tab: T
  workspaceId?: string
  contents: WebContents
  navigationGeneration: number
  observationGeneration: number
  report: PwaLifecycleReport
  validate: () => void
  busy: boolean
  cleanup: Array<() => void>
}

/** Bounded process-local evidence. Page contexts never own authority or retention. */
export class BrowserPwaLifecycle<T extends CaptureTab> {
  private readonly captures = new Map<string, Capture<T>>()

  constructor(private readonly host: { isCurrent(tab: T): boolean; changed(): void }) {}

  active(tabId: string): boolean {
    return [...this.captures.values()].some(c => c.tab.id === tabId && c.report.active)
  }

  interruptWorkspace(workspaceId: string, reason: string): void {
    for (const capture of this.captures.values()) {
      if (capture.workspaceId === workspaceId) this.finish(capture, reason, true)
    }
  }

  dispose(): void {
    for (const capture of this.captures.values()) this.finish(capture, 'shutdown', true)
    this.captures.clear()
  }

  async manage(tab: T, options: PwaLifecycleOptions, validate: () => void = () => undefined): Promise<PwaLifecycleReport | null> {
    if (options.action !== 'start') {
      const capture = options.captureId
        ? this.captures.get(options.captureId)
        : [...this.captures.values()].reverse().find(c => c.tab.id === tab.id)
      if (!capture) return null
      if (capture.workspaceId !== tab.mcpGroupId) throw new Error('Capture belongs to a different workspace')
      if (options.action === 'stop' || options.action === 'clear') {
        validate()
        this.finish(capture, 'stopped', false)
      }
      if (options.action === 'clear') { this.captures.delete(capture.report.captureId); return null }
      return structuredClone(capture.report)
    }
    const origin = new URL(tab.url)
    if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Open an HTTP or HTTPS page before observing workers')
    validate()
    if (tab.sleeping || (tab.pageLifecycleState && tab.pageLifecycleState !== 'active')) throw new Error('Keep the capture tab awake and unfrozen')
    if (!this.host.isCurrent(tab) || tab.webContents.isDestroyed()) throw new Error('Capture tab is unavailable')
    for (const capture of this.captures.values()) {
      if (capture.tab === tab) this.finish(capture, 'replaced', false)
    }
    if (this.captures.size >= PWA_LIFECYCLE_LIMITS.captures) {
      const oldest = [...this.captures.values()].find(c => !c.report.active)
      if (!oldest) throw new Error('Stop a service-worker capture before starting another')
      this.captures.delete(oldest.report.captureId)
    }
    const capture: Capture<T> = {
      tab, workspaceId: tab.mcpGroupId, contents: tab.webContents,
      navigationGeneration: tab.navigationGeneration, observationGeneration: tab.observationGeneration,
      validate, busy: false, cleanup: [],
      report: {
        captureId: randomUUID(), tabId: tab.id, origin: origin.origin,
        active: true, reason: null, startedAt: Date.now(), stoppedAt: null,
        events: [], truncated: false, missingHistory: true, interrupted: false, lastDrainedAt: null, coverage: 'observed-only',
        caveats: [
          'Observed callback times are not historical lifecycle timestamps. Capture always has incomplete history.',
          'Registration discovery polls once per second; early transitions and short-lived registrations may be missed.',
          'Registrations belong to this top-level origin and workspace, not exclusively to this tab.',
          'Worker identities are local to this capture and distinguish versions at the same script URL.',
          'Navigation, reload, closure, debugger loss or authority loss interrupts capture. Stopping or interruption can omit undrained events.',
          'At most 100 events, 20 registrations, 100 workers and two minutes; five captures retained in memory, oldest stopped first.',
          'URLs exceeding 2048 characters are omitted rather than partially exposing a credential-bearing URL.',
          'Only metadata is observed. No worker updates, messages, activation, cache clearing, permission changes or worker execution requests.',
          'Sleeping or frozen tabs are not awakened. Sleep or freeze interrupts capture instead of keeping the page active.',
          'Reads return the last drained snapshot. No complete-history or universal worker-lifetime guarantee is made.'
        ]
      }
    }
    this.captures.set(capture.report.captureId, capture)
    const contents = capture.contents
    const navigation = (_event: unknown, _url: string, sameDocument: boolean, mainFrame: boolean) => {
      if (mainFrame && !sameDocument) this.finish(capture, 'navigation', true)
    }
    const gone = () => this.finish(capture, 'renderer-unavailable', true)
    const detached = () => this.finish(capture, 'debugger-detached', true)
    contents.on('did-start-navigation', navigation)
    contents.on('destroyed', gone)
    contents.on('render-process-gone', gone)
    contents.debugger.on('detach', detached)
    capture.cleanup.push(() => {
      contents.removeListener('did-start-navigation', navigation)
      contents.removeListener('destroyed', gone)
      contents.removeListener('render-process-gone', gone)
      contents.debugger.removeListener('detach', detached)
    })
    const deadline = setTimeout(() => this.finish(capture, 'duration-limit', false), PWA_LIFECYCLE_LIMITS.durationMs)
    const timer = setInterval(() => { void this.poll(capture) }, 250)
    deadline.unref(); timer.unref()
    capture.cleanup.push(() => { clearTimeout(deadline); clearInterval(timer) })
    this.host.changed()
    capture.busy = true
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const started = this.execute(capture, 'start').then(raw => {
        if (!capture.report.active) { this.stopPage(capture); return null }
        return raw
      })
      const raw = await Promise.race([started, new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 5_000) })])
      if (capture.report.active) {
        this.requireCurrent(capture)
        if (!raw) this.finish(capture, 'initial-read-unavailable', true)
        else this.apply(capture, raw)
      }
    } catch {
      this.finish(capture, 'initial-read-unavailable', true)
    } finally {
      clearTimeout(timeout)
      capture.busy = false
    }
    return structuredClone(capture.report)
  }

  private execute(capture: Capture<T>, action: 'start' | 'get' | 'stop'): Promise<PwaLifecyclePageSnapshot | null> {
    return capture.contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: pwaLifecyclePageScript(action, capture.report.captureId) }], false)
  }

  private requireCurrent(capture: Capture<T>): void {
    capture.validate()
    const tab = capture.tab
    if (tab.sleeping || (tab.pageLifecycleState && tab.pageLifecycleState !== 'active')
      || !this.host.isCurrent(tab) || tab.webContents !== capture.contents || capture.contents.isDestroyed()
      || tab.mcpGroupId !== capture.workspaceId || tab.navigationGeneration !== capture.navigationGeneration
      || tab.observationGeneration !== capture.observationGeneration) throw new Error('Capture context changed')
  }

  private async poll(capture: Capture<T>): Promise<void> {
    if (!capture.report.active) return
    let reading = false
    try {
      // Validate even when a page read is stalled. Authority loss cannot wait for that read.
      this.requireCurrent(capture)
      if (capture.busy) return
      capture.busy = true
      reading = true
      const raw = await this.execute(capture, 'get')
      if (!capture.report.active) return
      this.requireCurrent(capture)
      if (!raw) this.finish(capture, 'page-observer-unavailable', true)
      else this.apply(capture, raw)
    } catch {
      this.finish(capture, 'context-or-authority-lost', true)
    } finally { if (reading) capture.busy = false }
  }

  private apply(capture: Capture<T>, raw: PwaLifecyclePageSnapshot): void {
    const safeUrl = (value: string) => redactNetworkUrl(redactDiagnosticText(value)).slice(0, PWA_LIFECYCLE_LIMITS.urlChars)
    const worker = (value: PwaLifecycleWorker | null | undefined) => value ? {
      id: value.id, scriptUrl: safeUrl(value.scriptUrl), state: String(value.state).slice(0, 32)
    } : null
    capture.report.events = raw.events.slice(0, PWA_LIFECYCLE_LIMITS.events).map(event => ({
      kind: String(event.kind).slice(0, 32), observedAt: event.observedAt,
      ...(event.scope ? { scope: safeUrl(event.scope) } : {}),
      worker: worker(event.worker), controller: worker(event.controller),
      installing: worker(event.installing), waiting: worker(event.waiting), active: worker(event.active)
    }))
    capture.report.lastDrainedAt = Date.now()
    capture.report.truncated = raw.truncated
    if (!raw.active) this.finish(capture, raw.reason ?? 'page-observer-unavailable', raw.reason === 'discovery-unavailable')
  }

  private stopPage(capture: Capture<T>): void {
    try {
      if (!capture.contents.isDestroyed()) void this.execute(capture, 'stop').catch(() => undefined)
    } catch {
      // Electron can lose the execution context before returning a promise.
    }
  }

  private finish(capture: Capture<T>, reason: string, interrupted: boolean): void {
    if (!capture.report.active) return
    capture.report.active = false
    capture.report.reason = reason
    capture.report.interrupted = interrupted
    capture.report.stoppedAt = Date.now()
    for (const cleanup of capture.cleanup.splice(0)) cleanup()
    this.stopPage(capture)
    this.host.changed()
  }
}
