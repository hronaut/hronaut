import type { AuthenticationResponseDetails, AuthInfo, Event, WebContents } from 'electron'
import { addressSecurity } from '../../../shared/address-security.js'
import type { TrustedDialogCredentials } from '../../../shared/trusted-dialogs.js'
import { LocalizedError } from '../../localized-error.js'

/** What the person is asked to sign in to, and the signal that closes the question once its answer no longer counts. */
export interface HttpAuthQuestion {
  /** The website that asks, as an origin such as https://example.com. */
  origin: string
  /** False when the connection is not encrypted and leaves this computer, so the password can be read on the way. */
  secure: boolean
  /** The workspace of the tab that asks. */
  workspaceId?: string
  signal: AbortSignal
}

/** The tab fields answering a website's sign-in reads. */
export interface HttpAuthTab {
  sleeping: boolean
  mcpGroupId?: string
  webContents: Pick<WebContents, 'getURL' | 'isDestroyed' | 'on' | 'once' | 'removeListener' | 'session'>
}

export interface HttpAuthAccess {
  /**
   * Asks the person to sign in, in Hronaut's own dialog; resolves with what they typed, or null when they cancel, the
   * question closes or no window can show it.
   */
  askToSignIn(question: HttpAuthQuestion): Promise<TrustedDialogCredentials | null>
}

type LoginCallback = (username?: string, password?: string) => void

/** The sign-in a tab asks the person for now, and the website's requests waiting for its answer. */
interface SignIn {
  /** The scheme, website and realm the answer is for; another request asking the same waits for the same answer. */
  key: string
  /** The workspace's session, which keeps the sign-in for all its tabs. */
  session: object
  /** Whether a page opening in the tab asks, or waits for the same answer, so its load waits for the person. */
  opensPage: boolean
  waiting: LoginCallback[]
  closing: AbortController
  /** The person's answer to the same question in another tab of the workspace, which answers this one too. */
  shared?: { credentials: TrustedDialogCredentials | null }
}

// Electron's code for a load that was cancelled, as when the person stops it, which keeps the page that was shown.
const ABORTED_LOAD_ERROR = -3

/** The sign-in each tab's page asks for now, by its WebContents. */
const signIns = new WeakMap<object, SignIn>()
/** Every sign-in asked now, in all tabs. */
const asked = new Set<SignIn>()
/** The sign-ins the person cancelled for the page each tab shows, which it cannot ask for again until another replaces it. */
const cancelled = new WeakMap<object, Set<string>>()

/** Whether a page opening in the tab asks the person to sign in now, so its load waits for them. */
export function asksToSignIn(webContents: object): boolean {
  return signIns.get(webContents)?.opensPage === true
}

/** The error for a page that did not open in time: the person was asked to sign in to it, or it took too long. */
export function pageLoadTimedOut(webContents: object): LocalizedError {
  return new LocalizedError(asksToSignIn(webContents) ? 'appErrors.page.signInAsked' : 'appErrors.page.loadTimedOut')
}

/** Refuses the sign-in in the tab without asking until its main frame shows another document, such as the refusal. */
function rememberCancel(webContents: HttpAuthTab['webContents'], key: string): void {
  let keys = cancelled.get(webContents)
  if (!keys) {
    keys = new Set()
    cancelled.set(webContents, keys)
    webContents.once('did-navigate', () => cancelled.delete(webContents))
  }
  keys.add(key)
}

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * Answers a website's HTTP authentication challenge as Chrome does: the person signs in, in Hronaut's own dialog naming
 * the website, and Chromium sends what they typed to that website and keeps it for the workspace's session; Cancel, or a
 * question that closes, lets the website show the page it sends without them. A page opened in the tab asks, and so do
 * the frames and requests of the page's own website; a frame or request from another website, a proxy and a sleeping tab
 * never do, and Electron cancels them as before. Requests asking for the same sign-in while it shows wait for its
 * answer, and so do the workspace's other tabs asking the same, as in Chrome; a page that opens asks in place of
 * anything the page it replaces asked, and anything else the page asks for meanwhile is cancelled, so a page cannot pile
 * up questions. A sign-in the person cancelled is not asked again until the tab shows another document, so a page
 * cannot ask over and over. The question closes once its answer no longer counts: when the tab closes or its page
 * crashes, another page replaces the one that asked, or the page that asked for is no longer on its way. What the person
 * types goes only to the website that asked, through Chromium; Hronaut never keeps, logs or shows it.
 */
