import type { Debugger, WebContents } from 'electron'
import { LocalizedError } from '../localized-error.js'
import { answeredByBrowserProcess } from './renderer-exit-guard.js'

/** The channel the page's preload reports the page's print dialog opening (true) and closing (false) on. */
export const PAGE_PRINT_DIALOG_CHANNEL = 'hronaut:page-print'

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

type GuardedPage = Pick<WebContents, 'executeJavaScript' | 'executeJavaScriptInIsolatedWorld' | 'capturePage' | 'printToPDF'> & {
  on(event: 'ipc-message', listener: (event: unknown, channel: string, ...args: unknown[]) => void): unknown
  on(event: 'render-process-gone' | 'did-navigate', listener: () => void): unknown
  debugger: Pick<Debugger, 'sendCommand'>
}

/**
 * A print dialog, the page's own window.print() or Hronaut's Print, holds the page's renderer until the person prints
 * or cancels: Chromium answers none of its scripts or DevTools commands meanwhile, so an agent's click on a Print
 * button never returned and kept its tab, debugger queue and workspace busy until the person closed the dialog.
 * Installed once on each tab's page after the renderer exit guard, this makes the calls in flight when the dialog
 * opens fail with PrintDialogOpenError and new ones fail at once, unsent, until it closes, so operations settle and
 * the workspace's other tabs keep working. The page's preload reports the trusted beforeprint and afterprint events;
 * Hronaut's own PDF export prints without a dialog, so its print events are not the dialog's. Nothing is retried.
 */
export function guardPageCallsDuringPrintDialog(page: GuardedPage): void {
  let dialogOpen = false
  let pdfExports = 0
  // Only calls in flight are held, so a long-lived page keeps nothing per call.
  const inFlight = new Set<(error: PrintDialogOpenError) => void>()
  page.on('ipc-message', (_event, channel, open) => {
    if (channel !== PAGE_PRINT_DIALOG_CHANNEL || typeof open !== 'boolean') return
    if (open && pdfExports > 0) return
    dialogOpen = open
    if (!open) return
    const rejecters = [...inFlight]
    inFlight.clear()
    for (const reject of rejecters) reject(new PrintDialogOpenError(true))
  })
  // A new document, or a new renderer after a crash, is not held by the old page's dialog.
  page.on('did-navigate', () => { dialogOpen = false })
  page.on('render-process-gone', () => { dialogOpen = false })
  const settleBeforeDialog = <T>(call: () => Promise<T>): Promise<T> => {
    if (dialogOpen) return Promise.reject(new PrintDialogOpenError(false))
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
    if (dialogOpen) return Promise.reject(new PrintDialogOpenError(false))
    pdfExports += 1
    return printToPDF(...args).finally(() => { pdfExports -= 1 })
  }
  page.debugger.sendCommand = (method, ...args) => answeredByBrowserProcess(method)
    ? sendCommand(method, ...args)
    : settleBeforeDialog(() => sendCommand(method, ...args))
}
