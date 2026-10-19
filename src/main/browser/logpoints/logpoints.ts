import { randomBytes } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  LOGPOINT_LIMITS,
  LOGPOINT_SCRIPTS_CAVEATS,
  logpointDuration,
  logpointHits,
  type BrowserLogpointSummary,
  type LogpointAction,
  type LogpointEndReason,
  type LogpointProbe,
  type LogpointRecord,
  type LogpointReport,
  type LogpointRequest,
  type LogpointResolvedLocation,
  type LogpointScriptsReport
} from '../../../shared/logpoint.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import {
  documentScripts,
  originalLocation,
  scriptRecord,
  sourceMapBudget,
  type CdpSend,
  type LoadedSourceMap,
  type LogpointScriptRecord
} from './logpoint-sources.js'
import { httpOrigin, pageFrames, pausedInTopFrame, topFrame, type PageFrames } from './logpoint-frames.js'
import { logpointReport, type EndedLogpoints } from './logpoint-report.js'
import { collectScripts, listScripts } from './logpoint-scripts.js'
import { resolveTarget, validRequest } from './logpoint-targets.js'
import { evaluationRecord, failedEvaluationRecord, wrappedExpression, type EvaluationResult } from './logpoint-values.js'

interface LogpointTab {
  id: string
  url: string
  observationGeneration: number
  webContents: WebContents
}

/** The adding call's authority over the tab and its origin, checked again at every hit and while armed. */
export interface LogpointAuthority { assertCurrent(origin: string): void }

export interface LogpointHost<T> {
  isCurrent(tab: T): boolean
  /** Runs in the tab's debugger queue after attaching; rejects while Developer Tools are open. */
  withDebugger<R>(tab: T, operation: () => Promise<R>): Promise<R>
  /** Runs in the tab's debugger queue without attaching, so cleanup still works while Developer Tools open. */
  inDebuggerQueue<R>(tab: T, operation: () => Promise<R>): Promise<R>
  /** Why another use of this debugger session rules logpoints out, if one does. */
  conflict(tab: T): string | undefined
  /** Whether another use, such as code coverage started after a renderer exit, owns the Debugger domain. */
  keepDebuggerEnabled(tab: T): boolean
  isDevToolsOpening(tab: T): boolean
  /** The tab's logpoints were armed, completed or ended, for the address bar. */
  changed(): void
}

interface ArmedProbe {
  id: string
  expression: string
  requested: LogpointProbe['requested']
  resolved: LogpointResolvedLocation
  maxHits: number
  records: LogpointRecord[]
  otherFrameHits: number
  missedHits: number
  state: LogpointProbe['state']
  /** The exact script the breakpoint is pinned to; another bundle at the same address never hits. */
  scriptHash: string
  breakpointId?: string
}

interface ArmedRecord {
  origin: string
  armedAt: number
  expiresAt: number
  webContents: WebContents
  authority: LogpointAuthority
  observationGeneration: number
  /** Marks a string cut inside the page; random for each set and never sent to the page itself. */
  marker: string
  probes: ArmedProbe[]
  /** Scripts of live JavaScript contexts by script ID. */
  scripts: Map<string, LogpointScriptRecord>
  /**
   * Whether each script seen since the top-level page last loaded runs in a page's own JavaScript world.
   * Kept after its context ends: a script shared by frames lives on in the others.
   */
  scriptWorlds: Map<string, boolean>
  mainFrameId?: string
  /** Set while the add is still setting breakpoints: their hits are resumed and counted as missed. */
  adding: boolean
  /** Set once the logpoints ended, and while they are being added; later pauses are only resumed. */
  ending: boolean
  /** The renderer exited: the instrumentation is removed once the page runs in a new renderer. */
  rendererGone: boolean
  /** The renderer exited and no new one has reported yet: commands now fail unsent or wait for the next load. */
  awaitingRenderer: boolean
  /** A removal after a renderer exit is queued or running; cleared when it could not run yet. */
  removing: boolean
  /** The instrumentation removal under way once the logpoints ended, so a remove or read waits for it. */
  settled?: Promise<void>
  timers: Array<ReturnType<typeof setTimeout>>
  detach: () => void
}

interface EndedRecord extends EndedLogpoints {
  observationGeneration: number
}

interface PausedEvent {
  hitBreakpoints?: unknown
  callFrames?: Array<{
    callFrameId?: string
    location?: { scriptId?: string }
    scopeChain?: Array<{ type?: string; object?: { objectId?: string } }>
  }>
}

