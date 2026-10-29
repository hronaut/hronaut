import type { Certificate, Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron'

/** A certificate a website presented for a page that Chromium does not trust, which the tab refused. */
export interface CertificateRefusal {
  /** The page's address. */
  url: string
  /** The website's host name, which an exception is for, as in Chrome. */
  host: string
  /** Chromium's error, such as ERR_CERT_AUTHORITY_INVALID. */
  error: string
  /** The certificate's SHA-256 fingerprint, so an exception holds only for the certificate the person saw refused. */
  fingerprint: string
  /**
   * Whether the person can choose to open the page anyway: false for a website that accepts only secure connections
   * (HSTS) and for a certificate that was revoked, cannot be read or is blocked, as in Chrome; undefined until Hronaut
   * knows whether the website accepts only secure connections.
   */
  canProceed?: boolean
  /** Why the person cannot proceed. */
  locked?: 'strict' | 'blocked'
}

/**
 * The tab fields answering a certificate error reads: its page's session, which holds the person's choices, and which
 * document its page shows.
 */
export interface CertificateErrorTab {
  readonly documentGeneration: number
  webContents: { readonly session: object }
}

/** A request that only asks Chromium whether a website accepts only secure connections, never reaching the network. */
export interface StrictTransportProbe {
  on(event: 'redirect', listener: (statusCode: number, method: string, redirectUrl: string) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'response' | 'abort', listener: () => void): unknown
  abort(): void
  end(): void
}

export interface CertificateErrorAccess {
  /** Starts a request in the workspace's session that follows no redirect itself. */
  probe(session: object, url: string): StrictTransportProbe
  /**
   * What the tab shows about certificates changed: Hronaut learned whether the person can proceed past the one it
   * refused, or its page loaded content over a connection that is not private.
   */
  changed(): void
}

/** How long Hronaut waits for Chromium to say whether a website accepts only secure connections. */
const STRICT_TRANSPORT_PROBE_LIMIT_MS = 5_000
/** Chromium's certificate errors no one can choose to proceed past, in Chrome either. */
const BLOCKED_ERRORS = new Set(['ERR_CERT_REVOKED', 'ERR_CERT_INVALID', 'ERR_CERT_KNOWN_INTERCEPTION_BLOCKED'])

/** The certificates the person chose to trust in each workspace's session, until Hronaut quits, as host, fingerprint and error. */
const exceptions = new WeakMap<object, Set<string>>()
/** The certificate each tab refused for the page it last tried to open. */
const refusals = new WeakMap<object, CertificateRefusal>()
/** The document of each tab's page that loaded content from a website whose certificate the person chose to trust. */
const untrustedContent = new WeakMap<object, number>()

function exceptionKey(host: string, fingerprint: string, error: string): string {
  return `${host}\u0000${fingerprint}\u0000${error}`
}

function httpsHost(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? parsed.hostname : undefined
  } catch {
    return undefined
  }
}

/** Electron's error name, such as net::ERR_CERT_DATE_INVALID, without its prefix. */
function errorName(error: string): string {
  return error.startsWith('net::') ? error.slice('net::'.length) : error
}

/**
 * Whether the workspace's session sends the host only over secure connections, which a website asks for with HSTS or
 * Chromium knows from its preload list, as Chrome checks before it offers to proceed. Chromium answers a plain HTTP
 * request to such a host with its own redirect to HTTPS, before any connection; the request goes to port 1, which
 * Chromium refuses to connect to as unsafe, so it never reaches the network for any other host. Any other outcome
 * counts as strict, so the person is never offered to proceed where Chrome would not.
 */
export function acceptsOnlySecureConnections(access: Pick<CertificateErrorAccess, 'probe'>, session: object, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    let probe: StrictTransportProbe
    try {
      probe = access.probe(session, `http://${host}:1/`)
    } catch {
      resolve(true)
      return
    }
    // Chromium answers at once; a request that never does counts as strict.
    const limit = setTimeout(() => strictAndStop(), STRICT_TRANSPORT_PROBE_LIMIT_MS)
    function answer(strict: boolean): void {
      clearTimeout(limit)
      resolve(strict)
    }
    // Any answer but Chromium's refusal of the port ends the request, which then reaches no further.
    function strictAndStop(): void {
      answer(true)
      probe.abort()
    }
    probe.on('redirect', strictAndStop)
    probe.on('error', (error) => answer(error.message !== 'net::ERR_UNSAFE_PORT'))
    probe.on('response', strictAndStop)
    probe.on('abort', () => answer(true))
    probe.end()
  })
}

/**
 * Answers Chromium when a website presents a certificate it does not trust, as Chrome does: a certificate the person
 * chose to trust for the host in the tab's workspace is accepted, for the page and its requests; any other is refused,
 * and for a page the tab tried to open, the tab keeps what was refused, so the person can choose to open it anyway.
 * Only the person can choose that, never the website or an agent; Hronaut keeps the choice until it quits.
 */
