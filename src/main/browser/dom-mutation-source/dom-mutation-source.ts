import type { WebContents } from 'electron'
import {
  DOM_MUTATION_SOURCE_CAVEATS,
  DOM_MUTATION_SOURCE_LIMITS,
  domMutationSourceDuration,
  type DomMutationSourceAction,
  type DomMutationSourceCapture,
  type DomMutationSourceChange,
  type DomMutationSourceEndReason,
  type DomMutationSourceFrame,
  type DomMutationSourceKind,
  type DomMutationSourceReport,
  type DomMutationSourceStatus
} from '../../../shared/dom-mutation-source.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'

interface MutationSourceTab {
  id: string
  url: string
  navigationGeneration: number
  observationGeneration: number
  webContents: WebContents
}

/** The arming call's authority over the tab and its origin, checked again while armed and before a capture is kept. */
export interface DomMutationSourceAuthority { assertCurrent(origin: string): void }

export interface DomMutationSourceHost<T> {
  isCurrent(tab: T): boolean
  /** Runs in the tab's debugger queue after attaching; rejects while Developer Tools are open. */
  withDebugger<R>(tab: T, operation: () => Promise<R>): Promise<R>
  /** Runs in the tab's debugger queue without attaching, so cleanup still works while Developer Tools open. */
  inDebuggerQueue<R>(tab: T, operation: () => Promise<R>): Promise<R>
  /** Why another use of this debugger session rules a capture out, if one does. */
  conflict(tab: T): string | undefined
  keepDomEnabled(tab: T): boolean
  isDevToolsOpening(tab: T): boolean
}

interface ArmedRecord {
  selector: string
  kind: DomMutationSourceKind
  armedAt: number
  expiresAt: number
  nodeId: number
  webContents: WebContents
  origin: string
  authority: DomMutationSourceAuthority
  observationGeneration: number
  /** Script URLs by script ID, already sanitized; undefined for scripts without an HTTP(S) URL. */
  scripts: Map<string, string | undefined>
  /** Set once the capture ended; later pauses are only resumed. */
  ending: boolean
  verifying: boolean
  timers: Array<ReturnType<typeof setTimeout>>
  detach: () => void
}

interface EndedRecord {
  selector: string
  kind: DomMutationSourceKind
  reason: DomMutationSourceEndReason
  endedAt: string
  capture?: DomMutationSourceCapture
}

interface PausedEvent {
  reason?: string
  data?: { type?: string; insertion?: boolean }
  callFrames?: Array<{ functionName?: string; location?: { scriptId?: string; lineNumber?: number; columnNumber?: number } }>
  asyncStackTrace?: AsyncStack
}

interface AsyncStack {
  description?: string
  callFrames?: Array<{ functionName?: string; scriptId?: string; lineNumber?: number; columnNumber?: number }>
  parent?: AsyncStack
}

const SPECIAL_ELEMENTS = new Set(['html', 'head', 'body'])
const UNBOUND_NODE = /could not find node|no node with given id/i
const CHECK_INTERVAL_MS = 500
/** The asynchronous stack depth Hronaut's debugger lease sets when it attaches. */
const ASYNC_STACK_DEPTH = 8
// Control, formatting and line-separator characters, which a function name could use to break or disguise text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g

const STATUS_BY_REASON: Record<DomMutationSourceEndReason, DomMutationSourceStatus> = {
  captured: 'captured',
  expired: 'expired',
  cancelled: 'cancelled',
  replaced: 'cancelled',
  navigation: 'invalidated',
  'target-removed': 'invalidated',
  'authority-changed': 'invalidated',
  'devtools-opened': 'invalidated',
  'debugger-detached': 'invalidated',
  'tab-closed': 'invalidated'
}

function httpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

function bounded(text: string, maxChars: number): string {
  const clean = text.replace(CONTROL_CHARACTERS, '')
  return clean.length > maxChars ? `${clean.slice(0, maxChars - 1)}…` : clean
}

/** An HTTP(S) script URL without credentials, fragment or sensitive query values, or undefined for any other script. */
function scriptUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    const { protocol } = new URL(raw)
    if (protocol !== 'http:' && protocol !== 'https:') return undefined
  } catch {
    return undefined
  }
  const url = redactNetworkUrl(raw)
  return url.length > DOM_MUTATION_SOURCE_LIMITS.maxUrlChars ? undefined : url
}

