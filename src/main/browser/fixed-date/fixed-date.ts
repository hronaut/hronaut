import type { WebContents } from 'electron'
import type { FixedDateBootstrap, FixedDateDisarmReason, FixedDateDocumentState, FixedDateResult } from '../../../shared/fixed-date.js'

/**
 * The staging call's authority for an origin, checked again before every
 * installation into a new document and on status, without renewing the
 * agent's write ownership.
 */
export interface FixedDateAuthority { assertCurrent(origin: string): void }

/** One tab as fixed Date staging sees it. */
export interface FixedDateTarget {
  identity: object
  page: WebContents
  url: string
  workspaceId: string | undefined
  workspaceIdentity: object | undefined
}

interface Host {
  resolve(tabId: string): FixedDateTarget
  /** The tab whose page this is, if any. */
  tabIdOf(page: WebContents): string | undefined
}

interface Setting {
  epochMs: number
  origin: string
  target: FixedDateTarget
  authority: FixedDateAuthority
}

interface Disarmed { epochMs: number; origin: string; reason: FixedDateDisarmReason }

interface DocumentRecord { state: FixedDateDocumentState; epochMs?: number }

const iso = (epochMs: number): string => new Date(epochMs).toISOString()

function httpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * Owns the fixed Date an agent staged for one tab: at most one instant per tab,
 * bound to the tab's top-level origin, its workspace and the staging call's
 * authority, and kept in memory only. The page preload asks for it before page
 * scripts run in each new top-level document; embedded frames never ask and are
 * never answered. A document of another origin, a changed authority or a tab
 * that left its workspace disarms the setting instead of installing it.
 * Staging and reset never reload: they apply from the next document.
 */
export class FixedDateController {
  private readonly settings = new Map<string, Setting>()
  private readonly disarmed = new Map<string, Disarmed>()
  private readonly documents = new Map<string, DocumentRecord>()
  private readonly observed = new WeakSet<WebContents>()
  private disposed = false
  constructor(private readonly host: Host) {}

  /** Answers the page preload of a new top-level document in a tab. */
  bootstrap(page: WebContents, frameOrigin: string): FixedDateBootstrap {
    const tabId = this.host.tabIdOf(page)
    if (!tabId || this.disposed) return { enabled: false }
    const setting = this.settings.get(tabId)
    // Tabs that never had a fixed Date are not tracked.
    if (!setting && !this.documents.has(tabId)) return { enabled: false }
    this.observe(tabId, page)
    const reason = setting ? this.disarmReason(tabId, setting, page, frameOrigin) : undefined
    if (!setting || reason) {
      if (setting && reason) this.disarm(tabId, setting, reason)
      this.documents.set(tabId, { state: 'native' })
      return { enabled: false }
    }
    this.documents.set(tabId, { state: 'fixed', epochMs: setting.epochMs })
    return { enabled: true, epochMs: setting.epochMs }
  }

  /** Stages one instant for the tab's current HTTP(S) origin, replacing any earlier one; applies from the next document. */
  stage(tabId: string, epochMs: number, authority: FixedDateAuthority): FixedDateResult {
    const target = { ...this.host.resolve(tabId) }
    const origin = httpOrigin(target.url)
    if (!origin) throw new Error('Open an HTTP(S) page in this tab before staging a fixed Date; it applies to that origin only.')
    authority.assertCurrent(origin)
    this.observe(tabId, target.page)
    this.disarmed.delete(tabId)
    this.settings.set(tabId, { epochMs, origin, target, authority })
    return this.status(tabId)
  }

  /** Removes the staged instant; a document that already has it keeps it until it reloads. */
  reset(tabId: string): FixedDateResult {
    this.host.resolve(tabId)
    this.settings.delete(tabId)
    this.disarmed.delete(tabId)
    return this.status(tabId)
  }

  status(tabId: string): FixedDateResult {
    const target = this.host.resolve(tabId)
    const staged = this.settings.get(tabId)
    // A setting whose authority or workspace changed is reported as disarmed now, not at the next document.
    const reason = staged ? this.disarmReason(tabId, staged, target.page) : undefined
    if (staged && reason) this.disarm(tabId, staged, reason)
    const setting = this.settings.get(tabId)
    const disarmed = this.disarmed.get(tabId)
    const document = this.documents.get(tabId) ?? { state: 'native' }
    const current = {
      currentDocument: document.state,
      ...(document.state === 'fixed' && document.epochMs !== undefined ? { currentDocumentFixedDate: iso(document.epochMs) } : {})
    }
    if (setting) {
      const matches = document.state === 'fixed' && document.epochMs === setting.epochMs
      return {
        status: matches ? 'active' : 'staged', armed: true,
        fixedDate: iso(setting.epochMs), epochMs: setting.epochMs, origin: setting.origin,
        ...current, reloadRequired: !matches
      }
    }
    const reloadRequired = document.state !== 'native'
    if (disarmed) {
      return {
        status: 'disarmed', armed: false,
        fixedDate: iso(disarmed.epochMs), epochMs: disarmed.epochMs, origin: disarmed.origin,
        ...current, reloadRequired, disarmedReason: disarmed.reason
      }
    }
    return { status: reloadRequired ? 'reset-reload-required' : 'off', armed: false, ...current, reloadRequired }
  }

  /** Forgets every setting; pages keep what they already installed. */
  dispose(): void {
    this.disposed = true
    this.settings.clear()
    this.disarmed.clear()
    this.documents.clear()
  }

  /** Why the setting must not apply to the tab's page (or to a new document of that origin) any more, if it must not. */
  private disarmReason(tabId: string, setting: Setting, page: WebContents, frameOrigin?: string): FixedDateDisarmReason | undefined {
    try {
      const current = this.host.resolve(tabId)
      if (current.identity !== setting.target.identity || current.page !== page
        || current.workspaceId !== setting.target.workspaceId || current.workspaceIdentity !== setting.target.workspaceIdentity) return 'workspace-changed'
    } catch {
      return 'workspace-changed'
    }
    if (frameOrigin !== undefined && frameOrigin !== setting.origin) return 'origin-changed'
    try {
      setting.authority.assertCurrent(setting.origin)
    } catch {
      return 'authority-changed'
    }
    return undefined
  }

  private disarm(tabId: string, setting: Setting, reason: FixedDateDisarmReason): void {
    this.settings.delete(tabId)
    this.disarmed.set(tabId, { epochMs: setting.epochMs, origin: setting.origin, reason })
  }

  /** Tracks the tab's top-level document, once per page. */
  private observe(tabId: string, page: WebContents): void {
    if (this.observed.has(page)) return
    this.observed.add(page)
    page.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
      // Until the next document asks, the Date is unknown: the navigation may never commit (a download or a 204)
      // and keep the old document, or restore a cached one that never asks.
      if (isMainFrame && !isSameDocument) this.documents.set(tabId, { state: 'unknown' })
    })
    page.on('render-process-gone', () => this.documents.set(tabId, { state: 'unknown' }))
    page.on('did-navigate', (_event, url) => {
      // Only HTTP(S) documents ask for a fixed Date; any other document has the native one.
      if (!httpOrigin(url)) this.documents.set(tabId, { state: 'native' })
    })
    page.once('destroyed', () => {
      this.settings.delete(tabId)
      this.disarmed.delete(tabId)
      this.documents.delete(tabId)
    })
  }
}