export function answerCertificateError(access: CertificateErrorAccess, tab: CertificateErrorTab, event: Pick<Event, 'preventDefault'>,
  url: string, error: string, certificate: Pick<Certificate, 'fingerprint'>, callback: (trusted: boolean) => void, isMainFrame: boolean): void {
  const host = httpsHost(url)
  const name = errorName(error)
  const session = tab.webContents.session
  if (host && exceptions.get(session)?.has(exceptionKey(host, certificate.fingerprint, name))) {
    event.preventDefault()
    callback(true)
    return
  }
  // Electron refuses the certificate once this returns.
  if (!isMainFrame || !host) return
  const refusal: CertificateRefusal = BLOCKED_ERRORS.has(name)
    ? { url, host, error: name, fingerprint: certificate.fingerprint, canProceed: false, locked: 'blocked' }
    : { url, host, error: name, fingerprint: certificate.fingerprint }
  refusals.set(tab.webContents, refusal)
  if (refusal.canProceed !== undefined) return
  void acceptsOnlySecureConnections(access, session, host).then((strict) => {
    refusal.canProceed = !strict
    if (strict) refusal.locked = 'strict'
    if (refusals.get(tab.webContents) === refusal) access.changed()
  })
}

/** The certificate the tab refused for the page at this address, if that is the page it failed to open. */
export function certificateRefusal(webContents: object, url: string): CertificateRefusal | undefined {
  const refusal = refusals.get(webContents)
  return refusal?.url === url ? refusal : undefined
}

/** What the person is asked before they open a page whose certificate the tab refused. */
export interface CertificateQuestion {
  host: string
  /** Chromium's error, such as ERR_CERT_AUTHORITY_INVALID. */
  error: string
  /** The workspace of the tab. */
  workspaceId?: string
  /** Closes the question once its answer no longer counts. */
  signal: AbortSignal
}

export interface CertificateProceedAccess {
  /** Asks the person in Hronaut's own dialog; resolves true only when they choose to proceed. */
  confirm(question: CertificateQuestion): Promise<boolean>
  /** Opens the page in the tab, as the person's own navigation. */
  open(url: string): Promise<unknown>
}

/** The tab fields proceeding past a refused certificate reads. */
export interface CertificateProceedTab {
  mcpGroupId?: string
  webContents: { readonly session: object } & Pick<WebContents, 'isDestroyed' | 'on' | 'removeListener'>
}

/**
 * Asks the person whether to open the page anyway, as Chrome's "Proceed (unsafe)", when the tab refused its website's
 * certificate and the person can choose to; if they do, trusts the certificate for its host in the workspace until
 * Hronaut quits and opens the page. The question closes, changing nothing, when the tab closes or starts loading
 * another page meanwhile. Resolves whether the page opens.
 */
export async function proceedPastCertificateError(access: CertificateProceedAccess, tab: CertificateProceedTab, url: string): Promise<boolean> {
  const refusal = certificateRefusal(tab.webContents, url)
  if (refusal?.canProceed !== true) return false
  const closing = new AbortController()
  const close = (): void => closing.abort()
  const started = (details: Pick<WebContentsDidStartNavigationEventParams, 'isMainFrame' | 'isSameDocument'>): void => {
    if (details.isMainFrame && !details.isSameDocument) close()
  }
  tab.webContents.on('did-start-navigation', started)
  tab.webContents.on('destroyed', close)
  let proceed: boolean
  try {
    proceed = await access.confirm({ host: refusal.host, error: refusal.error, workspaceId: tab.mcpGroupId, signal: closing.signal })
  } catch {
    proceed = false
  } finally {
    tab.webContents.removeListener('did-start-navigation', started)
    tab.webContents.removeListener('destroyed', close)
  }
  if (proceed !== true || closing.signal.aborted || tab.webContents.isDestroyed() || certificateRefusal(tab.webContents, url) !== refusal) return false
  trustRefusedCertificate(tab, refusal)
  await access.open(refusal.url)
  return true
}

/** Trusts the refused certificate for its host in the tab's workspace until Hronaut quits, once the person chose to. */
export function trustRefusedCertificate(tab: Pick<CertificateErrorTab, 'webContents'>, refusal: CertificateRefusal): void {
  if (refusal.canProceed !== true) throw new Error('The certificate cannot be trusted')
  const session = tab.webContents.session
  let trusted = exceptions.get(session)
  if (!trusted) {
    trusted = new Set()
    exceptions.set(session, trusted)
  }
  trusted.add(exceptionKey(refusal.host, refusal.fingerprint, refusal.error))
}

/**
 * The tab's page loaded a frame or other content from the address, which Chromium reports once loaded. Content from a
 * website whose certificate the person chose to trust makes the page not private either, as in Chrome; Chromium loads
 * it over the connection it already accepted, without asking again.
 */
export function contentLoaded(access: Pick<CertificateErrorAccess, 'changed'>, tab: CertificateErrorTab, url: string): void {
  if (untrustedContent.get(tab.webContents) === tab.documentGeneration || !trustsRefusedCertificate(tab.webContents.session, url)) return
  untrustedContent.set(tab.webContents, tab.documentGeneration)
  access.changed()
}

/**
 * Whether the tab's page is not private because of a certificate Chromium does not trust, as Chrome's "Not secure": the
 * tab refused its website's certificate, the person chose to trust one for its website in the workspace, or the page
 * loaded content from such a website.
 */
export function showsUntrustedCertificate(tab: CertificateErrorTab & { url: string, pageProblem?: { certificate?: object } }): boolean {
  return tab.pageProblem?.certificate !== undefined
    || trustsRefusedCertificate(tab.webContents.session, tab.url)
    || untrustedContent.get(tab.webContents) === tab.documentGeneration
}

/** Whether the person chose to trust a certificate for the address's host in the workspace, so its pages are not private. */
export function trustsRefusedCertificate(session: object, url: string): boolean {
  const host = httpsHost(url)
  const trusted = exceptions.get(session)
  if (!host || !trusted) return false
  const prefix = `${host}\u0000`
  for (const key of trusted) if (key.startsWith(prefix)) return true
  return false
}