export function answerHttpAuth(access: HttpAuthAccess, tab: HttpAuthTab, event: Pick<Event, 'preventDefault'>,
  details: AuthenticationResponseDetails, authInfo: AuthInfo, callback: LoginCallback): void {
  const webContents = tab.webContents
  if (authInfo.isProxy || tab.sleeping || webContents.isDestroyed()) return
  const origin = originOf(details.url)
  if (!origin) return
  // Electron reports isMainFrame at runtime without typing it.
  const isMainFrame = (details as AuthenticationResponseDetails & { isMainFrame?: unknown }).isMainFrame
  const opensPage = details.isRequestForNavigation && isMainFrame !== false
  // As in Chrome, a frame or request from another website cannot ask, which a page could use to pass for the one shown.
  if (!opensPage && originOf(webContents.getURL()) !== origin) return
  const key = `${authInfo.scheme.toLowerCase()} ${origin} ${authInfo.realm}`
  if (cancelled.get(webContents)?.has(key)) return
  const asking = signIns.get(webContents)
  if (asking?.key === key) {
    event.preventDefault()
    asking.waiting.push(callback)
    asking.opensPage ||= opensPage
    return
  }
  if (asking && !opensPage) return
  asking?.closing.abort()

  event.preventDefault()
  const signIn: SignIn = { key, session: webContents.session, opensPage, waiting: [callback], closing: new AbortController() }
  signIns.set(webContents, signIn)
  asked.add(signIn)
  const close = (): void => signIn.closing.abort()
  // A page on its way stops counting once another starts or its load stops or fails, which Electron reports as a
  // provisional failure; the page shown, once another replaces it, an error page included.
  const started = (_event: unknown, _url: string, isSameDocument: boolean, isMainFrame: boolean): void => {
    if (opensPage && isMainFrame && !isSameDocument) close()
  }
  const failedProvisionally = (_event: unknown, _errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (opensPage && isMainFrame) close()
  }
  const failed = (_event: unknown, errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (isMainFrame && errorCode !== ABORTED_LOAD_ERROR) close()
  }
  webContents.on('did-start-navigation', started)
  webContents.on('did-fail-provisional-load', failedProvisionally)
  webContents.on('did-fail-load', failed)
  webContents.on('did-navigate', close)
  webContents.on('render-process-gone', close)
  webContents.on('destroyed', close)
  const question: HttpAuthQuestion = { origin, secure: addressSecurity(origin) !== 'not-secure', workspaceId: tab.mcpGroupId, signal: signIn.closing.signal }
  let answering: Promise<TrustedDialogCredentials | null>
  try {
    answering = access.askToSignIn(question)
  } catch {
    answering = Promise.resolve(null)
  }
  void answering
    .catch(() => null)
    .then((credentials) => {
      webContents.removeListener('did-start-navigation', started)
      webContents.removeListener('did-fail-provisional-load', failedProvisionally)
      webContents.removeListener('did-fail-load', failed)
      webContents.removeListener('did-navigate', close)
      webContents.removeListener('render-process-gone', close)
      webContents.removeListener('destroyed', close)
      asked.delete(signIn)
      if (signIns.get(webContents) === signIn) signIns.delete(webContents)
      const answeredHere = !signIn.shared && !signIn.closing.signal.aborted
      const answer = signIn.shared ? signIn.shared.credentials : answeredHere ? credentials : null
      if (answeredHere) {
        // The person's answer counts for the workspace's other tabs asking the same, whose questions close.
        for (const other of asked) {
          if (other.session !== signIn.session || other.key !== key || other.closing.signal.aborted) continue
          other.shared = { credentials }
          other.closing.abort()
        }
      }
      if (!answer && (answeredHere || signIn.shared) && !webContents.isDestroyed()) rememberCancel(webContents, key)
      for (const answered of signIn.waiting) {
        // A request Chromium already ended ignores its answer.
        try {
          if (answer) answered(answer.username, answer.password)
          else answered()
        } catch {
          // Nothing waits for that request any more.
        }
      }
    })
}