const CHECK_INTERVAL_MS = 500
/** The asynchronous stack depth Hronaut's debugger lease sets when it attaches. */
const ASYNC_STACK_DEPTH = 8
const OBJECT_GROUP = 'hronaut-logpoint'
/** Scripts remembered while armed; scripts past this cannot be listed or attributed. */
const MAX_TRACKED_SCRIPTS = 10_000

/** Whether the record's page runs in a renderer that has reported since any exit. */
function rendererRunning(record: ArmedRecord): boolean {
  return !record.awaitingRenderer && !record.webContents.isCrashed()
}

/** Every hit of a logpoint, read or not: what maxHits bounds, so a busy loop pauses the page only that often. */
function hitCount(probe: ArmedProbe): number {
  return probe.records.length + probe.otherFrameHits + probe.missedHits
}

function snapshot(probe: ArmedProbe, ended: boolean): LogpointProbe {
  return {
    id: probe.id,
    expression: probe.expression,
    requested: { ...probe.requested },
    resolved: { ...probe.resolved },
    maxHits: probe.maxHits,
    records: [...probe.records],
    otherFrameHits: probe.otherFrameHits,
    missedHits: probe.missedHits,
    state: ended && probe.state !== 'complete' ? 'ended' : probe.state
  }
}

/**
 * Records the value of an expression each time the top-level page's code
 * reaches a chosen location, through breakpoints in Hronaut's own DevTools
 * session. Locations are a script's address and line or a source from its
 * source map, pinned to that exact script. At each hit the page pauses for
 * as long as Chromium takes to read the expression under its side-effect
 * check, and resumes at once. A logpoint stops at its hit limit before the
 * page resumes, and all of a tab's logpoints end together when they expire,
 * the page leaves their origin, the adding call's authority changes, a
 * person stops them, Developer Tools open or the renderer exits. At most one
 * set per tab; a new add replaces it.
 */
export class LogpointSets<T extends LogpointTab> {
  private readonly records = new Map<T, ArmedRecord>()
  private readonly ended = new Map<T, EndedRecord>()
  /** Counts end requests, so an add still in flight never outlives a remove or other end. */
  private readonly cancellations = new WeakMap<T, number>()
  /** Adds in flight, so a remove can wait for a cancelled add to remove what it set. */
  private readonly adds = new Map<T, Promise<void>>()

  constructor(private readonly host: LogpointHost<T>) {}

  /**
   * Whether logpoints hold this tab's debugger session, including a set whose renderer exited and whose
   * removal has not run yet in the new renderer. Nothing runs while the renderer is gone.
   */
  active(tab: T): boolean {
    const record = this.records.get(tab)
    return record !== undefined && (!record.rendererGone || rendererRunning(record))
  }

  summary(tab: T): BrowserLogpointSummary | undefined {
    const record = this.records.get(tab)
    if (!record || record.ending) return undefined
    return { origin: record.origin, probes: record.probes.filter(probe => probe.state !== 'complete').length, expiresAt: new Date(record.expiresAt).toISOString() }
  }

  async manage(
    tab: T,
    action: LogpointAction,
    options: { probes?: LogpointRequest[]; maxHits?: number; durationMs?: number; authority?: LogpointAuthority } = {}
  ): Promise<LogpointReport | LogpointScriptsReport> {
    const authority = options.authority
    if (!authority) throw new Error('Logpoints need the call\'s authority')
    if (action === 'scripts') return this.scripts(tab, authority)
    if (action === 'add') await this.add(tab, options.probes ?? [], options, authority)
    else if (action === 'remove') await this.end(tab, 'removed')
    else if (action === 'get') await this.check(tab)
    else throw new Error('Unsupported logpoint action')
    return this.report(tab, authority)
  }

  /** Ends the tab's logpoints without waiting, for the address bar's stop and for an agent pause or control change. */
  stop(tab: T, reason: 'person-stopped' | 'authority-changed'): void {
    this.cancellations.set(tab, (this.cancellations.get(tab) ?? 0) + 1)
    const record = this.records.get(tab)
    if (record) void this.finish(tab, record, reason).catch(() => undefined)
  }

  forget(tab: T): void {
    this.cancellations.set(tab, (this.cancellations.get(tab) ?? 0) + 1)
    const record = this.records.get(tab)
    if (record) this.release(tab, record, 'tab-closed')
    this.ended.delete(tab)
  }

  /**
   * Ends the logpoints and any add still in flight, and waits until their instrumentation is removed, or
   * until the page runs again after a renderer exit. Never called from inside the debugger queue.
   */
  private async end(tab: T, reason: LogpointEndReason): Promise<void> {
    this.cancellations.set(tab, (this.cancellations.get(tab) ?? 0) + 1)
    await this.addSettled(tab)
    const record = this.records.get(tab)
    if (record) await this.finish(tab, record, reason)
  }