function frame(
  functionName: unknown,
  scriptId: unknown,
  lineNumber: unknown,
  columnNumber: unknown,
  scripts: ReadonlyMap<string, string | undefined>,
  asyncBoundary?: string
): DomMutationSourceFrame {
  const name = typeof functionName === 'string' && functionName ? bounded(functionName, DOM_MUTATION_SOURCE_LIMITS.maxFunctionNameChars) : '(anonymous)'
  const url = typeof scriptId === 'string' ? scripts.get(scriptId) : undefined
  return {
    functionName: name,
    ...(url ? { url } : {}),
    lineNumber: (typeof lineNumber === 'number' && Number.isInteger(lineNumber) && lineNumber >= 0 ? lineNumber : 0) + 1,
    columnNumber: (typeof columnNumber === 'number' && Number.isInteger(columnNumber) && columnNumber >= 0 ? columnNumber : 0) + 1,
    ...(asyncBoundary !== undefined ? { asyncBoundary } : {})
  }
}

/** The paused stack as bounded frames: names, sanitized URLs and positions only, never scopes, values or source. */
export function mutationSourceFrames(paused: PausedEvent, scripts: ReadonlyMap<string, string | undefined>): { frames: DomMutationSourceFrame[]; framesTruncated: boolean } {
  const frames: DomMutationSourceFrame[] = []
  let total = 0
  for (const callFrame of paused.callFrames ?? []) {
    total += 1
    if (frames.length < DOM_MUTATION_SOURCE_LIMITS.maxFrames) {
      frames.push(frame(callFrame.functionName, callFrame.location?.scriptId, callFrame.location?.lineNumber, callFrame.location?.columnNumber, scripts))
    }
  }
  const seen = new Set<AsyncStack>()
  for (let stack = paused.asyncStackTrace; stack && !seen.has(stack); stack = stack.parent) {
    seen.add(stack)
    const boundary = bounded(typeof stack.description === 'string' && stack.description ? stack.description : 'async', DOM_MUTATION_SOURCE_LIMITS.maxAsyncDescriptionChars)
    let first = true
    for (const callFrame of stack.callFrames ?? []) {
      total += 1
      if (frames.length < DOM_MUTATION_SOURCE_LIMITS.maxFrames) {
        frames.push(frame(callFrame.functionName, callFrame.scriptId, callFrame.lineNumber, callFrame.columnNumber, scripts, first ? boundary : undefined))
      }
      first = false
    }
  }
  return { frames, framesTruncated: total > frames.length }
}

function changeOf(kind: DomMutationSourceKind, data: PausedEvent['data']): DomMutationSourceChange {
  if (kind === 'attribute-modified') return 'attribute'
  if (kind === 'node-removed') return 'node-removed'
  return data?.insertion === true ? 'child-inserted' : 'child-removed'
}

/**
 * Captures the JavaScript stack behind the next change of one kind to one
 * element, through a DOM breakpoint in Hronaut's own DevTools session. At most
 * one capture per tab. Every pause in that session is resumed at once, a
 * capture keeps only the first matching change, and the breakpoint, the
 * Debugger domain and the listeners are removed as soon as it captures,
 * expires, is cancelled or is invalidated. It never moves to a replacement
 * element.
 */
export class DomMutationSourceCaptures<T extends MutationSourceTab> {
  private readonly records = new Map<T, ArmedRecord>()
  private readonly ended = new Map<T, EndedRecord>()
  /** Counts end requests, so an arm still in flight never outlives a cancel or other end. */
  private readonly cancellations = new WeakMap<T, number>()

  constructor(private readonly host: DomMutationSourceHost<T>) {}

  active(tab: T): boolean {
    return this.records.has(tab)
  }

  async manage(
    tab: T,
    action: DomMutationSourceAction,
    options: { selector?: string; kind?: DomMutationSourceKind; durationMs?: number; authority?: DomMutationSourceAuthority } = {}
  ): Promise<DomMutationSourceReport> {
    if (action === 'arm') await this.arm(tab, options)
    else if (action === 'cancel') await this.end(tab, 'cancelled')
    else if (action === 'get') await this.check(tab)
    else throw new Error('Unsupported mutation source action')
    return this.report(tab)
  }

  /** Ends the capture and any arm still in flight. Safe from lifecycle hooks; never throws for a missing capture. */
  async end(tab: T, reason: DomMutationSourceEndReason): Promise<void> {
    this.cancellations.set(tab, (this.cancellations.get(tab) ?? 0) + 1)
    const record = this.records.get(tab)
    if (record) await this.finish(tab, record, reason)
  }

