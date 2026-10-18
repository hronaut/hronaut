import type { Debugger, WebContents } from 'electron'

/** A page script or DevTools command that cannot finish because the page's renderer exited. */
export class RendererExitedError extends Error {
  /** Whether the call reached the page before its renderer exited; false when it was refused unsent. */
  readonly sent: boolean

  constructor(sent: boolean) {
    super(sent
      ? 'The page stopped during this action because its renderer exited; its effects are unknown. Reload or close the tab, then inspect fresh state.'
      : 'The page is not running because its renderer exited; nothing was sent to it. Reload or close the tab, then inspect fresh state.')
    this.name = 'RendererExitedError'
    this.sent = sent
  }
}

type GuardedPage = Pick<WebContents, 'isDestroyed' | 'isCrashed' | 'executeJavaScript' | 'executeJavaScriptInIsolatedWorld'> & {
  on(event: 'render-process-gone', listener: () => void): unknown
  debugger: Pick<Debugger, 'sendCommand'>
}

// Chromium answers these in the browser process without the renderer: the
// input barrier must keep following the person's lock, request rules must let
// the reload of a crashed page through, and cookies stay manageable.
const BROWSER_PROCESS_COMMANDS = new Set([
  'Input.setIgnoreInputEvents', 'Network.getAllCookies', 'Network.deleteCookies', 'Storage.getUsageAndQuota'
])
const BROWSER_PROCESS_DOMAINS = ['Fetch.']

/**
 * Electron never settles a page's executeJavaScript or
 * executeJavaScriptInIsolatedWorld call once its renderer exits, and holds
 * renderer DevTools commands until the next load. An operation awaiting one
 * would keep its tab, debugger queue and workspace busy indefinitely.
 * Installed once on each tab's page, this makes those calls fail with
 * RendererExitedError when the renderer exits and fail at once, unsent, while
 * it stays gone, so operations settle and run their cleanup. A new load
 * starts a new renderer and calls work again. Nothing is retried or replayed.
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
  page.executeJavaScript = (...args) => settleBeforeExit(() => executeJavaScript(...args))
  page.executeJavaScriptInIsolatedWorld = (...args) => settleBeforeExit(() => executeJavaScriptInIsolatedWorld(...args))
  page.debugger.sendCommand = (method, ...args) => answeredByBrowserProcess(method)
    ? sendCommand(method, ...args)
    : settleBeforeExit(() => sendCommand(method, ...args))
}

function answeredByBrowserProcess(method: string): boolean {
  return BROWSER_PROCESS_COMMANDS.has(method) || BROWSER_PROCESS_DOMAINS.some(domain => method.startsWith(domain))
}