  /**
   * Waits for an add in flight, which stops at its next command once cancelled and removes what it set,
   * or until the renderer exits, when its commands may wait for the next load.
   */
  private async addSettled(tab: T): Promise<void> {
    const pending = this.adds.get(tab)
    const contents = tab.webContents
    if (!pending || contents.isDestroyed() || contents.isCrashed()) return
    let onGone: (() => void) | undefined
    try {
      await Promise.race([
        pending.catch(() => undefined),
        new Promise<void>(resolve => {
          onGone = resolve
          contents.once('render-process-gone', onGone)
          contents.once('destroyed', onGone)
        })
      ])
    } finally {
      contents.removeListener('render-process-gone', onGone!)
      contents.removeListener('destroyed', onGone!)
    }
  }

  /** The page's origin when nothing rules logpoints out, or an error saying what does. */
  private startOrigin(tab: T): string {
    const conflict = this.host.conflict(tab)
    if (conflict) throw new Error(conflict)
    if (tab.webContents.isCrashed() || this.records.get(tab)?.awaitingRenderer) {
      throw new Error('The page stopped because its renderer exited. Reload the tab before using logpoints')
    }
    const origin = httpOrigin(tab.webContents.getURL())
    if (!origin) throw new Error('Open an HTTP(S) page in this tab before using logpoints')
    return origin
  }

  private async scripts(tab: T, authority: LogpointAuthority): Promise<LogpointScriptsReport> {
    const pending = this.records.get(tab)
    if (pending?.ending) await pending.settled
    const origin = this.startOrigin(tab)
    const webContents = tab.webContents
    const observationGeneration = tab.observationGeneration
    const assertCurrent = (): void => {
      if (!this.host.isCurrent(tab) || tab.webContents !== webContents || webContents.isDestroyed() || tab.observationGeneration !== observationGeneration) {
        throw new Error('The page changed while listing its scripts. Try again on the current page.')
      }
      if (this.host.isDevToolsOpening(tab) || webContents.isDevToolsOpened()) throw new Error('Close Developer Tools for this tab before using logpoints')
      authority.assertCurrent(origin)
    }
    return this.host.withDebugger(tab, async () => {
      assertCurrent()
      const send: CdpSend = async <R>(method: string, params?: Record<string, unknown>): Promise<R> => {
        const result = await webContents.debugger.sendCommand(method, params) as R
        assertCurrent()
        return result
      }
      const armed = this.records.get(tab)
      let known: LogpointScriptRecord[]
      let page: PageFrames
      if (armed && !armed.ending) {
        page = await pageFrames(send, origin)
        known = [...armed.scripts.values()]
      } else {
        const conflict = this.host.conflict(tab)
        if (conflict) throw new Error(conflict)
        const collected = await collectScripts(webContents, send, () => pageFrames(send, origin), () => this.host.keepDebuggerEnabled(tab) || this.records.has(tab))
        known = collected.scripts
        page = collected.result
      }
      const listing = await listScripts(send, known, page)
      // A failure while reading maps is reported per script; the call's authority must still hold for the list.
      assertCurrent()
      return { tabId: tab.id, url: redactNetworkUrl(tab.url), ...listing, limits: LOGPOINT_LIMITS, caveats: [...LOGPOINT_SCRIPTS_CAVEATS] }
    })
  }

