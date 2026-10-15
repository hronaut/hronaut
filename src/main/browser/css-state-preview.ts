import type { WebContents } from 'electron'
import {
  CSS_STATE_PREVIEW_CAVEATS,
  CSS_STATE_PREVIEW_LIMITS,
  cssStatePreviewDuration,
  normalizeCssStatePreviewStates,
  type CssStatePreviewEndReason,
  type CssStatePreviewState
} from '../../shared/css-state-preview.js'
import type { BrowserCssStatePreviewReport, BrowserCssStatePreviewSummary } from '../../shared/types.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { isHronautHomeUrl } from './url.js'

interface CssStatePreviewTab {
  id: string
  title: string
  url: string
  navigationGeneration: number
  observationGeneration: number
  webContents: WebContents
}

export interface CssStatePreviewHost<T> {
  isCurrent(tab: T): boolean
  /** Runs in the tab's debugger queue after attaching; rejects while Developer Tools are open. */
  withDebugger<R>(tab: T, operation: () => Promise<R>): Promise<R>
  /** Runs in the tab's debugger queue without attaching, so cleanup still works while Developer Tools open. */
  inDebuggerQueue<R>(tab: T, operation: () => Promise<R>): Promise<R>
  conflict(tab: T): string | undefined
  keepDomEnabled(tab: T): boolean
  changed(): void
}

interface PreviewRecord {
  states: CssStatePreviewState[]
  selector: string
  startedAt: number
  expiresAt: number
  nodeId: number
  webContents: WebContents
  resetUncertain: boolean
  timer?: ReturnType<typeof setTimeout>
  listener: (event: Electron.Event, method: string) => void
  verifying: boolean
}

const SPECIAL_ELEMENTS = new Set(['html', 'head', 'body'])
const UNBOUND_NODE = /could not find node|no node with given id/i
// Disabling the CSS agent resets every forced state it held, so an already disabled agent holds none.
const CSS_AGENT_DISABLED = /css agent was not enabled/i

/**
 * Owns at most one forced :hover/:active preview per tab. The override lives in the CSS agent of
 * Hronaut's own DevTools session: CSS.disable or ending the session drops it. Unbinding DOM nodes
 * (DOM.disable, a new DOM.getDocument) does not, so an unknown node is never proof of a clean reset.
 */
export class BrowserCssStatePreview<T extends CssStatePreviewTab> {
  private readonly records = new Map<T, PreviewRecord>()
  private readonly lastEnded = new Map<T, { reason: CssStatePreviewEndReason; endedAt: string; clean: boolean }>()
  /** Counts end requests, so a start still in flight never outlives a pause, reset or other end. */
  private readonly cancellations = new Map<T, number>()

  constructor(private readonly host: CssStatePreviewHost<T>) {}

  active(tab: T): boolean {
    return this.records.has(tab)
  }

