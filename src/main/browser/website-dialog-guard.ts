import type { Debugger, WebContents } from 'electron'
import { LocalizedError } from '../localized-error.js'
import { answeredByBrowserProcess } from './renderer-exit-guard.js'

/** A page script or DevTools command that cannot finish because the page is held by a website dialog. */
export class WebsiteDialogOpenError extends LocalizedError {
  /** Whether the call reached the page before the dialog opened; false when it was refused unsent. */
  readonly sent: boolean

  constructor(sent: boolean) {
    super(sent ? 'appErrors.page.websiteDialogOpenedDuringAction' : 'appErrors.page.websiteDialogOpenBeforeAction')
    this.name = 'WebsiteDialogOpenError'
    this.sent = sent
  }
}

interface WebsiteDialogState {
  open: boolean
  /** Resolvers of whenWebsiteDialogCloses, called when the hold ends. */
  closed: Array<() => void>
}

const states = new WeakMap<object, WebsiteDialogState>()

/** Whether a website dialog holds the page right now. */
export function websiteDialogHolds(page: object): boolean {
  return states.get(page)?.open === true
}

/**
 * Resolves once the page's website dialog closes, at once when it shows none. A new document, a new renderer, the
 * page's debugger detaching or the page going away also ends the hold. For cleanup that could not reach the page
 * while the dialog held it.
 */
export function whenWebsiteDialogCloses(page: object): Promise<void> {
  const state = states.get(page)
  if (!state?.open) return Promise.resolve()
  return new Promise(resolve => { state.closed.push(resolve) })
}

type GuardedPage = Pick<WebContents, 'executeJavaScript' | 'executeJavaScriptInIsolatedWorld'> & {
  on(event: 'render-process-gone' | 'did-navigate' | 'destroyed', listener: () => void): unknown
  debugger: Pick<Debugger, 'sendCommand'> & {
    on(event: 'message', listener: (event: unknown, method: string, params: { type?: string }, sessionId?: string) => void): unknown
    on(event: 'detach', listener: () => void): unknown
  }
}

/**
 * A website's alert or confirm holds the page's renderer until someone answers it: Chromium answers none of its
 * scripts or DevTools commands meanwhile, so an agent's call that met one never returned and kept its tab, debugger
 * queue and workspace busy until the person answered. Installed once on each tab's page after the print dialog guard,
 * this makes the calls in flight when such a dialog opens fail with WebsiteDialogOpenError and new ones fail at once,
 * unsent, until it closes. The page's debugger reports the dialog, so pages whose Developer Tools are open are not
 * guarded. A dialog that is answered at once, as one an agent's action answers or one turned down while Hronaut's own
 * screens cover the pages, holds nothing. Electron answers a prompt and a page asking before it unloads itself.
 * Commands the browser process answers, such as the dialog's own answer, the input commands, whose wait the agent's
 * input ends itself, and those for the page's workers and out-of-process frames still go through. Nothing is
 * retried; whenWebsiteDialogCloses lets cleanup run again once the dialog closes.
 */
export function guardPageCallsDuringWebsiteDialog(page: GuardedPage, answeredAtOnce: () => boolean): void {
  const state: WebsiteDialogState = { open: false, closed: [] }
  states.set(page, state)
  // Only calls in flight are held, so a long-lived page keeps nothing per call.
  const inFlight = new Set<(error: WebsiteDialogOpenError) => void>()
  const endHold = (): void => {
    state.open = false
    for (const resolve of state.closed.splice(0)) resolve()
  }
  page.debugger.on('message', (_event, method, params, sessionId) => {
    // A worker or an out-of-process frame reports through its own session; its dialog does not hold the page.
    if (sessionId) return
    if (method === 'Page.javascriptDialogClosed') {
      endHold()
      return
    }
    if (method !== 'Page.javascriptDialogOpening' || (params.type !== 'alert' && params.type !== 'confirm')) return
    if (answeredAtOnce()) return
    state.open = true
    const rejecters = [...inFlight]
    inFlight.clear()
    for (const reject of rejecters) reject(new WebsiteDialogOpenError(true))
  })
  // A detached debugger reports no close, and a new document or renderer is not held by the old page's dialog.
  page.debugger.on('detach', endHold)
  page.on('did-navigate', endHold)
  page.on('render-process-gone', endHold)
  page.on('destroyed', endHold)
  const settleBeforeDialog = <T>(call: () => Promise<T>): Promise<T> => {
    if (state.open) return Promise.reject(new WebsiteDialogOpenError(false))
    const pending = call()
    return new Promise<T>((resolve, reject) => {
      inFlight.add(reject)
      pending.then(resolve, reject).finally(() => inFlight.delete(reject))
    })
  }
  const executeJavaScript = page.executeJavaScript.bind(page)
  const executeJavaScriptInIsolatedWorld = page.executeJavaScriptInIsolatedWorld.bind(page)
  const sendCommand = page.debugger.sendCommand.bind(page.debugger)
  page.executeJavaScript = (...args) => settleBeforeDialog(() => executeJavaScript(...args))
  page.executeJavaScriptInIsolatedWorld = (...args) => settleBeforeDialog(() => executeJavaScriptInIsolatedWorld(...args))
  // A worker or an out-of-process frame has its own session and thread, which the page's dialog does not hold.
  page.debugger.sendCommand = (method, ...args) => answeredByBrowserProcess(method) || passesWebsiteDialog(method) || args[1]
    ? sendCommand(method, ...args)
    : settleBeforeDialog(() => sendCommand(method, ...args))
}

/** The dialog's own answer, and agent input, whose wait sendAuthorizedAgentInputCommand ends when a dialog opens. */
function passesWebsiteDialog(method: string): boolean {
  return method === 'Page.handleJavaScriptDialog' || method.startsWith('Input.')
}
