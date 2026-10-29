import type { AuthenticationResponseDetails, AuthInfo, Event, WebContents } from 'electron'
import type { TrustedDialogCredentials } from '../../../shared/trusted-dialogs.js'

/** What the person is asked to sign in to, and the signal that closes the question once its answer no longer counts. */
export interface HttpAuthQuestion {
  /** The website that asks, as an origin such as https://example.com. */
  origin: string
  /** False when the connection is not encrypted, so the password can be read on the way. */
  secure: boolean
  /** The workspace of the tab that asks. */
  workspaceId?: string
  signal: AbortSignal
}

/** The tab fields answering a website's sign-in reads. */
export interface HttpAuthTab {
  sleeping: boolean
  mcpGroupId?: string
  webContents: Pick<WebContents, 'getURL' | 'isDestroyed' | 'on' | 'removeListener'>
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
  waiting: LoginCallback[]
  closing: AbortController
}

// Electron's code for a load that was cancelled, as when the person stops it, which keeps the page that was shown.
const ABORTED_LOAD_ERROR = -3

/** The sign-in each tab's page asks for now, by its WebContents. */
const signIns = new WeakMap<object, SignIn>()

/** Whether the page asks the person to sign in now, so a load waits for them. */
export function asksToSignIn(webContents: object): boolean {
  return signIns.has(webContents)
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
 * answer; a page that opens asks in place of anything the page it replaces asked, and anything else the page asks for
 * meanwhile is cancelled, so a page cannot pile up questions. The question closes once its answer no longer counts:
 * when the tab closes, another page replaces the one that asked, or the page that asked for is no longer on its way.
 * What the person types goes only to the website that asked, through Chromium; Hronaut never keeps, logs or shows it.
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
  const asking = signIns.get(webContents)
  if (asking?.key === key) {
    event.preventDefault()
    asking.waiting.push(callback)
    return
  }
  if (asking && !opensPage) return
  asking?.closing.abort()

  event.preventDefault()
  const signIn: SignIn = { key, waiting: [callback], closing: new AbortController() }
  signIns.set(webContents, signIn)
  const close = (): void => signIn.closing.abort()
  // A page on its way stops counting once another starts or the load ends; the page shown, once another replaces it.
  const started = (_event: unknown, _url: string, isSameDocument: boolean, isMainFrame: boolean): void => {
    if (opensPage && isMainFrame && !isSameDocument) close()
  }
  const failed = (_event: unknown, errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (isMainFrame && (opensPage || errorCode !== ABORTED_LOAD_ERROR)) close()
  }
  webContents.on('did-start-navigation', started)
  webContents.on('did-fail-load', failed)
  webContents.on('did-navigate', close)
  webContents.on('destroyed', close)
  void access.askToSignIn({ origin, secure: origin.startsWith('https:'), workspaceId: tab.mcpGroupId, signal: signIn.closing.signal })
    .catch(() => null)
    .then((credentials) => {
      webContents.removeListener('did-start-navigation', started)
      webContents.removeListener('did-fail-load', failed)
      webContents.removeListener('did-navigate', close)
      webContents.removeListener('destroyed', close)
      if (signIns.get(webContents) === signIn) signIns.delete(webContents)
      const answer = signIn.closing.signal.aborted ? null : credentials
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