  /** Tab-state projection: what the trusted address bar shows and resets. No node IDs. */
  summary(tab: T): (BrowserCssStatePreviewSummary & { resetUncertain?: boolean }) | undefined {
    const record = this.records.get(tab)
    if (!record) return undefined
    return {
      states: [...record.states],
      selector: record.selector,
      startedAt: new Date(record.startedAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
      ...(record.resetUncertain ? { resetUncertain: true } : {})
    }
  }

  async manage(
    tab: T,
    action: 'set' | 'get' | 'clear',
    options: { selector?: string; states?: readonly string[]; durationMs?: number } = {}
  ): Promise<BrowserCssStatePreviewReport> {
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before previewing CSS states')
    if (action === 'set') await this.set(tab, options)
    else if (action === 'clear') await this.clear(tab, 'cleared')
    else if (action === 'get') await this.verify(tab)
    else throw new Error('Unsupported CSS state preview action')
    return this.report(tab)
  }

  private async set(tab: T, options: { selector?: string; states?: readonly string[]; durationMs?: number }): Promise<void> {
    const selector = options.selector?.trim() ?? ''
    if (!selector || selector.length > CSS_STATE_PREVIEW_LIMITS.maxSelectorChars) {
      throw new Error(`Provide a CSS selector of 1 to ${CSS_STATE_PREVIEW_LIMITS.maxSelectorChars} characters`)
    }
    const states = normalizeCssStatePreviewStates(options.states ?? [])
    const durationMs = cssStatePreviewDuration(options.durationMs)
    const conflict = this.host.conflict(tab)
    if (conflict) throw new Error(conflict)
    const navigationGeneration = tab.navigationGeneration
    const observationGeneration = tab.observationGeneration
    const webContents = tab.webContents
    const cancellation = this.cancellations.get(tab) ?? 0
    // Checked after every command and right before the preview is recorded, so a later pause,
    // reset, navigation or conflicting recording always wins over this start.
    const assertCurrent = (): void => {
      if ((this.cancellations.get(tab) ?? 0) !== cancellation) {
        throw new Error('The CSS state preview was ended while it was starting: the agent was paused, the person reset it or the tab changed. This request forced nothing.')
      }
      if (!this.host.isCurrent(tab)
        || tab.webContents !== webContents
        || webContents.isDestroyed()
        || tab.navigationGeneration !== navigationGeneration
        || tab.observationGeneration !== observationGeneration) {
        throw new Error('The page changed while starting the CSS state preview. Try again on the current page.')
      }
      const blocked = this.host.conflict(tab)
      if (blocked) throw new Error(blocked)
    }
    await this.host.withDebugger(tab, async () => {
      assertCurrent()
      const previous = this.records.get(tab)
      if (previous) await this.removeForcedState(tab, previous, 'replaced')
      if (previous && this.records.get(tab) === previous) {
        throw new Error('The previous CSS state preview could not be removed. Reload the page before starting another.')
      }
      const send = async <R>(method: string, params?: Record<string, unknown>): Promise<R> => {
        const result = await webContents.debugger.sendCommand(method, params) as R
        assertCurrent()
        return result
      }
      let started = false
      try {
        assertCurrent()
        await send('DOM.enable')
        await send('CSS.enable')
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
        try {
          await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states })
        } catch (error) {
          // Never leave a partial override behind when the page changed mid-command.
          await webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => undefined)
          throw error
        }
        const startedAt = Date.now()
        const record: PreviewRecord = {
          states,
          selector,
          startedAt,
          expiresAt: startedAt + durationMs,
          nodeId,
          webContents,
          resetUncertain: false,
          verifying: false,
          listener: (_event, method) => {
            if (method === 'DOM.childNodeRemoved' || method === 'DOM.documentUpdated') this.scheduleVerify(tab, record)
          }
        }
        record.timer = setTimeout(() => { void this.endRecord(tab, record, 'expired').catch(() => undefined) }, durationMs)
        webContents.debugger.on('message', record.listener)
        this.records.set(tab, record)
        this.lastEnded.delete(tab)
        started = true
        this.host.changed()
      } finally {
        // A rejected start must not leave the DOM and CSS domains enabled in this session.
        if (!started && !webContents.isDestroyed() && webContents.debugger.isAttached()) {
          await webContents.debugger.sendCommand('CSS.disable').catch(() => undefined)
          if (!this.host.keepDomEnabled(tab)) await webContents.debugger.sendCommand('DOM.disable').catch(() => undefined)
        }
      }
    })
  }

  /**
   * Ends the preview and any start still in flight for an explicit reason. Safe to call from
   * lifecycle hooks; never throws for a missing preview.
   */
  async clear(tab: T, reason: CssStatePreviewEndReason): Promise<void> {
    this.cancel(tab)
    const record = this.records.get(tab)
    if (record) await this.endRecord(tab, record, reason)
  }

  /** The DevTools session ended, which drops every override it held. */
  debuggerDetached(tab: T): void {
    this.cancel(tab)
    const record = this.records.get(tab)
    if (record) this.end(tab, record, 'debugger-detached', true)
  }

  forget(tab: T): void {
    this.cancel(tab)
    const record = this.records.get(tab)
    if (record) this.end(tab, record, 'tab-closed', true)
    this.lastEnded.delete(tab)
  }

  private cancel(tab: T): void {
    this.cancellations.set(tab, (this.cancellations.get(tab) ?? 0) + 1)
  }

  private async endRecord(tab: T, record: PreviewRecord, reason: CssStatePreviewEndReason): Promise<void> {
    if (record.timer) clearTimeout(record.timer)
    record.timer = undefined
    if (record.webContents.isDestroyed() || !record.webContents.debugger.isAttached()) {
      this.end(tab, record, reason, true)
      return
    }
    await this.host.inDebuggerQueue(tab, () => this.removeForcedState(tab, record, reason))
  }

  private async removeForcedState(tab: T, record: PreviewRecord, reason: CssStatePreviewEndReason): Promise<void> {
    if (this.records.get(tab) !== record) return
    const contents = record.webContents
    if (contents.isDestroyed() || !contents.debugger.isAttached()) {
      this.end(tab, record, reason, true)
      return
    }
    // A bound node with an empty state is clean; an unbound node may still carry the override.
    const targeted = await contents.debugger.sendCommand('CSS.forcePseudoState', { nodeId: record.nodeId, forcedPseudoClasses: [] })
      .then(() => true, () => false)
    // Nothing else keeps the CSS agent enabled while a preview is active, so disabling it is safe
    // and resets every forced state in this session.
    const disabled = await contents.debugger.sendCommand('CSS.disable')
      .then(() => true, (error: unknown) => CSS_AGENT_DISABLED.test(String(error)))
    const detached = contents.isDestroyed() || !contents.debugger.isAttached()
    const clean = targeted || disabled || detached
    if (clean && !detached && !this.host.keepDomEnabled(tab)) await contents.debugger.sendCommand('DOM.disable').catch(() => undefined)
    this.end(tab, record, reason, clean)
  }

  private end(tab: T, record: PreviewRecord, reason: CssStatePreviewEndReason, clean: boolean): void {
    if (this.records.get(tab) !== record) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = undefined
    this.lastEnded.set(tab, { reason, endedAt: new Date().toISOString(), clean })
    if (!clean) {
      // Keep it visible so the status never claims a clean reset; the next clear retries.
      record.resetUncertain = true
      this.host.changed()
      return
    }
    record.webContents.debugger.removeListener('message', record.listener)
    this.records.delete(tab)
    this.host.changed()
  }

  private scheduleVerify(tab: T, record: PreviewRecord): void {
    if (record.verifying) return
    record.verifying = true
    void this.host.inDebuggerQueue(tab, async () => {
      record.verifying = false
      await this.verifyRecord(tab, record)
    }).catch(() => { record.verifying = false })
  }

  private async verify(tab: T): Promise<void> {
    const record = this.records.get(tab)
    if (!record || record.resetUncertain) return
    await this.host.inDebuggerQueue(tab, () => this.verifyRecord(tab, record))
  }

  private async verifyRecord(tab: T, record: PreviewRecord): Promise<void> {
    if (this.records.get(tab) !== record || record.resetUncertain) return
    const contents = record.webContents
    if (contents.isDestroyed() || !contents.debugger.isAttached()) {
      this.end(tab, record, 'debugger-detached', true)
      return
    }
    try {
      await contents.debugger.sendCommand('DOM.describeNode', { nodeId: record.nodeId, depth: 0, pierce: false })
    } catch (error) {
      // Removed from the page or replaced with the document. Still reset the CSS agent before calling it clean.
      if (UNBOUND_NODE.test(String(error))) await this.removeForcedState(tab, record, 'target-removed')
    }
  }

  private report(tab: T): BrowserCssStatePreviewReport {
    const record = this.records.get(tab)
    const lastEnded = this.lastEnded.get(tab)
    return {
      tabId: tab.id,
      title: tab.title,
      url: redactNetworkUrl(tab.url),
      status: !record ? 'inactive' : record.resetUncertain ? 'reset-uncertain' : 'active',
      ...(record ? {
        preview: {
          ...this.summary(tab)!,
          remainingMs: Math.max(0, record.expiresAt - Date.now())
        }
      } : {}),
      ...(lastEnded ? { lastEnded: { ...lastEnded } } : {}),
      limits: {
        states: ['hover', 'active'],
        maxSelectorChars: CSS_STATE_PREVIEW_LIMITS.maxSelectorChars,
        minDurationMs: CSS_STATE_PREVIEW_LIMITS.minDurationMs,
        defaultDurationMs: CSS_STATE_PREVIEW_LIMITS.defaultDurationMs,
        maxDurationMs: CSS_STATE_PREVIEW_LIMITS.maxDurationMs
      },
      caveats: [...CSS_STATE_PREVIEW_CAVEATS]
    }
  }
}
