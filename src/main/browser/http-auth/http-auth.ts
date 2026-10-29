import type { AuthenticationResponseDetails, AuthInfo, Event, InputEvent, WebContents, WebContentsDidStartNavigationEventParams, WebContentsWillFrameNavigateEventParams } from 'electron'
import { addressSecurity } from '../../../shared/address-security.js'
import type { TrustedDialogCredentials } from '../../../shared/trusted-dialogs.js'
import { LocalizedError } from '../../localized-error.js'
import { ANSWERED_ELSEWHERE } from '../../trusted-dialogs/trusted-dialogs.js'

/**
 * What the person is asked to sign in to, and the signal that closes the question once its answer no longer counts;
 * its reason is `ANSWERED_ELSEWHERE` when their answer in another tab of the workspace answered it.
 */
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
  webContents: Pick<WebContents, 'getURL' | 'isDestroyed' | 'on' | 'removeListener' | 'session'>
}

/** The person's answer to a sign-in: what they typed, or their Cancel. */
export type SignInAnswer = TrustedDialogCredentials | 'cancelled'

export interface HttpAuthAccess {
  /**
   * Asks the person to sign in, in Hronaut's own dialog; resolves with what they typed, 'cancelled' when they cancel, or
   * null when nobody answered: the question closed or no window could show it.
   */
  askToSignIn(question: HttpAuthQuestion): Promise<SignInAnswer | null>
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
  shared?: { answer: SignInAnswer }
  /**
   * The page opening in the tab when it asked, which a Cancel keeps from ending the tab's refusal; none for a request of
   * the page shown, whose Cancel leaves a page the person or an agent has on its way meanwhile to end it.
   */
  opening?: Opening
}

/**
 * A page opening in a tab: whether a page opened it, rather than the browser, from the address field, Reload, Back or
 * an agent; and whether that came just after a click or key in the page, as when the person follows a link.
 */
interface Opening {
  byPage: boolean
  activated: boolean
  /** Set once its start closed a question the tab's page asked, which counts as the page moving on if it is its own. */
  closedQuestion?: boolean
}

/**
 * Whether a tab refuses the sign-ins its pages ask for by themselves, and the page opening there now, which decides
 * whether that refusal ends.
 */
interface SignInGuard {
  /**
   * True once the person cancelled a sign-in in the tab, or in a tab of its family, or the tab's page moved on by itself
   * while one was asked; false again once a page the person or an agent opened shows there.
   */
  refusing: boolean
  /** When the person, or an agent's input, last clicked or pressed a key in the tab's page, until a page used it up. */
  activatedAt: number
  /** The page opening in the tab now, or the one it shows once it opened; none after a Cancel left its page refusing. */
  opening?: Opening
  /** The tab and every tab whose page one of them opened, which a Cancel in any of them makes refuse. */
  family: Set<SignInGuard>
}

// Electron's code for a load that was cancelled, as when the person stops it, which keeps the page that was shown.
const ABORTED_LOAD_ERROR = -3
/** How long after a click or key in a page a page it opens counts as the person's, as when they follow a link. */
const USER_ACTIVATION_MS = 1_000
/** The input that counts as a click or key in a page: a press, or the release that ends a click held a while. */
const ACTIVATING_INPUT = new Set<string>(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'touchStart', 'touchEnd'])

/** The sign-in each tab's page asks for now, by its WebContents. */
const signIns = new WeakMap<object, SignIn>()
/** Every sign-in asked now, in all tabs. */
const asked = new Set<SignIn>()
/** What each tab keeps of its sign-ins, by its WebContents, for as long as the tab lives. */
const guards = new WeakMap<object, SignInGuard>()

/** Whether a page opening in the tab asks the person to sign in now, so its load waits for them. */
export function asksToSignIn(webContents: object): boolean {
  return signIns.get(webContents)?.opensPage === true
}

/** The error for a page that did not open in time: the person was asked to sign in to it, or it took too long. */
export function pageLoadTimedOut(webContents: object): LocalizedError {
  return new LocalizedError(asksToSignIn(webContents) ? 'appErrors.page.signInAsked' : 'appErrors.page.loadTimedOut')
}

type GuardedWebContents = Pick<WebContents, 'on'>

