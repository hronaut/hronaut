import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { callThroughPageDialogs } from '../src/main/browser/page-dialog-waits.js'
import { runPageScriptsOnceDocumentReady } from '../src/main/browser/page-script-readiness.js'
import { guardPageCallsDuringPrintDialog, PrintDialogOpenError } from '../src/main/browser/print-dialog-guard.js'
import { guardPageCallsDuringWebsiteDialog, WebsiteDialogOpenError } from '../src/main/browser/website-dialog-guard.js'
import { PAGE_IPC } from '../src/shared/ipc/page.js'

/** A page still loading its first document, wrapped by the dialog guards and the readiness wait as a tab's page is. */
function guardedLoadingPage() {
  const scripts: Array<{ code: string; answer(value: unknown): void }> = []
  const debuggerEvents = new EventEmitter()
  const page = Object.assign(new EventEmitter(), {
    id: 7,
    loading: true,
    mainFrame: { processId: 4, routingId: 1 },
    isDestroyed: () => false,
    getURL: () => 'https://example.test/sign-in',
    isLoadingMainFrame: () => page.loading,
    isWaitingForResponse: () => false,
    executeJavaScript: (code: string) => new Promise((resolve) => { scripts.push({ code, answer: resolve }) }),
    executeJavaScriptInIsolatedWorld: (_worldId: number, sources: Array<{ code: string }>) =>
      new Promise((resolve) => { scripts.push({ code: sources.map(source => source.code).join(''), answer: resolve }) }),
    capturePage: async () => undefined,
    printToPDF: async () => Buffer.alloc(0),
    debugger: Object.assign(debuggerEvents, { sendCommand: async () => ({}) })
  })
  // The order attachTabEvents installs them in.
  guardPageCallsDuringPrintDialog(page as never)
  guardPageCallsDuringWebsiteDialog(page as never, () => false)
  runPageScriptsOnceDocumentReady(page as never)
  const print = (open: boolean): void => { page.emit('ipc-message', { senderFrame: page.mainFrame }, PAGE_IPC.printDialog, open) }
  const alertOpens = async (): Promise<void> => {
    debuggerEvents.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Saved' })
    await new Promise(resolve => setImmediate(resolve))
  }
  const alertCloses = (): void => { debuggerEvents.emit('message', {}, 'Page.javascriptDialogClosed', { result: true }) }
  return { page, scripts, print, alertOpens, alertCloses }
}

// The person's element pick, area selection or sign-in watch that started before the page's document was ready lost
// its pass-through while it waited, so the page's print dialog or alert failed it and left Hronaut's overlay behind.
describe('calls that wait for the person through the page\'s dialogs', () => {
  it('keep passing both dialogs when they wait for the document first', async () => {
    const { page, scripts, print, alertOpens, alertCloses } = guardedLoadingPage()
    const pick = callThroughPageDialogs(() => page.executeJavaScript('pick'))
    const other = page.executeJavaScript('other')
    const otherSettled = other.then(() => 'answered', (error: unknown) => error)
    expect(scripts).toEqual([])

    page.emit('dom-ready')
    await expect.poll(() => scripts.map(script => script.code)).toEqual(['pick', 'other'])
    print(true)
    expect(await otherSettled).toBeInstanceOf(PrintDialogOpenError)
    // Other calls are still refused meanwhile.
    await expect(page.executeJavaScript('later')).rejects.toBeInstanceOf(PrintDialogOpenError)
    print(false)
    await alertOpens()
    await expect(page.executeJavaScript('later')).rejects.toBeInstanceOf(WebsiteDialogOpenError)
    alertCloses()

    scripts[0]!.answer({ canceled: true })
    await expect(pick).resolves.toEqual({ canceled: true })
  })

  it('keep the pass-through for the rest of a call that makes another one through it', async () => {
    const { page, scripts, print } = guardedLoadingPage()
    page.loading = false
    print(true)
    const outer = callThroughPageDialogs(() => {
      void callThroughPageDialogs(() => page.executeJavaScript('inner'))
      return page.executeJavaScript('outer')
    })
    expect(scripts.map(script => script.code)).toEqual(['inner', 'outer'])
    scripts[1]!.answer('done')
    await expect(outer).resolves.toBe('done')
  })
})
