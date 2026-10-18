import type { Debugger, WebContents } from 'electron'

/** A page script or DevTools command that cannot finish because the page's renderer exited. */
export class RendererExitedError extends Error {
  constructor() {
    super('The page stopped because its renderer exited. Reload or close the tab, then inspect fresh state; effects of this action are unknown.')
    this.name = 'RendererExitedError'
  }
}

type GuardedPage = Pick<WebContents, 'isDestroyed' | 'isCrashed' | 'executeJavaScript' | 'executeJavaScriptInIsolatedWorld'> & {
  on(event: 'render-process-gone', listener: () => void): unknown
  debugger: Pick<Debugger, 'sendCommand'>
}

// The input barrier lives in the browser process, not the renderer, so it
// still follows the person's lock while the page is gone.
const BROWSER_PROCESS_COMMANDS = new Set(['Input.setIgnoreInputEvents'])

/**
 * Electron never settles a page's executeJavaScript or
 * executeJavaScriptInIsolatedWorld call once its renderer exits, and holds
 * renderer DevTools commands until the next load. An operation awaiting one
 * would keep its tab, debugger queue and workspace busy indefinitely.
 * Installed once on each tab's page, this makes those calls fail with
 * RendererExitedError when the renderer exits and fail at once while it stays
 * gone, so operations settle and run their cleanup. A new load starts a new
 * renderer and calls work again. Nothing is retried or replayed.
 */
export function guardPageCallsAcrossRendererExit(page: GuardedPage): void {
  let exit = rendererExit()
  page.on('render-process-gone', () => {
    exit.reject(new RendererExitedError())
    exit = rendererExit()
  })
  const settleBeforeExit = <T>(call: () => Promise<T>): Promise<T> => {
    if (!page.isDestroyed() && page.isCrashed()) return Promise.reject(new RendererExitedError())
    return Promise.race([call(), exit.promise])
  }
  const executeJavaScript = page.executeJavaScript.bind(page)
  const executeJavaScriptInIsolatedWorld = page.executeJavaScriptInIsolatedWorld.bind(page)
  const sendCommand = page.debugger.sendCommand.bind(page.debugger)
  page.executeJavaScript = (...args) => settleBeforeExit(() => executeJavaScript(...args))
  page.executeJavaScriptInIsolatedWorld = (...args) => settleBeforeExit(() => executeJavaScriptInIsolatedWorld(...args))
  page.debugger.sendCommand = (method, ...args) => BROWSER_PROCESS_COMMANDS.has(method)
    ? sendCommand(method, ...args)
    : settleBeforeExit(() => sendCommand(method, ...args))
}

function rendererExit(): { promise: Promise<never>; reject(error: Error): void } {
  let reject!: (error: Error) => void
  const promise = new Promise<never>((_resolve, rejectExit) => { reject = rejectExit })
  // Only the calls racing it observe the rejection.
  promise.catch(() => undefined)
  return { promise, reject }
}