  private async add(tab: T, requests: LogpointRequest[], options: { maxHits?: number; durationMs?: number }, authority: LogpointAuthority): Promise<void> {
    if (!requests.length || requests.length > LOGPOINT_LIMITS.maxProbes) throw new Error(`Give 1 to ${LOGPOINT_LIMITS.maxProbes} logpoints`)
    const valid = requests.map((request, index) => validRequest(request, `Logpoint ${index + 1}`))
    const maxHits = logpointHits(options.maxHits)
    const durationMs = logpointDuration(options.durationMs)
    const origin = this.startOrigin(tab)
    const observationGeneration = tab.observationGeneration
    const webContents = tab.webContents
    const cancellation = this.cancellations.get(tab) ?? 0
    // Checked after every command and right before the logpoints are armed, so a remove, navigation,
    // control change or conflicting debugger use always wins over this add.
    const assertCurrent = (): void => {
      if ((this.cancellations.get(tab) ?? 0) !== cancellation) throw new Error('The logpoints were removed while they were being added. Nothing is armed.')
      if (!this.host.isCurrent(tab) || tab.webContents !== webContents || webContents.isDestroyed() || tab.observationGeneration !== observationGeneration) {
        throw new Error('The page changed while adding logpoints. Try again on the current page.')
      }
      if (this.host.isDevToolsOpening(tab) || webContents.isDevToolsOpened()) throw new Error('Close Developer Tools for this tab before using logpoints')
      const blocked = this.host.conflict(tab)
      if (blocked) throw new Error(blocked)
      authority.assertCurrent(origin)
    }
    const adding = this.host.withDebugger(tab, async () => {
      assertCurrent()
      const previous = this.records.get(tab)
      if (previous) await this.teardown(tab, previous, 'replaced')
      const send: CdpSend = async <R>(method: string, params?: Record<string, unknown>): Promise<R> => {
        const result = await webContents.debugger.sendCommand(method, params) as R
        assertCurrent()
        return result
      }
      const record: ArmedRecord = {
        origin, armedAt: 0, expiresAt: 0, webContents, authority, observationGeneration, marker: randomBytes(16).toString('hex'),
        probes: [], scripts: new Map(), scriptWorlds: new Map(), adding: true, ending: true,
        rendererGone: false, awaitingRenderer: false, removing: false, timers: [], detach: () => undefined
      }
      // Listen before enabling the Debugger domain: it reports every existing script as it enables.
      this.listen(tab, record)
      let armed = false
      try {
        await send('Debugger.enable')
        await send('Debugger.setPauseOnExceptions', { state: 'none' })
        await send('Debugger.setSkipAllPauses', { skip: false })
        await send('Debugger.setBreakpointsActive', { active: true })
        const page = await pageFrames(send, origin)
        record.mainFrameId = page.mainFrameId
        const scripts = documentScripts(record.scripts.values(), page.frames)
        const maps = new Map<string, LoadedSourceMap>()
        const budget = sourceMapBudget()
        // Every location resolves before any breakpoint is set, so the page pauses for none while maps load.
        const targets = []
        for (const [index, request] of valid.entries()) targets.push(await resolveTarget(send, `Logpoint ${index + 1}`, request, scripts, maps, page.mainFrameId, budget))
        for (const [index, request] of valid.entries()) {
          const label = `Logpoint ${index + 1}`
          const target = targets[index]!
          const probe: ArmedProbe = {
            id: `p${index + 1}`,
            expression: request.expression,
            requested: {
              ...(request.url !== undefined ? { url: request.url } : {}),
              ...(request.source !== undefined ? { source: request.source } : {}),
              line: request.line,
              ...(request.column !== undefined ? { column: request.column } : {})
            },
            resolved: { url: target.script.url!, line: target.line + 1, column: target.column + 1 },
            maxHits,
            records: [],
            otherFrameHits: 0,
            missedHits: 0,
            state: 'armed',
            scriptHash: target.script.hash
          }
          // Kept, with its breakpoint, before anything is checked, so cleanup removes a breakpoint set while the page changed.
          record.probes.push(probe)
          let set: { breakpointId: string; locations: Array<{ lineNumber: number; columnNumber: number }> }
          try {
            set = await webContents.debugger.sendCommand('Debugger.setBreakpointByUrl', {
              scriptHash: target.script.hash, lineNumber: target.line, columnNumber: target.column
            }) as typeof set
          } catch (error) {
            assertCurrent()
            if (/already exists/i.test(String(error))) throw new Error(`${label} is at the same location as another; combine their expressions into one, such as [a, b]`, { cause: error })
            throw error
          }
          probe.breakpointId = set.breakpointId
          assertCurrent()
          const actual = set.locations[0]
          if (!actual) throw new Error(`${label}: no code can pause at that location`)
          const original = target.map ? originalLocation(target.map, actual.lineNumber + 1, actual.columnNumber) : undefined
          probe.resolved = {
            url: target.script.url!,
            line: actual.lineNumber + 1,
            column: actual.columnNumber + 1,
            ...(original ? { original } : {}),
            ...(target.generatedMatches !== undefined ? { generatedMatches: target.generatedMatches } : {})
          }
        }
        // A busy loop may already have used up a logpoint's hits while the others were being set.
        for (const probe of record.probes) {
          if (hitCount(probe) < probe.maxHits) continue
          probe.state = 'complete'
          await send('Debugger.removeBreakpoint', { breakpointId: probe.breakpointId })
        }
        assertCurrent()
        const armedAt = Date.now()
        Object.assign(record, { armedAt, expiresAt: armedAt + durationMs, adding: false, ending: false })
        record.timers.push(setTimeout(() => { void this.finish(tab, record, 'expired').catch(() => undefined) }, durationMs))
        record.timers.push(setInterval(() => {
          if (httpOrigin(record.webContents.isDestroyed() ? '' : record.webContents.getURL()) !== record.origin) void this.finish(tab, record, 'origin-left').catch(() => undefined)
          else if (!this.recordCurrent(tab, record)) void this.finish(tab, record, 'authority-changed').catch(() => undefined)
        }, CHECK_INTERVAL_MS))
        this.records.set(tab, record)
        this.ended.delete(tab)
        armed = true
        this.host.changed()
        // Queued behind this add, which holds the debugger queue.
        if (record.probes.every(probe => probe.state === 'complete')) void this.finish(tab, record, 'complete').catch(() => undefined)
      } finally {
        record.adding = false
        if (!armed) {
          // A rejected add must not leave breakpoints, the Debugger domain or the listeners behind.
          const removed = await this.removeInstrumentation(tab, record)
          if (!removed && (webContents.isCrashed() || record.awaitingRenderer) && !this.records.has(tab)) {
            // The renderer exited while adding: Chromium restores the Debugger domain in the next renderer,
            // so the record keeps its listeners, which resume any pause, until the removal can run there.
            record.rendererGone = true
            this.records.set(tab, record)
          } else {
            record.detach()
          }
        }
      }
    })
    this.adds.set(tab, adding)
    try {
      await adding
    } finally {
      if (this.adds.get(tab) === adding) this.adds.delete(tab)
    }
  }