/** The tab's guard, which follows its pages from the tab's start; it joins the given family, or starts its own. */
function guardOf(webContents: GuardedWebContents, family = new Set<SignInGuard>()): SignInGuard {
  const known = guards.get(webContents)
  if (known) return known
  const guard: SignInGuard = { refusing: false, activatedAt: Number.NEGATIVE_INFINITY, family }
  family.add(guard)
  // As in Chrome, Escape and the repeats of a held key are no activation.
  webContents.on('input-event', (_event: unknown, input: Pick<InputEvent, 'type'> & { key?: string, isAutoRepeat?: boolean }) => {
    if (ACTIVATING_INPUT.has(input.type) && input.isAutoRepeat !== true && input.key !== 'Escape') guard.activatedAt = Date.now()
  })
  webContents.on('did-start-navigation', (details: Pick<WebContentsDidStartNavigationEventParams, 'isMainFrame' | 'isSameDocument' | 'initiator'>) => {
    if (!details.isMainFrame || details.isSameDocument) return
    guard.opening = { byPage: false, activated: Date.now() - guard.activatedAt <= USER_ACTIVATION_MS }
    if (details.initiator) openedByPage(guard.opening, guard)
  })
  // Once a page starts, Electron tells whether a page opened it, even one the workspace then refuses: one a service
  // worker opens names no initiator, so as it started it passed for the browser's, even when it closed a question.
  webContents.on('will-frame-navigate', (details: Pick<WebContentsWillFrameNavigateEventParams, 'isMainFrame'>) => {
    if (!details.isMainFrame || !guard.opening) return
    openedByPage(guard.opening, guard)
    if (guard.opening.closedQuestion) pageMovedOn(guard)
  })
  // A page the person or an agent opened ends the refusal once it shows, so its own requests may ask again.
  webContents.on('did-navigate', () => {
    if (openedByPerson(guard.opening)) guard.refusing = false
  })
  webContents.on('destroyed', () => family.delete(guard))
  guards.set(webContents, guard)
  return guard
}

/**
 * Follows the sign-ins of a new tab's pages from before its first page opens. A tab a page opened refuses what its
 * opener's tab refuses, and the two refuse together from now on, so a page cannot ask again by opening tabs; a click
 * or key in the opener just before counts for the first page it opens, and for no other, as in Chrome.
 */
export function followSignIns(webContents: GuardedWebContents, opener?: GuardedWebContents): void {
  if (!opener) {
    guardOf(webContents)
    return
  }
  const openerGuard = guardOf(opener)
  const guard = guardOf(webContents, openerGuard.family)
  guard.refusing = openerGuard.refusing
  guard.activatedAt = openerGuard.activatedAt
  openerGuard.activatedAt = Number.NEGATIVE_INFINITY
}

/**
 * The page opening in the tab is a page's own: a click or key in the tab just before counts for it, as when the person
 * follows a link, and for no page after it, as in Chrome.
 */
function openedByPage(opening: Opening, guard: SignInGuard): void {
  opening.byPage = true
  if (opening.activated) guard.activatedAt = Number.NEGATIVE_INFINITY
}

/** Whether the person or an agent opened the page, from the browser or by a click or key in the page just before. */
function openedByPerson(opening: Opening | undefined): opening is Opening {
  return opening !== undefined && (!opening.byPage || opening.activated)
}

/**
 * Refuses the sign-ins the pages of the tab and its family ask for by themselves from now on, after the person
 * cancelled one in the tab: the page that asked, which shows once its load goes on without credentials, never ends
 * the refusal.
 */
function refuseAfterCancel(guard: SignInGuard, asking: Opening | undefined): void {
  for (const member of guard.family) {
    member.refusing = true
    member.activatedAt = Number.NEGATIVE_INFINITY
  }
  if (guard.opening === asking) guard.opening = undefined
}

/** The tab's page moved on while a sign-in was asked; unless the person or an agent moved it on, the tab refuses. */
function pageMovedOn(guard: SignInGuard): void {
  if (guard.opening) guard.opening.closedQuestion = true
  if (!openedByPerson(guard.opening)) guard.refusing = true
}

/**
 * Whether the tab's page may ask the person to sign in: always, unless the tab refuses; then only a page opening that
 * the person or an agent opened.
 */
