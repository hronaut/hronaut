import type { WebContents } from 'electron'
import {
  VIRTUAL_PASSKEY_CAVEATS,
  virtualPasskeyDuration,
  virtualPasskeyOrigin,
  type BrowserVirtualPasskeySummary,
  type VirtualPasskeyAction,
  type VirtualPasskeyEndReason,
  type VirtualPasskeyReport
} from '../../../shared/virtual-passkey.js'

/** One tab as the virtual passkey sees it. */
export interface VirtualPasskeyTab {
  id: string
  webContents: WebContents
}

/**
 * The starting call's authority for the origin, checked again on every
 * navigation in the page and four times a second, without renewing the
 * agent's write ownership.
 */
export interface VirtualPasskeyAuthority { assertCurrent(): void }

export interface VirtualPasskeyHost<T> {
  isCurrent(tab: T): boolean
  /** Whether Developer Tools are opening for the tab, which detaches Hronaut's debugger before they open. */
  isDevToolsOpening(tab: T): boolean
  /** Runs in the tab's debugger queue after attaching; rejects while Developer Tools are open. */
  withDebugger<R>(tab: T, operation: () => Promise<R>): Promise<R>
  changed(): void
}

export interface VirtualPasskeyOptions {
  origin: string
  userVerified?: boolean
  durationMs?: number
}

interface Session {
  origin: string
  webContents: WebContents
  authority: VirtualPasskeyAuthority
  /** Until the authenticator exists and every check passed, the session is starting and owns nothing to report. */
  started: boolean
  authenticatorId?: string
  userVerified: boolean
  startedAt: number
  expiresAt: number
  credentials: number
  registrations: number
  signIns: number
  expiry?: ReturnType<typeof setTimeout>
  authorityCheck?: ReturnType<typeof setInterval>
  release: () => void
}

/** How often the page's frames and the starting call's authority are checked between navigations. */
const PAGE_CHECK_MS = 250

const AUTHENTICATOR = {
  protocol: 'ctap2',
  ctap2Version: 'ctap2_1',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  automaticPresenceSimulation: true
}

/**
 * Whether a frame navigating to this URL stays in the origin: a document of
 * the origin itself (a blob URL it created included), an inline document,
 * whose origin is its parent's, or an empty document a frame of the origin
 * started, since an empty document takes the origin of whoever started it.
 */
export function staysInOrigin(url: string, origin: string, initiatorOrigin: string | undefined): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'about:') return parsed.pathname === 'srcdoc' || (parsed.pathname === 'blank' && initiatorOrigin === origin)
    return parsed.origin === origin
  } catch {
    return false
  }
}

/** The origin of the frame that started a navigation, when Electron names one that is still there. */
function initiatorOrigin(details: unknown): string | undefined {
  try {
    const origin = (details as { initiator?: { origin?: unknown } | null } | undefined)?.initiator?.origin
    return typeof origin === 'string' ? origin : undefined
  } catch {
    // A frame that is gone cannot be asked.
    return undefined
  }
}

/**
 * Whether any frame of the page, the top-level one included, is at another
 * origin. A frame with an opaque origin, such as a sandboxed frame showing an
 * empty or inline document or a page of the origin, cannot use passkeys and
 * is not counted. A frame that cannot be read counts as foreign.
 */
export function foreignFrame(contents: WebContents, origin: string): boolean {
  return contents.mainFrame.framesInSubtree.some(frame => {
    try {
      if (frame.origin === origin) return false
      if (frame.origin !== 'null') return true
      const parsed = new URL(frame.url)
      return parsed.protocol === 'about:' ? parsed.pathname !== 'blank' && parsed.pathname !== 'srcdoc' : parsed.origin !== origin
    } catch {
      return true
    }
  })
}

function httpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * Owns at most one software passkey authenticator per tab, for one exact
 * localhost origin. Chromium's virtual authenticator environment covers the
 * page's whole frame tree and survives navigations and renderer crashes, so
 * the boundary is Hronaut's: a start is refused unless every frame is already
 * at the origin and nothing is loading, and from before the authenticator
 * exists until it ends, any frame starting or being redirected to load
 * another origin ends it in that same event, before the request is sent.
 * Every committed document, and a check four times a second, looks at all
 * frames again, for pages that return with their frames and no frame
 * navigation, such as one restored from the back-forward cache. The
 * WebAuthn commands are answered in the browser process as they are
 * dispatched, so the authenticator is gone before the event handler returns.
 * Credential events carry private keys and user details; only the
 * authenticator id is read from them, to count. Nothing is persisted.
 */
export class VirtualPasskeyController<T extends VirtualPasskeyTab> {
  private readonly sessions = new Map<T, Session>()
  private readonly lastEnded = new Map<T, { origin: string; reason: VirtualPasskeyEndReason; endedAt: string; removalConfirmed: boolean }>()

  constructor(private readonly host: VirtualPasskeyHost<T>) {}

  active(tab: T): boolean {
    return this.sessions.get(tab)?.started === true
  }

  /** Tab-state projection: what the trusted address bar shows and stops. */
  summary(tab: T): BrowserVirtualPasskeySummary | undefined {
    const session = this.sessions.get(tab)
    return session?.started ? { origin: session.origin, expiresAt: new Date(session.expiresAt).toISOString() } : undefined
  }

  async manage(tab: T, action: VirtualPasskeyAction, options: VirtualPasskeyOptions, authority: VirtualPasskeyAuthority): Promise<VirtualPasskeyReport> {
    const origin = virtualPasskeyOrigin(options.origin)
    if (action !== 'start' && options.durationMs !== undefined) throw new Error('durationMs is only for action start')
    if (action !== 'start' && action !== 'configure' && options.userVerified !== undefined) throw new Error('userVerified is only for actions start and configure')
    if (action === 'start') await this.start(tab, origin, options, authority)
    else if (action === 'configure') await this.configure(tab, origin, options.userVerified)
    else if (action === 'stop') {
      const session = this.sessions.get(tab)
      if (session?.origin === origin) this.end(tab, session, 'stopped')
    } else if (action !== 'status') throw new Error('Unsupported virtual passkey action')
    return this.report(tab, origin)
  }

  /** Ends the tab's virtual passkey for a reason from outside, such as the person's stop or an agent pause. */
  stop(tab: T, reason: VirtualPasskeyEndReason): void {
    const session = this.sessions.get(tab)
    if (session) this.end(tab, session, reason)
  }

  forget(tab: T): void {
    this.stop(tab, 'tab-closed')
    this.lastEnded.delete(tab)
  }