  /** Whether the adding call's authority and the tab's control still hold for the record. */
  private recordCurrent(tab: T, record: ArmedRecord): boolean {
    if (this.records.get(tab) !== record || !this.host.isCurrent(tab) || tab.webContents !== record.webContents
      || tab.observationGeneration !== record.observationGeneration) return false
    try {
      record.authority.assertCurrent(record.origin)
      return true
    } catch {
      return false
    }
  }

  private listen(tab: T, record: ArmedRecord): void {
    const contents = record.webContents
    const onMessage = (_event: Electron.Event, method: string, params: unknown): void => {
      if (method === 'Debugger.scriptParsed') {
        const script = scriptRecord(params)
        if (script && (record.scriptWorlds.has(script.scriptId) || record.scriptWorlds.size < MAX_TRACKED_SCRIPTS)) {
          record.scriptWorlds.set(script.scriptId, script.isDefault)
        }
        if (script && (record.scripts.has(script.scriptId) || record.scripts.size < MAX_TRACKED_SCRIPTS)) {
          record.scripts.set(script.scriptId, script)
          this.markStale(record, script)
        }
      } else if (method === 'Runtime.executionContextDestroyed') {
        const id = (params as { executionContextId?: unknown }).executionContextId
        for (const [scriptId, script] of record.scripts) if (script.executionContextId === id) record.scripts.delete(scriptId)
      } else if (method === 'Runtime.executionContextsCleared') {
        record.scripts.clear()
        record.scriptWorlds.clear()
      } else if (method === 'Page.frameNavigated') {
        const frame = (params as { frame?: { id?: unknown; parentId?: unknown } }).frame
        if (frame && frame.parentId === undefined && typeof frame.id === 'string') record.mainFrameId = frame.id
      } else if (method === 'Debugger.paused') {
        this.paused(tab, record, params as PausedEvent)
      }
      // Only a renderer sends Debugger events: the restored domain reports the new renderer's scripts.
      if (method.startsWith('Debugger.')) record.awaitingRenderer = false
      if (record.rendererGone) this.removeAfterRendererExit(tab, record)
    }
    const onNavigation = (_event: Electron.Event, url: string, isSameDocument: boolean, isMainFrame: boolean): void => {
      if (!isMainFrame || isSameDocument) return
      if (record.rendererGone) this.removeAfterRendererExit(tab, record)
      // A navigation within the origin keeps the logpoints, which hit again where it runs the same script.
      else if (httpOrigin(url) !== record.origin) void this.finish(tab, record, 'origin-left').catch(() => undefined)
    }
    const onDomReady = (): void => {
      record.awaitingRenderer = false
      if (record.rendererGone) this.removeAfterRendererExit(tab, record)
    }
    const onDevTools = (): void => { void this.finish(tab, record, 'devtools-opened').catch(() => undefined) }
    // Opening Developer Tools detaches Hronaut's debugger before they open.
    const onDetach = (): void => { this.release(tab, record, this.host.isDevToolsOpening(tab) ? 'devtools-opened' : 'debugger-detached') }
    const onRendererGone = (): void => { this.rendererExited(tab, record) }
    const onDestroyed = (): void => { this.forget(tab) }
    contents.debugger.on('message', onMessage)
    contents.debugger.on('detach', onDetach)
    contents.on('did-start-navigation', onNavigation)
    contents.on('did-redirect-navigation', onNavigation)
    contents.on('dom-ready', onDomReady)
    contents.on('devtools-opened', onDevTools)
    contents.on('render-process-gone', onRendererGone)
    contents.once('destroyed', onDestroyed)
    record.detach = () => {
      contents.debugger.removeListener('message', onMessage)
      contents.debugger.removeListener('detach', onDetach)
      contents.removeListener('did-start-navigation', onNavigation)
      contents.removeListener('did-redirect-navigation', onNavigation)
      contents.removeListener('dom-ready', onDomReady)
      contents.removeListener('devtools-opened', onDevTools)
      contents.removeListener('render-process-gone', onRendererGone)
      contents.removeListener('destroyed', onDestroyed)
    }
  }