function mayAsk(guard: SignInGuard, opensPage: boolean): boolean {
  return !guard.refusing || (opensPage && openedByPerson(guard.opening))
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
 * up questions. The question closes once its answer no longer counts: when the tab closes or its page crashes, another
 * page replaces the one that asked, or the page that asked for is no longer on its way. Once the person cancels a
 * sign-in, the pages of the tab, of the tabs its pages opened and of the tab whose page opened it ask no more by
 * themselves, for any website or realm, so a page cannot ask over and over, through new tabs either; nor do the tab's
 * pages once its page moved on by itself while one was asked, so a page cannot put one question in place of another.
 * A page the person or an agent opens may ask again, and its own requests too once it shows. What the person types
 * goes only to the website that asked, through Chromium; Hronaut never keeps, logs or shows it.
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
  const guard = guardOf(webContents)
  // A question already closed takes no more requests, unless the person's answer in another tab closed it.
  const asking = signIns.get(webContents)
  if (asking?.key === key && (!asking.closing.signal.aborted || asking.shared)) {
    event.preventDefault()
    asking.waiting.push(callback)
    // A page that opens waits for the same answer; after a Cancel it shows the website's refusal, which keeps the tab refusing.
    if (opensPage) {
      asking.opensPage = true
      asking.opening = guard.opening
    }
    return
  }
  const open = asking && !asking.closing.signal.aborted ? asking : undefined
  if (open && !opensPage) return
  // The page that opens takes the place of the one whose question shows, which moved on without an answer.
  if (open) {
    pageMovedOn(guard)
    open.closing.abort()
  }
  if (!mayAsk(guard, opensPage)) return

  event.preventDefault()
  const signIn: SignIn = {
    key, session: webContents.session, opensPage, waiting: [callback], closing: new AbortController(), opening: opensPage ? guard.opening : undefined
  }
  signIns.set(webContents, signIn)
  asked.add(signIn)
  const close = (): void => signIn.closing.abort()
  // The tab's page moved on while the question showed, which leaves it unanswered.
  const movedOn = (): void => {
    pageMovedOn(guard)
    close()
  }
  // A page on its way stops counting once another starts or its load stops or fails, which Electron reports as a
  // provisional failure; the page shown, once another replaces it, an error page included.
  const started = (details: Pick<WebContentsDidStartNavigationEventParams, 'isMainFrame' | 'isSameDocument'>): void => {
    if (signIn.opensPage && details.isMainFrame && !details.isSameDocument) movedOn()
  }
  const failedProvisionally = (_event: unknown, _errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (signIn.opensPage && isMainFrame) movedOn()
  }
  const failed = (_event: unknown, errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (isMainFrame && errorCode !== ABORTED_LOAD_ERROR) movedOn()
  }
  webContents.on('did-start-navigation', started)
  webContents.on('did-fail-provisional-load', failedProvisionally)
  webContents.on('did-fail-load', failed)
  webContents.on('did-navigate', movedOn)
  webContents.on('render-process-gone', movedOn)
  webContents.on('destroyed', close)
  const question: HttpAuthQuestion = { origin, secure: addressSecurity(origin) !== 'not-secure', workspaceId: tab.mcpGroupId, signal: signIn.closing.signal }
  let answering: Promise<SignInAnswer | null>
  try {
    answering = access.askToSignIn(question)
  } catch {
    answering = Promise.resolve(null)
  }
  void answering
    .catch(() => null)
    .then((answered) => {
      webContents.removeListener('did-start-navigation', started)
      webContents.removeListener('did-fail-provisional-load', failedProvisionally)
      webContents.removeListener('did-fail-load', failed)
      webContents.removeListener('did-navigate', movedOn)
      webContents.removeListener('render-process-gone', movedOn)
      webContents.removeListener('destroyed', close)
      asked.delete(signIn)
      if (signIns.get(webContents) === signIn) signIns.delete(webContents)
      // Only the person's own answer counts, here or in another tab; a question that closed, or that no window could
      // show, answers nothing, and the website shows its page without credentials.
      const ownAnswer = !signIn.shared && !signIn.closing.signal.aborted ? answered : null
      const answer = signIn.shared?.answer ?? ownAnswer
      if (ownAnswer) {
        // The person's answer counts for the workspace's other tabs asking the same, whose questions close.
        for (const other of asked) {
          if (other.session !== signIn.session || other.key !== key || other.closing.signal.aborted) continue
          other.shared = { answer: ownAnswer }
          other.closing.abort(ANSWERED_ELSEWHERE)
        }
      }
      if (answer === 'cancelled') refuseAfterCancel(guard, signIn.opening)
      const credentials = answer === 'cancelled' ? null : answer
      for (const waiting of signIn.waiting) {
        // A request Chromium already ended ignores its answer.
        try {
          if (credentials) waiting(credentials.username, credentials.password)
          else waiting()
        } catch {
          // Nothing waits for that request any more.
        }
      }
    })
}