  forget(tab: T): void {
    this.cancellations.set(tab, (this.cancellations.get(tab) ?? 0) + 1)
    const record = this.records.get(tab)
    if (record) this.release(tab, record, 'tab-closed')
    this.ended.delete(tab)
  }

  private async arm(tab: T, options: { selector?: string; kind?: DomMutationSourceKind; durationMs?: number; authority?: DomMutationSourceAuthority }): Promise<void> {
    const selector = options.selector?.trim() ?? ''
    if (!selector || selector.length > DOM_MUTATION_SOURCE_LIMITS.maxSelectorChars) {
      throw new Error(`Provide a CSS selector of 1 to ${DOM_MUTATION_SOURCE_LIMITS.maxSelectorChars} characters`)
    }
    const kind = options.kind
    if (!kind) throw new Error('Choose the change to capture: attribute-modified, subtree-modified or node-removed')
    const authority = options.authority
    if (!authority) throw new Error('A mutation source capture needs the arming call\'s authority')
    const durationMs = domMutationSourceDuration(options.durationMs)
    const conflict = this.host.conflict(tab)
    if (conflict) throw new Error(conflict)
    const origin = httpOrigin(tab.webContents.getURL())
    if (!origin) throw new Error('Open an HTTP(S) page in this tab before capturing a DOM mutation source')
    const navigationGeneration = tab.navigationGeneration
    const observationGeneration = tab.observationGeneration
    const webContents = tab.webContents
    const cancellation = this.cancellations.get(tab) ?? 0
    // Checked after every command and right before the capture is armed, so a cancel, navigation,
    // control change or conflicting debugger use always wins over this arm.
    const assertCurrent = (): void => {
      if ((this.cancellations.get(tab) ?? 0) !== cancellation) {
        throw new Error('The capture was cancelled while it was arming. Nothing is armed.')
      }
      if (!this.host.isCurrent(tab) || tab.webContents !== webContents || webContents.isDestroyed()
        || tab.navigationGeneration !== navigationGeneration || tab.observationGeneration !== observationGeneration) {
        throw new Error('The page changed while arming the capture. Try again on the current page.')
      }
      if (this.host.isDevToolsOpening(tab) || webContents.isDevToolsOpened()) throw new Error('Close Developer Tools for this tab before capturing a DOM mutation source')
      const blocked = this.host.conflict(tab)
      if (blocked) throw new Error(blocked)
      authority.assertCurrent(origin)
    }
    await this.host.withDebugger(tab, async () => {
      assertCurrent()
      const previous = this.records.get(tab)
      if (previous) await this.teardown(tab, previous, 'replaced')
      const send = async <R>(method: string, params?: Record<string, unknown>): Promise<R> => {
        const result = await webContents.debugger.sendCommand(method, params) as R
        assertCurrent()
        return result
      }
      const record: ArmedRecord = {
        selector, kind, armedAt: 0, expiresAt: 0, nodeId: 0, webContents, origin, authority, observationGeneration,
        scripts: new Map(), ending: true, verifying: false, timers: [], detach: () => undefined
      }
      // Listen before enabling the Debugger domain: it reports every existing script as it enables.
      this.listen(tab, record)
      let armed = false
      let breakpointSet = false
      try {
        await send('DOM.enable')
        const document = await send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0, pierce: false })
        let nodeIds: number[]
        try {
          nodeIds = (await send<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector })).nodeIds
        } catch (error) {
          assertCurrent()
          throw new Error('The selector is not valid CSS', { cause: error })
        }
        if (nodeIds.length !== 1) {
          throw new Error(nodeIds.length
            ? 'The selector matches more than one element; use a selector that identifies exactly one element'
            : 'No element in the top-level document matches the selector')
        }
        const nodeId = nodeIds[0]!
        const { node } = await send<{ node: { nodeType: number; localName?: string } }>('DOM.describeNode', { nodeId, depth: 0, pierce: false })
        if (node.nodeType !== 1 || SPECIAL_ELEMENTS.has(node.localName ?? '')) {
          throw new Error('Select one element inside the page, not the html, head or body element')
        }
        await send('Debugger.enable')
        // Asynchronous frames need a stack depth; disabling the Debugger domain elsewhere resets it to 0.
        await send('Runtime.setAsyncCallStackDepth', { maxDepth: ASYNC_STACK_DEPTH })
        await send('Debugger.setPauseOnExceptions', { state: 'none' })
        await send('Debugger.setSkipAllPauses', { skip: false })
        await send('Debugger.setBreakpointsActive', { active: true })
        // Recorded first: the breakpoint may be set even when the page changed before the reply, so cleanup removes it.
        record.nodeId = nodeId
        breakpointSet = true
        await send('DOMDebugger.setDOMBreakpoint', { nodeId, type: kind })
        const armedAt = Date.now()
        Object.assign(record, { armedAt, expiresAt: armedAt + durationMs, ending: false })
        record.timers.push(setTimeout(() => { void this.finish(tab, record, 'expired').catch(() => undefined) }, durationMs))
        const check = setInterval(() => {
          if (!this.recordCurrent(tab, record)) void this.finish(tab, record, 'authority-changed').catch(() => undefined)
        }, CHECK_INTERVAL_MS)
        record.timers.push(check)
        this.records.set(tab, record)
        this.ended.delete(tab)
        armed = true
      } finally {
        if (!armed) {
          // A rejected arm must not leave the breakpoint, the Debugger domain or the listeners behind.
          await this.removeInstrumentation(tab, record, breakpointSet)
          record.detach()
        }
      }
    })
  }

  /** Whether the arming call's authority and the tab's control still hold for the record. */
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
        const script = params as { scriptId?: unknown; url?: unknown }
        if (typeof script.scriptId === 'string' && (record.scripts.has(script.scriptId) || record.scripts.size < DOM_MUTATION_SOURCE_LIMITS.maxScripts)) {
          record.scripts.set(script.scriptId, scriptUrl(script.url))
        }
      } else if (method === 'Debugger.paused') {
        this.paused(tab, record, params as PausedEvent)
      } else if (method === 'DOM.childNodeRemoved' || method === 'DOM.documentUpdated') {
        this.scheduleVerify(tab, record)
      }
    }
    const onNavigation = (_event: Electron.Event, _url: string, isSameDocument: boolean, isMainFrame: boolean): void => {
      if (isMainFrame && !isSameDocument) void this.finish(tab, record, 'navigation').catch(() => undefined)
    }
    const onDevTools = (): void => { void this.finish(tab, record, 'devtools-opened').catch(() => undefined) }
    // Opening Developer Tools detaches Hronaut's debugger before they open.
    const onDetach = (): void => { this.release(tab, record, this.host.isDevToolsOpening(tab) ? 'devtools-opened' : 'debugger-detached') }
    const onDestroyed = (): void => { this.forget(tab) }
    contents.debugger.on('message', onMessage)
    contents.debugger.on('detach', onDetach)
    contents.on('did-start-navigation', onNavigation)
    contents.on('devtools-opened', onDevTools)
    contents.once('destroyed', onDestroyed)
    record.detach = () => {
      contents.debugger.removeListener('message', onMessage)
      contents.debugger.removeListener('detach', onDetach)
      contents.removeListener('did-start-navigation', onNavigation)
      contents.removeListener('devtools-opened', onDevTools)
      contents.removeListener('destroyed', onDestroyed)
    }
  }

  private paused(tab: T, record: ArmedRecord, paused: PausedEvent): void {
    const contents = record.webContents
    if (this.host.isDevToolsOpening(tab) || contents.isDevToolsOpened()) {
      // A pause Developer Tools may own is theirs to resume; ending the capture disables this session's debugger.
      void this.finish(tab, record, 'devtools-opened').catch(() => undefined)
      return
    }
    // Resume before anything else, so no path leaves the page paused. Sent directly rather than queued:
    // a queued command may be waiting on this very page.
    void contents.debugger.sendCommand('Debugger.resume').catch(() => undefined)
    if (record.ending || paused?.reason !== 'DOM') return
    if (!this.recordCurrent(tab, record)) {
      void this.finish(tab, record, 'authority-changed').catch(() => undefined)
      return
    }
    const capture: DomMutationSourceCapture = {
      kind: record.kind,
      change: changeOf(record.kind, paused.data),
      capturedAt: new Date().toISOString(),
      ...mutationSourceFrames(paused, record.scripts)
    }
    void this.finish(tab, record, 'captured', capture).catch(() => undefined)
  }

  private scheduleVerify(tab: T, record: ArmedRecord): void {
    if (record.verifying || record.ending) return
    record.verifying = true
    void this.host.inDebuggerQueue(tab, async () => {
      record.verifying = false
      await this.verifyTarget(tab, record)
    }).catch(() => { record.verifying = false })
  }

  private async check(tab: T): Promise<void> {
    const record = this.records.get(tab)
    if (!record) return
    if (!this.recordCurrent(tab, record)) {
      await this.finish(tab, record, 'authority-changed')
      return
    }
    await this.host.inDebuggerQueue(tab, () => this.verifyTarget(tab, record))
  }

  private async verifyTarget(tab: T, record: ArmedRecord): Promise<void> {
    if (this.records.get(tab) !== record || record.ending) return
    const contents = record.webContents
    if (contents.isDestroyed() || !contents.debugger.isAttached()) {
      this.release(tab, record, 'debugger-detached')
      return
    }
    try {
      await contents.debugger.sendCommand('DOM.describeNode', { nodeId: record.nodeId, depth: 0, pierce: false })
    } catch (error) {
      // Removed from the page, or the document was replaced: never move to a replacement element.
      if (UNBOUND_NODE.test(String(error))) await this.teardown(tab, record, 'target-removed')
    }
  }

  /** Ends the record now and removes its instrumentation in the debugger queue. */
  private async finish(tab: T, record: ArmedRecord, reason: DomMutationSourceEndReason, capture?: DomMutationSourceCapture): Promise<void> {
    if (this.records.get(tab) !== record || record.ending) return
    record.ending = true
    this.recordEnd(tab, record, reason, capture)
    const contents = record.webContents
    if (contents.isDestroyed() || !contents.debugger.isAttached()) {
      this.release(tab, record, reason)
      return
    }
    await this.host.inDebuggerQueue(tab, () => this.teardown(tab, record, reason))
  }

  private async teardown(tab: T, record: ArmedRecord, reason: DomMutationSourceEndReason): Promise<void> {
    if (this.records.get(tab) !== record) return
    if (!record.ending) {
      record.ending = true
      this.recordEnd(tab, record, reason)
    }
    await this.removeInstrumentation(tab, record, true)
    this.release(tab, record, reason)
  }

  private async removeInstrumentation(tab: T, record: ArmedRecord, breakpointSet: boolean): Promise<void> {
    const contents = record.webContents
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return
    const send = (method: string, params?: Record<string, unknown>) => contents.debugger.sendCommand(method, params).then(() => undefined, () => undefined)
    if (breakpointSet && record.nodeId) await send('DOMDebugger.removeDOMBreakpoint', { nodeId: record.nodeId, type: record.kind })
    // Disabling the Debugger domain resumes a paused page and stops every DOM breakpoint from pausing;
    // disabling the DOM domain also clears the breakpoints themselves.
    await send('Debugger.disable')
    // Disabling the Debugger domain drops async stacks for the whole session; restore the depth the debugger lease sets on attach.
    await send('Runtime.setAsyncCallStackDepth', { maxDepth: ASYNC_STACK_DEPTH })
    if (!this.host.keepDomEnabled(tab)) await send('DOM.disable')
  }

  private recordEnd(tab: T, record: ArmedRecord, reason: DomMutationSourceEndReason, capture?: DomMutationSourceCapture): void {
    this.ended.set(tab, { selector: record.selector, kind: record.kind, reason, endedAt: new Date().toISOString(), ...(capture ? { capture } : {}) })
  }

  /** Forgets the record without commands: its session ended, or the commands already ran. */
  private release(tab: T, record: ArmedRecord, reason: DomMutationSourceEndReason): void {
    if (!record.ending) {
      record.ending = true
      this.recordEnd(tab, record, reason)
    }
    for (const timer of record.timers) clearTimeout(timer)
    record.timers = []
    record.detach()
    if (this.records.get(tab) === record) this.records.delete(tab)
  }

  private report(tab: T): DomMutationSourceReport {
    const record = this.records.get(tab)
    const ended = this.ended.get(tab)
    const status: DomMutationSourceStatus = record && !record.ending ? 'armed' : ended ? STATUS_BY_REASON[ended.reason] : 'idle'
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      status,
      ...(record && !record.ending ? {
        armed: {
          selector: record.selector,
          kind: record.kind,
          armedAt: new Date(record.armedAt).toISOString(),
          expiresAt: new Date(record.expiresAt).toISOString(),
          remainingMs: Math.max(0, record.expiresAt - Date.now())
        }
      } : {}),
      ...(status !== 'armed' && ended?.capture ? { capture: ended.capture } : {}),
      ...(status !== 'armed' && ended ? { ended: { selector: ended.selector, kind: ended.kind, reason: ended.reason, endedAt: ended.endedAt } } : {}),
      limits: DOM_MUTATION_SOURCE_LIMITS,
      caveats: [...DOM_MUTATION_SOURCE_CAVEATS]
    }
  }
}
