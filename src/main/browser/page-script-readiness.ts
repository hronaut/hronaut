import type { WebContents } from 'electron'
import { pageLoadTimedOut } from './http-auth/http-auth.js'
import { PAGE_LOAD_WAIT_MS } from './page-waits/page-load-limit.js'

type ReadinessEvent = 'dom-ready' | 'did-stop-loading' | 'did-navigate' | 'render-process-gone' | 'destroyed'

type ReadinessPage = Pick<WebContents, 'isDestroyed' | 'getURL' | 'isLoadingMainFrame' | 'isWaitingForResponse' | 'executeJavaScript'
  | 'executeJavaScriptInIsolatedWorld'> & {
  on(event: 'did-start-navigation', listener: (event: unknown, url: string, isSameDocument: boolean, isMainFrame: boolean) => void): unknown
  on(event: 'did-fail-provisional-load', listener: (event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => void): unknown
  on(event: ReadinessEvent, listener: () => void): unknown
}

// How long a navigation whose request has ended may take to show its document before it counts as ended without one,
// as a 204 response, a download or a refused address ends without any event saying so. A busy page or a slow new
// renderer can take a moment to show the document. And how often waiting calls look again.
const NAVIGATION_SHOW_GRACE_MS = 3_000
const RECHECK_MS = 250

/**
 * Electron holds a page's executeJavaScript and executeJavaScriptInIsolatedWorld calls until its main frame stops
 * loading. On a page whose load never ends, such as one with an image its server never answers, every page script
 * then waited forever, and with it the agent's call, its tab activity and its workspace. Installed once on each tab's
 * page, this runs a call once the shown document is ready (its DOMContentLoaded), as DevTools does, while the page's
 * resources still load. While the tab opens another document, a call waits for that document, or, when the
 * navigation ends without one, runs in the document the tab still shows. A call never waits longer than
 * PAGE_LOAD_WAIT_MS: it then runs in the document the tab shows, or fails while the next one is still awaited from
 * its server, as it would act on a page about to go, or when the tab shows none.
 */
export function runPageScriptsOnceDocumentReady(page: ReadinessPage): void {
  let documentReady = false
  // A document the tab is opening, which has neither replaced the shown one nor failed yet. The shown document can
  // still become ready after it starts, as when a script in its head opens another address, and stays if it fails.
  let navigationPending = false
  let requestEndedAt: number | undefined
  const endNavigation = (): void => {
    navigationPending = false
    requestEndedAt = undefined
  }
  const navigationGoingOn = (): boolean => {
    if (!navigationPending) return false
    if (page.isWaitingForResponse()) {
      requestEndedAt = undefined
      return true
    }
    requestEndedAt ??= Date.now()
    if (Date.now() - requestEndedAt < NAVIGATION_SHOW_GRACE_MS) return true
    endNavigation()
    return false
  }
  const waiting = new Set<(gone: boolean) => void>()
  let recheckTimer: ReturnType<typeof setInterval> | undefined
  const changed = (gone = false): void => {
    for (const recheck of [...waiting]) recheck(gone)
  }
  page.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
    if (!isMainFrame || isSameDocument) return
    navigationPending = true
    requestEndedAt = undefined
  })
  page.on('did-navigate', () => {
    endNavigation()
    documentReady = false
  })
  // Electron says this once a main-frame navigation that failed shows its error page, which then loads as any page.
  page.on('did-fail-provisional-load', (_event, _code, _description, _url, isMainFrame) => {
    if (!isMainFrame) return
    endNavigation()
    documentReady = false
  })
  page.on('dom-ready', () => {
    documentReady = true
    changed()
  })
  page.on('did-stop-loading', () => {
    endNavigation()
    documentReady = true
    changed()
  })
  // A call made now fails at once, as the renderer exit guard makes it.
  page.on('render-process-gone', () => changed(true))
  page.on('destroyed', () => changed(true))

  // Electron decides whether to hold a call by asking the page whether its main frame is loading, at the start of the
  // call. Only for that moment, and only once the call may run, the answer leaves out the page's resources.
  const isLoadingMainFrame = page.isLoadingMainFrame.bind(page)
  let startingReadyCall = false
  page.isLoadingMainFrame = () => !startingReadyCall && isLoadingMainFrame()
  const startReadyCall = <T>(call: () => Promise<T>): Promise<T> => {
    startingReadyCall = true
    try {
      return call()
    } finally {
      startingReadyCall = false
    }
  }
  const mayRun = (): boolean => page.isDestroyed() || !isLoadingMainFrame() || (documentReady && !navigationGoingOn())
  const whenReady = <T>(call: () => Promise<T>): Promise<T> => {
    if (mayRun()) return startReadyCall(call)
    return new Promise<T>((resolve, reject) => {
      const run = (waitEnded = false): void => {
        waiting.delete(recheck)
        clearTimeout(limit)
        if (!waiting.size) {
          clearInterval(recheckTimer)
          recheckTimer = undefined
        }
        if (waitEnded && !page.isDestroyed() && (!page.getURL() || (navigationPending && page.isWaitingForResponse()))) {
          reject(pageLoadTimedOut(page))
          return
        }
        try {
          startReadyCall(call).then(resolve, reject)
        } catch (error) {
          reject(error)
        }
      }
      const recheck = (gone: boolean): void => {
        if (gone || mayRun()) run()
      }
      const limit = setTimeout(() => run(true), PAGE_LOAD_WAIT_MS)
      waiting.add(recheck)
      recheckTimer ??= setInterval(changed, RECHECK_MS)
    })
  }
  const executeJavaScript = page.executeJavaScript.bind(page)
  const executeJavaScriptInIsolatedWorld = page.executeJavaScriptInIsolatedWorld.bind(page)
  page.executeJavaScript = (...args) => whenReady(() => executeJavaScript(...args))
  page.executeJavaScriptInIsolatedWorld = (...args) => whenReady(() => executeJavaScriptInIsolatedWorld(...args))
}
