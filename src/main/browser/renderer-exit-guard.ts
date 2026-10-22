import type { Debugger, WebContents } from 'electron'
import { LocalizedError } from '../localized-error.js'

/** A page script, DevTools command, capture or print that cannot finish because the page's renderer exited. */
export class RendererExitedError extends LocalizedError {
  /** Whether the call reached the page before its renderer exited; false when it was refused unsent. */
  readonly sent: boolean

  constructor(sent: boolean) {
    super(sent ? 'appErrors.page.rendererExitedDuringAction' : 'appErrors.page.rendererExitedBeforeAction')
    this.name = 'RendererExitedError'
    this.sent = sent
  }
}

type GuardedPage = Pick<WebContents, 'isDestroyed' | 'isCrashed' | 'executeJavaScript' | 'executeJavaScriptInIsolatedWorld' | 'capturePage' | 'printToPDF'> & {
  on(event: 'render-process-gone', listener: () => void): unknown
  debugger: Pick<Debugger, 'sendCommand'>
}

// Chromium answers these in the browser process without the renderer: the
// input barrier must keep following the person's lock, request rules must let
// the reload of a crashed page through, cookies stay manageable, and a virtual
// passkey and auto-attach to the page's workers, which both survive the
// renderer, can still be removed.
const BROWSER_PROCESS_COMMANDS = new Set([
  'Input.setIgnoreInputEvents', 'Network.getAllCookies', 'Network.deleteCookies', 'Page.setWebLifecycleState',
  'Storage.getUsageAndQuota', 'Target.setAutoAttach'
])
const BROWSER_PROCESS_DOMAINS = ['Fetch.', 'WebAuthn.']

/**
 * Electron never settles a page's executeJavaScript or
 * executeJavaScriptInIsolatedWorld call once its renderer exits, and holds
 * renderer DevTools commands until the next load. An operation awaiting one
 * would keep its tab, debugger queue and workspace busy indefinitely.
 * printToPDF on a page whose renderer exited ends the whole application, and
 * capturePage returns an image that is not the page. Installed once on each
 * tab's page, this makes those calls fail with RendererExitedError when the
 * renderer exits and fail at once, unsent, while it stays gone, so operations
 * settle and run their cleanup. A new load starts a new renderer and calls
 * work again. Nothing is retried or replayed.
 */
export function guardPageCallsAcrossRendererExit(page: GuardedPage): void {
  // Only calls in flight are held, so a long-lived page keeps nothing per call.
  const inFlight = new Set<(error: RendererExitedError) => void>()
  page.on('render-process-gone', () => {
    const rejecters = [...inFlight]
    inFlight.clear()
    for (const reject of rejecters) reject(new RendererExitedError(true))
  })
  const settleBeforeExit = <T>(call: () => Promise<T>): Promise<T> => {
    if (!page.isDestroyed() && page.isCrashed()) return Promise.reject(new RendererExitedError(false))
    const pending = call()
    return new Promise<T>((resolve, reject) => {
      inFlight.add(reject)
      pending.then(resolve, reject).finally(() => inFlight.delete(reject))
    })
  }
  const executeJavaScript = page.executeJavaScript.bind(page)
  const executeJavaScriptInIsolatedWorld = page.executeJavaScriptInIsolatedWorld.bind(page)
  const sendCommand = page.debugger.sendCommand.bind(page.debugger)
  const capturePage = page.capturePage.bind(page)
  const printToPDF = page.printToPDF.bind(page)
  page.executeJavaScript = (...args) => settleBeforeExit(() => executeJavaScript(...args))
  page.executeJavaScriptInIsolatedWorld = (...args) => settleBeforeExit(() => executeJavaScriptInIsolatedWorld(...args))
  page.capturePage = (...args: Parameters<typeof capturePage>) => settleBeforeExit(() => capturePage(...args))
  page.printToPDF = (...args) => settleBeforeExit(() => printToPDF(...args))
  page.debugger.sendCommand = (method, ...args) => answeredByBrowserProcess(method)
    ? sendCommand(method, ...args)
    : settleBeforeExit(() => sendCommand(method, ...args))
}

/** Whether Chromium answers this DevTools command in the browser process, without waiting on the page's renderer. */
export function answeredByBrowserProcess(method: string): boolean {
  return BROWSER_PROCESS_COMMANDS.has(method) || BROWSER_PROCESS_DOMAINS.some(domain => method.startsWith(domain))
}
