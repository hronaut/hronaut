import type { Debugger, WebContents } from 'electron'
import { PAGE_PRINT_DIALOG_CHANNEL } from '../../shared/page-print-dialog.js'
import { LocalizedError } from '../localized-error.js'
import { answeredByBrowserProcess } from './renderer-exit-guard.js'

/** A page script, DevTools command or capture that cannot finish because the page is held by its print dialog. */
export class PrintDialogOpenError extends LocalizedError {
  /** Whether the call reached the page before the dialog opened; false when it was refused unsent. */
  readonly sent: boolean

  constructor(sent: boolean) {
    super(sent ? 'appErrors.page.printDialogOpenedDuringAction' : 'appErrors.page.printDialogOpenBeforeAction')
    this.name = 'PrintDialogOpenError'
    this.sent = sent
  }
}

interface PrintDialogState {
  open: boolean
  /** Resolvers of whenPrintDialogCloses, called when the hold ends. */
  closed: Array<() => void>
}

const states = new WeakMap<object, PrintDialogState>()

/** Whether the page's print dialog holds it right now. */
export function printDialogHolds(page: object): boolean {
  return states.get(page)?.open === true
}

/**
 * Resolves once the page's print dialog closes, at once when it has none open. A new document, a new renderer or the
 * page going away also ends the hold. For cleanup that could not reach the page while the dialog held it.
 */
export function whenPrintDialogCloses(page: object): Promise<void> {
  const state = states.get(page)
  if (!state?.open) return Promise.resolve()
  return new Promise(resolve => { state.closed.push(resolve) })
}

interface FrameIdentity { processId: number; routingId: number }

type GuardedPage = Pick<WebContents, 'executeJavaScript' | 'executeJavaScriptInIsolatedWorld' | 'capturePage' | 'printToPDF'> & {
  on(event: 'ipc-message', listener: (event: { senderFrame?: FrameIdentity | null }, channel: string, ...args: unknown[]) => void): unknown
  on(event: 'render-process-gone' | 'did-navigate' | 'destroyed', listener: () => void): unknown
  readonly mainFrame: FrameIdentity
  debugger: Pick<Debugger, 'sendCommand'>
}

/**
 * A print dialog, the page's own window.print() or Hronaut's Print, holds the page's renderer until the person prints
 * or cancels: Chromium answers none of its scripts or DevTools commands meanwhile, so an agent's click on a Print
 * button never returned and kept its tab, debugger queue and workspace busy until the person closed the dialog.
 * Installed once on each tab's page after the renderer exit guard, this makes the calls in flight when the dialog
 * opens fail with PrintDialogOpenError and new ones fail at once, unsent, until it closes, so operations settle and
 * the workspace's other tabs keep working. The page's preload reports the main frame's trusted beforeprint and
 * afterprint; Hronaut's own PDF export prints without a dialog, so print events during one are not the dialog's.
 * Commands the browser process answers, and those for the page's workers and out-of-process frames, still go
 * through. Nothing is retried; whenPrintDialogCloses lets cleanup run again once the dialog closes.
 */
export function guardPageCallsDuringPrintDialog(page: GuardedPage): void {
  const state: PrintDialogState = { open: false, closed: [] }
  states.set(page, state)
  let pdfExports = 0
  // Only calls in flight are held, so a long-lived page keeps nothing per call.
  const inFlight = new Set<(error: PrintDialogOpenError) => void>()
  const endHold = (): void => {
    state.open = false
    for (const resolve of state.closed.splice(0)) resolve()
  }
  page.on('ipc-message', (event, channel, open) => {
    if (channel !== PAGE_PRINT_DIALOG_CHANNEL || typeof open !== 'boolean') return
    // Only the current main frame's dialog holds the page the guarded calls go to; a report from a frame a new
    // document replaced meanwhile does not.
    const sender = event.senderFrame
    if (!sender || sender.processId !== page.mainFrame.processId || sender.routingId !== page.mainFrame.routingId) return
    if (!open) {
      endHold()
      return
    }
    if (pdfExports > 0) return
    state.open = true
    const rejecters = [...inFlight]
    inFlight.clear()
    for (const reject of rejecters) reject(new PrintDialogOpenError(true))
  })
  // A new document, or a new renderer after a crash, is not held by the old page's dialog.
  page.on('did-navigate', endHold)
  page.on('render-process-gone', endHold)
  page.on('destroyed', endHold)
  const settleBeforeDialog = <T>(call: () => Promise<T>): Promise<T> => {
    if (state.open) return Promise.reject(new PrintDialogOpenError(false))
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
  page.executeJavaScript = (...args) => settleBeforeDialog(() => executeJavaScript(...args))
  page.executeJavaScriptInIsolatedWorld = (...args) => settleBeforeDialog(() => executeJavaScriptInIsolatedWorld(...args))
  page.capturePage = (...args: Parameters<typeof capturePage>) => settleBeforeDialog(() => capturePage(...args))
  page.printToPDF = (...args) => {
    if (state.open) return Promise.reject(new PrintDialogOpenError(false))
    pdfExports += 1
    return printToPDF(...args).finally(() => { pdfExports -= 1 })
  }
  // A worker or an out-of-process frame has its own session and thread, which the page's dialog does not hold.
  page.debugger.sendCommand = (method, ...args) => answeredByBrowserProcess(method) || args[1]
    ? sendCommand(method, ...args)
    : settleBeforeDialog(() => sendCommand(method, ...args))
}