  private async start(tab: T, origin: string, options: VirtualPasskeyOptions, authority: VirtualPasskeyAuthority): Promise<void> {
    const durationMs = virtualPasskeyDuration(options.durationMs)
    const userVerified = options.userVerified ?? true
    if (this.sessions.has(tab)) throw new Error('A virtual passkey is already active or starting in this tab; stop it before starting another')
    const webContents = tab.webContents
    if (webContents.isDestroyed() || webContents.isCrashed()) throw new Error('The page is not running; reload the tab before starting a virtual passkey')
    if (httpOrigin(webContents.getURL()) !== origin) throw new Error(`The tab is not showing ${origin}; open a page of that origin before starting a virtual passkey for it`)
    authority.assertCurrent()
    const session: Session = {
      origin, webContents, authority, started: false, userVerified,
      startedAt: 0, expiresAt: 0, credentials: 0, registrations: 0, signIns: 0, release: () => undefined
    }
    // The boundary is in place before anything is checked or enabled, so no navigation can slip between them.
    this.sessions.set(tab, session)
    this.watch(tab, session)
    const assertCurrent = (): void => {
      if (this.sessions.get(tab) !== session) {
        throw new Error('The virtual passkey ended while it was starting: the page started loading another origin, the agent lost its authority or the tab changed. No authenticator is left in the tab.')
      }
      if (!this.host.isCurrent(tab) || tab.webContents !== webContents || webContents.isDestroyed()) throw new Error('The tab changed while starting the virtual passkey')
    }
    const strangers = (): void => {
      if (foreignFrame(webContents, origin)) throw new Error(`A frame of another origin is in the page; a virtual passkey starts only when every frame is at ${origin}`)
    }
    try {
      strangers()
      if (webContents.isLoading()) throw new Error('Wait for the page to finish loading before starting a virtual passkey')
      await this.host.withDebugger(tab, async () => {
        assertCurrent()
        await webContents.debugger.sendCommand('WebAuthn.enable', { enableUI: false })
        assertCurrent()
        const added = await webContents.debugger.sendCommand('WebAuthn.addVirtualAuthenticator', {
          options: { ...AUTHENTICATOR, isUserVerified: userVerified }
        }) as { authenticatorId?: unknown }
        if (typeof added.authenticatorId !== 'string') throw new Error('The browser did not create a virtual authenticator')
        session.authenticatorId = added.authenticatorId
        assertCurrent()
        strangers()
        authority.assertCurrent()
      })
      // The debugger queue can still have work of its own after the operation, during which the session can end.
      assertCurrent()
    } catch (error) {
      // Whatever was enabled goes again; an ended session already removed it.
      if (this.sessions.get(tab) === session) this.end(tab, session, 'stopped', false)
      throw this.unavailable(error)
    }
    session.started = true
    session.startedAt = Date.now()
    session.expiresAt = session.startedAt + durationMs
    session.expiry = setTimeout(() => this.end(tab, session, 'expired'), durationMs)
    session.authorityCheck = setInterval(() => this.checkPage(tab, session), PAGE_CHECK_MS)
    this.lastEnded.delete(tab)
    this.host.changed()
  }

  private async configure(tab: T, origin: string, userVerified: boolean | undefined): Promise<void> {
    if (userVerified === undefined) throw new Error('configure needs userVerified')
    const session = this.sessions.get(tab)
    if (!session?.started || session.origin !== origin || !session.authenticatorId) throw new Error(`No virtual passkey is active for ${origin} in this tab`)
    this.checkAuthority(tab, session)
    if (this.sessions.get(tab) !== session) throw new Error('The virtual passkey ended: the agent lost its authority for it')
    await session.webContents.debugger.sendCommand('WebAuthn.setUserVerified', { authenticatorId: session.authenticatorId, isUserVerified: userVerified })
    if (this.sessions.get(tab) !== session) throw new Error('The virtual passkey ended while it was being configured')
    session.userVerified = userVerified
  }

  /** Follows everything that ends the session, from before the authenticator exists. */
  private watch(tab: T, session: Session): void {
    const contents = session.webContents
    const navigation = (details: unknown, url: string, isSameDocument: boolean): void => {
      if (isSameDocument) return
      if (!staysInOrigin(url, session.origin, initiatorOrigin(details))) this.end(tab, session, 'origin-left')
      else this.checkAuthority(tab, session)
    }
    // A committed document can bring frames back without a navigation of their own.
    const committed = (): void => { if (foreignFrame(contents, session.origin)) this.end(tab, session, 'origin-left') }
    const rendererGone = (): void => this.end(tab, session, 'renderer-exited')
    const destroyed = (): void => this.end(tab, session, 'tab-closed')
    const devtools = (): void => this.end(tab, session, 'devtools-opened')
    // Opening Developer Tools detaches Hronaut's debugger before they open.
    const detached = (): void => this.end(tab, session, this.host.isDevToolsOpening(tab) ? 'devtools-opened' : 'debugger-detached')
    const message = (_event: unknown, method: string, params: { authenticatorId?: unknown }): void => {
      // Only the authenticator id is read: these events also carry the private key and the user's details.
      if (!method.startsWith('WebAuthn.credential') || session.authenticatorId === undefined || params?.authenticatorId !== session.authenticatorId) return
      if (method === 'WebAuthn.credentialAdded') { session.registrations++; session.credentials++ }
      else if (method === 'WebAuthn.credentialAsserted') session.signIns++
      else if (method === 'WebAuthn.credentialDeleted') session.credentials = Math.max(0, session.credentials - 1)
    }
    contents.on('did-start-navigation', navigation)
    contents.on('did-redirect-navigation', navigation)
    contents.on('did-frame-navigate', committed)
    contents.on('render-process-gone', rendererGone)
    contents.on('destroyed', destroyed)
    contents.on('devtools-opened', devtools)
    contents.debugger.on('detach', detached)
    contents.debugger.on('message', message)
    session.release = () => {
      if (contents.isDestroyed()) return
      contents.removeListener('did-start-navigation', navigation)
      contents.removeListener('did-redirect-navigation', navigation)
      contents.removeListener('did-frame-navigate', committed)
      contents.removeListener('render-process-gone', rendererGone)
      contents.removeListener('destroyed', destroyed)
      contents.removeListener('devtools-opened', devtools)
      contents.debugger.removeListener('detach', detached)
      contents.debugger.removeListener('message', message)
    }
  }

