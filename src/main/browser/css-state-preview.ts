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
  observationGeneration: number
  resetUncertain: boolean
  timer?: ReturnType<typeof setTimeout>
  listener: (event: Electron.Event, method: string) => void
  verifying: boolean
}

const SPECIAL_ELEMENTS = new Set(['html', 'head', 'body'])
const UNBOUND_NODE = /could not find node|no node with given id/i

/**
 * Owns at most one forced :hover/:active preview per tab. The override lives in Hronaut's own
 * DevTools session, so ending the session, unbinding the node or replacing the document drops it.
 */
export class BrowserCssStatePreview<T extends CssStatePreviewTab> {
  private readonly records = new Map<T, PreviewRecord>()
  private readonly lastEnded = new Map<T, { reason: CssStatePreviewEndReason; endedAt: string; clean: boolean }>()

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
    const assertCurrent = (): void => {
      if (!this.host.isCurrent(tab)
        || tab.webContents !== webContents
        || webContents.isDestroyed()
        || tab.navigationGeneration !== navigationGeneration
        || tab.observationGeneration !== observationGeneration) {
        throw new Error('The page changed while starting the CSS state preview. Try again on the current page.')
      }
    }
    await this.host.withDebugger(tab, async () => {
      assertCurrent()
      const blocked = this.host.conflict(tab)
      if (blocked) throw new Error(blocked)
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
          observationGeneration,
          resetUncertain: false,
          verifying: false,
          listener: (_event, method) => {
            if (method === 'DOM.childNodeRemoved' || method === 'DOM.documentUpdated') this.scheduleVerify(tab, record)
          }
        }
        record.timer = setTimeout(() => { void this.clear(tab, 'expired').catch(() => undefined) }, durationMs)
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

  /** Removes the override for an explicit reason. Safe to call from lifecycle hooks; never throws for a missing preview. */
  async clear(tab: T, reason: CssStatePreviewEndReason): Promise<void> {
    const record = this.records.get(tab)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = undefined
    if (record.webContents.isDestroyed() || !record.webContents.debugger.isAttached()) {
      this.end(tab, record, reason, true)
      return
    }
    await this.host.inDebuggerQueue(tab, () => this.removeForcedState(tab, record, reason))
  }

  /** The DevTools session ended, which drops every override it held. */
  debuggerDetached(tab: T): void {
    const record = this.records.get(tab)
    if (record) this.end(tab, record, 'debugger-detached', true)
  }

  forget(tab: T): void {
    const record = this.records.get(tab)
    if (record) this.end(tab, record, 'tab-closed', true)
    this.lastEnded.delete(tab)
  }

  private async removeForcedState(tab: T, record: PreviewRecord, reason: CssStatePreviewEndReason): Promise<void> {
    if (this.records.get(tab) !== record) return
    const contents = record.webContents
    if (contents.isDestroyed() || !contents.debugger.isAttached()) {
      this.end(tab, record, reason, true)
      return
    }
    let clean = false
    try {
      await contents.debugger.sendCommand('CSS.forcePseudoState', { nodeId: record.nodeId, forcedPseudoClasses: [] })
      clean = true
    } catch (error) {
      // Chromium drops an override when it unbinds the node, so an unknown node is already clean.
      if (UNBOUND_NODE.test(String(error))) clean = true
    }
    if (!clean && !this.host.keepDomEnabled(tab)) {
      // Disabling the DOM domain unbinds every node in this session and drops every override.
      clean = await contents.debugger.sendCommand('DOM.disable').then(() => true, () => false)
    }
    if (clean && !contents.isDestroyed() && contents.debugger.isAttached()) {
      await contents.debugger.sendCommand('CSS.disable').catch(() => undefined)
      if (!this.host.keepDomEnabled(tab)) await contents.debugger.sendCommand('DOM.disable').catch(() => undefined)
    }
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
      if (UNBOUND_NODE.test(String(error))) {
        if (record.timer) clearTimeout(record.timer)
        this.end(tab, record, 'target-removed', true)
      }
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