  /**
   * A logpoint is stale while the top-level document runs a different script at its address and line, such
   * as another build of the bundle, and none of the page's live scripts is the logpoint's own.
   */
  private markStale(record: ArmedRecord, parsed: LogpointScriptRecord): void {
    const affected = record.probes.filter(probe => (probe.state === 'armed' || probe.state === 'stale')
      && (probe.resolved.url === parsed.url || probe.scriptHash === parsed.hash))
    if (!affected.length) return
    const live = [...record.scripts.values()].filter(script => script.isDefault)
    for (const probe of affected) {
      const line = probe.resolved.line - 1
      const pinned = live.some(script => script.hash === probe.scriptHash)
      const replaced = live.some(script => script.url === probe.resolved.url && script.frameId === record.mainFrameId
        && script.hash !== probe.scriptHash && script.startLine <= line && line <= script.endLine)
      probe.state = replaced && !pinned ? 'stale' : 'armed'
    }
  }

  private paused(tab: T, record: ArmedRecord, paused: PausedEvent): void {
    const contents = record.webContents
    if (contents.isDevToolsOpened()) {
      // A pause Developer Tools may own is theirs to resume; ending the logpoints disables this session's debugger.
      void this.finish(tab, record, 'devtools-opened').catch(() => undefined)
      return
    }
    const hitIds = Array.isArray(paused?.hitBreakpoints) ? paused.hitBreakpoints : []
    // A stale logpoint still hits where a frame runs its pinned script.
    const ours = record.probes.filter(probe => (probe.state === 'armed' || probe.state === 'stale')
      && probe.breakpointId !== undefined && hitIds.includes(probe.breakpointId))
    // The add counts these against maxHits before it arms.
    if (record.adding) for (const probe of ours) probe.missedHits += 1
    const hit = record.ending ? [] : ours.filter(probe => hitCount(probe) < probe.maxHits)
    if (!hit.length || this.host.isDevToolsOpening(tab)) {
      // Any other pause, such as a debugger statement, is resumed at once. Sent directly rather than
      // queued: a queued command may be waiting on this very page.
      void contents.debugger.sendCommand('Debugger.resume').catch(() => undefined)
      if (this.host.isDevToolsOpening(tab)) void this.finish(tab, record, 'devtools-opened').catch(() => undefined)
      return
    }
    void this.recordHit(tab, record, hit, paused)
  }

