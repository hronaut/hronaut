import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/browser/agent-input-scope/focus-isolation.js', () => ({
  withBackgroundAgentFocusGuard: <T>(_browser: unknown, operation: () => Promise<T>): Promise<T> => operation()
}))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', () => ({
  withDebugger: <T>(_browser: unknown, _page: unknown, operation: () => Promise<T>): Promise<T> => operation()
}))
// The evaluation goes through the page's debugger, as the real one does, so the page's dialog guards see it.
vi.mock('../src/main/browser/debugger-evaluation/debugger-evaluation.js', () => ({
  mainWorldContextId: async () => 1,
  evaluateWithAttachedDebugger: (page: { debugger: { sendCommand(method: string, params: object): Promise<unknown> } }, expression: string, contextId?: number) =>
    page.debugger.sendCommand('Runtime.evaluate', { expression, contextId, awaitPromise: true })
}))

const { evaluate } = await import('../src/main/browser/page-evaluation/evaluate.js')
const { guardPageCallsDuringPrintDialog } = await import('../src/main/browser/print-dialog-guard.js')
const { guardPageCallsDuringWebsiteDialog } = await import('../src/main/browser/website-dialog-guard.js')
const { PAGE_IPC } = await import('../src/shared/ipc/page.js')

/** A background tab whose page the dialog guards hold, recording the evaluations that reach it. */
function backgroundTabWithGuardedPage() {
  const evaluations: string[] = []
  const debuggerEvents = new EventEmitter()
  const page = Object.assign(new EventEmitter(), {
    id: 7,
    mainFrame: { processId: 4, routingId: 1 },
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    executeJavaScript: vi.fn(async () => undefined),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined),
    capturePage: vi.fn(async () => undefined),
    printToPDF: vi.fn(async () => Buffer.alloc(0)),
    // The agent's script waits on the page, and releasing its dialog handling answers at once.
    debugger: Object.assign(debuggerEvents, {
      sendCommand: vi.fn((_method: string, params: { expression: string }) => {
        const release = params.expression.includes('return function releaseEvaluationDialogsInPage(') && !params.expression.includes('dialogAwareEvaluateInPage')
        evaluations.push(release ? 'release' : 'script')
        return release ? Promise.resolve({}) : new Promise(() => undefined)
      })
    })
  })
  guardPageCallsDuringPrintDialog(page as never)
  guardPageCallsDuringWebsiteDialog(page as never, () => false)
  const browser = {
    tabs: new Map([['tab', { id: 'tab', webContents: page }]]),
    activeTabId: 'tab',
    window: { isFocused: () => false },
    devToolsOpening: new Set<number>()
  } as never as Parameters<typeof evaluate>[0]
  const print = (open: boolean): void => { page.emit('ipc-message', { senderFrame: page.mainFrame }, PAGE_IPC.printDialog, open) }
  const alertOpens = async (): Promise<void> => {
    debuggerEvents.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Saved' })
    await new Promise(resolve => setImmediate(resolve))
  }
  const alertCloses = (): void => { debuggerEvents.emit('message', {}, 'Page.javascriptDialogClosed', { result: true }) }
  return { browser, evaluations, print, alertOpens, alertCloses }
}

// An agent's script that a page's print dialog or alert cut off kept running in the page with the page's alert, confirm
// and prompt answered for it, so after the dialog closed a confirm the person met on the page was answered without
// showing, until the script ended or the page loaded again.
describe('dialog handling of an agent\'s script a page\'s dialog cut off', () => {
  it('ends once the print dialog closes', async () => {
    const { browser, evaluations, print } = backgroundTabWithGuardedPage()
    const running = evaluate(browser, 'waitForReport()', 'tab', {}, { timeoutMs: 60_000 })
    await vi.waitFor(() => expect(evaluations).toEqual(['script']))
    print(true)
    await expect(running).rejects.toMatchObject({ name: 'PrintDialogOpenError', sent: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(evaluations).toEqual(['script'])

    print(false)
    await vi.waitFor(() => expect(evaluations).toEqual(['script', 'release']))
  })

  it('ends once a website alert is answered', async () => {
    const { browser, evaluations, alertOpens, alertCloses } = backgroundTabWithGuardedPage()
    const running = evaluate(browser, 'waitForReport()', 'tab', {}, { timeoutMs: 60_000 })
    await vi.waitFor(() => expect(evaluations).toEqual(['script']))
    const cutOff = expect(running).rejects.toMatchObject({ name: 'WebsiteDialogOpenError', sent: true })
    await alertOpens()
    await cutOff
    expect(evaluations).toEqual(['script'])

    alertCloses()
    await vi.waitFor(() => expect(evaluations).toEqual(['script', 'release']))
  })

  it('is not released for a script the dialog kept from the page', async () => {
    const { browser, evaluations, print } = backgroundTabWithGuardedPage()
    print(true)
    await expect(evaluate(browser, 'waitForReport()', 'tab', {}, { timeoutMs: 60_000 })).rejects.toMatchObject({ name: 'PrintDialogOpenError', sent: false })
    print(false)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(evaluations).toEqual([])
  })
})