  /** The periodic check: any frame of another origin ends the session, and so does lost authority. */
  private checkPage(tab: T, session: Session): void {
    if (this.sessions.get(tab) !== session) {
      clearTimeout(session.expiry)
      clearInterval(session.authorityCheck)
      return
    }
    if (foreignFrame(session.webContents, session.origin)) this.end(tab, session, 'origin-left')
    else this.checkAuthority(tab, session)
  }

  private checkAuthority(tab: T, session: Session): void {
    try {
      if (!this.host.isCurrent(tab) || tab.webContents !== session.webContents) throw new Error('tab changed')
      session.authority.assertCurrent()
    } catch {
      this.end(tab, session, 'authority-changed')
    }
  }

  /**
   * Ends the session at once. The removal and WebAuthn.disable are answered in the browser process as they are
   * dispatched, so the authenticator is gone when this returns; disabling also drops one whose id is not known yet.
   */
  private end(tab: T, session: Session, reason: VirtualPasskeyEndReason, record = true): void {
    if (this.sessions.get(tab) !== session) return
    this.sessions.delete(tab)
    clearTimeout(session.expiry)
    clearInterval(session.authorityCheck)
    session.release()
    const contents = session.webContents
    const ended = { origin: session.origin, reason, endedAt: new Date().toISOString(), removalConfirmed: true }
    if (!contents.isDestroyed() && contents.debugger.isAttached()) {
      if (session.authenticatorId !== undefined) {
        void contents.debugger.sendCommand('WebAuthn.removeVirtualAuthenticator', { authenticatorId: session.authenticatorId }).catch(() => undefined)
      }
      void contents.debugger.sendCommand('WebAuthn.disable').catch(() => {
        // A session that detached meanwhile took the environment with it.
        if (contents.isDestroyed() || !contents.debugger.isAttached()) return
        ended.removalConfirmed = false
        this.host.changed()
      })
    }
    if (record && session.started) this.lastEnded.set(tab, ended)
    this.host.changed()
  }

  private unavailable(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error)
    // An Electron or Chromium build without the WebAuthn domain.
    if (/wasn't found/i.test(message)) return new Error('Virtual passkeys are unavailable in this browser build', { cause: error })
    return error instanceof Error ? error : new Error(message)
  }

  private report(tab: T, origin: string): VirtualPasskeyReport {
    const session = this.sessions.get(tab)
    const lastEnded = this.lastEnded.get(tab)
    const own = session?.started && session.origin === origin ? session : undefined
    return {
      tabId: tab.id,
      origin,
      status: own ? 'active' : 'inactive',
      ...(own ? {
        passkey: {
          userVerified: own.userVerified,
          startedAt: new Date(own.startedAt).toISOString(),
          expiresAt: new Date(own.expiresAt).toISOString(),
          remainingMs: Math.max(0, own.expiresAt - Date.now()),
          credentials: own.credentials,
          registrations: own.registrations,
          signIns: own.signIns
        }
      } : {}),
      ...(lastEnded?.origin === origin ? { lastEnded: { reason: lastEnded.reason, endedAt: lastEnded.endedAt, removalConfirmed: lastEnded.removalConfirmed } } : {}),
      caveats: [...VIRTUAL_PASSKEY_CAVEATS]
    }
  }
}