  /**
   * Reads each hit logpoint's expression in the paused frame, then resumes the page whatever happens.
   * Commands go straight to the session: a queued one may be waiting on this very page.
   */
  private async recordHit(tab: T, record: ArmedRecord, probes: ArmedProbe[], paused: PausedEvent): Promise<void> {
    const contents = record.webContents
    const send = <R>(method: string, params?: Record<string, unknown>): Promise<R> => contents.debugger.sendCommand(method, params) as Promise<R>
    let endReason: LogpointEndReason | undefined
    // Every hit is counted once: read, in another frame or world, or missed when it could not be told apart.
    const counted = new Set<ArmedProbe>()
    const count = (kind: 'otherFrameHits' | 'missedHits'): void => {
      for (const probe of probes) if (!counted.has(probe)) probe[kind] += 1
    }
    try {
      const frame = paused.callFrames?.[0]
      const world = record.scriptWorlds.get(frame?.location?.scriptId ?? '')
      const global = frame?.scopeChain?.find(scope => scope.type === 'global')?.object?.objectId
      if (!this.recordCurrent(tab, record)) {
        endReason = 'authority-changed'
        return
      }
      const tree = await topFrame(send).catch(() => undefined)
      if (!tree) {
        count('missedHits')
        return
      }
      if (httpOrigin(tree.frame.url) !== record.origin) {
        endReason = 'origin-left'
        return
      }
      // An isolated world, such as an extension's, is not the page's own code.
      if (world === false) {
        count('otherFrameHits')
        return
      }
      // The same script can run in a frame of the page, even as one shared script, so the paused frame's own
      // window is asked; a script Hronaut did not see parsed cannot be told apart from an isolated world.
      const top = world && frame?.callFrameId ? await pausedInTopFrame(send, global) : undefined
      if (top === undefined || !frame?.callFrameId) {
        count('missedHits')
        return
      }
      if (!top) {
        count('otherFrameHits')
        return
      }
      for (const probe of probes) {
        const at = new Date().toISOString()
        const entry = await send<EvaluationResult>('Debugger.evaluateOnCallFrame', {
          callFrameId: frame.callFrameId,
          expression: wrappedExpression(probe.expression, record.marker),
          objectGroup: OBJECT_GROUP,
          includeCommandLineAPI: false,
          silent: true,
          returnByValue: false,
          generatePreview: true,
          throwOnSideEffect: true,
          timeout: LOGPOINT_LIMITS.evaluationTimeoutMs
        }).then(result => evaluationRecord(result, record.marker, at), (error: unknown) => failedEvaluationRecord(error, at))
        // A record is kept only while the adding call's authority still holds.
        if (record.ending) return
        if (!this.recordCurrent(tab, record)) {
          endReason = 'authority-changed'
          return
        }
        probe.records.push(entry)
        counted.add(probe)
        // A hit in the top-level page shows it runs the logpoint's script again.
        if (probe.state === 'stale') probe.state = 'armed'
      }
    } finally {
      // Removed before the page resumes, so a busy loop cannot hit it again.
      const completed = record.ending || endReason ? [] : probes.filter(probe => probe.state !== 'complete' && hitCount(probe) >= probe.maxHits)
      for (const probe of completed) {
        probe.state = 'complete'
        if (probe.breakpointId) await send('Debugger.removeBreakpoint', { breakpointId: probe.breakpointId }).catch(() => undefined)
      }
      await send('Debugger.resume').catch(() => undefined)
      void send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }).catch(() => undefined)
      if (endReason) void this.finish(tab, record, endReason).catch(() => undefined)
      else if (completed.length && record.probes.every(probe => probe.state === 'complete')) void this.finish(tab, record, 'complete').catch(() => undefined)
      else if (completed.length) this.host.changed()
    }
  }

  /**
   * Ends the logpoints when the page's renderer exits. Commands now fail unsent, and Chromium restores this
   * session's Debugger domain and breakpoints in the next renderer, where they would pause the page. So the
   * record keeps its listeners, which resume any pause, until the removal runs in the new renderer.
   */
  private rendererExited(tab: T, record: ArmedRecord): void {
    // Also for an add in flight, whose cleanup then keeps the record for the new renderer.
    record.awaitingRenderer = true
    if (this.records.get(tab) !== record) return
    record.rendererGone = true
    if (!record.ending) {
      record.ending = true
      this.recordEnd(tab, record, 'renderer-gone')
      this.host.changed()
    }
    for (const timer of record.timers) clearTimeout(timer)
    record.timers = []
  }

  /**
   * Removes the instrumentation once the page runs in a new renderer: tried when it starts loading, when
   * the restored Debugger domain reports, when the document is ready and when the logpoints are read or
   * removed. A try that finds the renderer still gone leaves the record for the next one.
   */
  private removeAfterRendererExit(tab: T, record: ArmedRecord): void {
    if (this.records.get(tab) !== record || record.removing || !rendererRunning(record)) return
    record.removing = true
    record.settled = this.host.inDebuggerQueue(tab, () => this.teardown(tab, record, 'renderer-gone'))
      .catch(() => undefined)
      .finally(() => { record.removing = false })
  }

  private async check(tab: T): Promise<void> {
    const record = this.records.get(tab)
    if (!record) return
    if (record.ending) {
      if (record.rendererGone) this.removeAfterRendererExit(tab, record)
      await record.settled
      return
    }
    if (record.webContents.isDestroyed() || !record.webContents.debugger.isAttached()) this.release(tab, record, 'debugger-detached')
    else if (!this.recordCurrent(tab, record)) await this.finish(tab, record, 'authority-changed')
  }

  /**
   * Ends the record now and removes its instrumentation in the debugger queue. A record that already ended
   * waits for that removal instead. Never called from inside the debugger queue, which would wait on itself.
   */
  private async finish(tab: T, record: ArmedRecord, reason: LogpointEndReason): Promise<void> {
    if (this.records.get(tab) !== record) return
    if (record.ending) {
      if (record.rendererGone) this.removeAfterRendererExit(tab, record)
      await record.settled
      return
    }
    record.ending = true
    this.recordEnd(tab, record, reason)
    this.host.changed()
    const contents = record.webContents
    if (contents.isDestroyed() || !contents.debugger.isAttached()) {
      this.release(tab, record, reason)
      return
    }
    record.settled = this.host.inDebuggerQueue(tab, () => this.teardown(tab, record, reason)).catch(() => undefined)
    await record.settled
  }

  /** Removes the record's instrumentation now; runs inside the debugger queue. */
  private teardown(tab: T, record: ArmedRecord, reason: LogpointEndReason): Promise<void> {
    if (this.records.get(tab) !== record) return Promise.resolve()
    if (!record.ending) {
      record.ending = true
      this.recordEnd(tab, record, reason)
      this.host.changed()
    }
    // Commands to an exited renderer fail unsent or wait for the next load; the record waits for the new renderer.
    if (!rendererRunning(record)) {
      record.rendererGone = true
      return Promise.resolve()
    }
    const removal = this.removeInstrumentation(tab, record).then(removed => {
      // A renderer exit during the removal leaves the Debugger domain for the next renderer to restore.
      if (!removed && !rendererRunning(record)) record.rendererGone = true
      else this.release(tab, record, reason)
    })
    record.settled ??= removal
    return removal
  }

  /**
   * Whether the Debugger domain is off afterwards or owned by another use: disabled, kept for that use, or
   * the session is gone. Other failures are ignored. Nothing more is sent once the renderer exits, because
   * Electron would hold the command until the next load.
   */
  private async removeInstrumentation(tab: T, record: ArmedRecord): Promise<boolean> {
    const contents = record.webContents
    const sessionGone = (): boolean => contents.isDestroyed() || !contents.debugger.isAttached()
    if (sessionGone()) return true
    const send = async (method: string, params?: Record<string, unknown>): Promise<boolean> => {
      if (!rendererRunning(record)) return false
      return contents.debugger.sendCommand(method, params).then(() => true, () => false)
    }
    for (const probe of record.probes) {
      if (probe.breakpointId && probe.state !== 'complete') await send('Debugger.removeBreakpoint', { breakpointId: probe.breakpointId })
    }
    // Code coverage started after a renderer exit owns the restored Debugger domain, and handles its pauses.
    let disabled = this.host.keepDebuggerEnabled(tab)
    if (!disabled) {
      // Disabling the Debugger domain resumes a paused page and removes this session's breakpoints.
      disabled = await send('Debugger.disable') || sessionGone()
      // Disabling the Debugger domain drops async stacks for the whole session; restore the depth the debugger lease sets on attach.
      await send('Runtime.setAsyncCallStackDepth', { maxDepth: ASYNC_STACK_DEPTH })
    }
    return disabled
  }

  private recordEnd(tab: T, record: ArmedRecord, reason: LogpointEndReason): void {
    this.ended.set(tab, {
      origin: record.origin,
      reason,
      endedAt: new Date().toISOString(),
      observationGeneration: record.observationGeneration,
      probes: record.probes.map(probe => snapshot(probe, true))
    })
  }

  /** Forgets the record without commands: its session ended, or the commands already ran. */
  private release(tab: T, record: ArmedRecord, reason: LogpointEndReason): void {
    if (!record.ending) {
      record.ending = true
      this.recordEnd(tab, record, reason)
      this.host.changed()
    }
    for (const timer of record.timers) clearTimeout(timer)
    record.timers = []
    record.detach()
    if (this.records.get(tab) === record) this.records.delete(tab)
  }

  private report(tab: T, authority: LogpointAuthority): LogpointReport {
    const record = this.records.get(tab)
    let ended = this.ended.get(tab)
    // Like console and network results, ended logpoints stay with the workspace control they were set under.
    if (ended && ended.observationGeneration !== tab.observationGeneration) {
      this.ended.delete(tab)
      ended = undefined
    }
    const armed = record && !record.ending ? { ...record, probes: record.probes.map(probe => snapshot(probe, false)) } : undefined
    return logpointReport(tab, armed, ended, authority)
  }
}
