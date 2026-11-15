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
  const releases: Array<{ expression: string; contextId?: number }> = []
  const scripts: Array<{ expression: string; reject(error: Error): void }> = []
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
      sendCommand: vi.fn((_method: string, params: { expression: string; contextId?: number }) => {
        const release = params.expression.includes('return function releaseEvaluationDialogsInPage(') && !params.expression.includes('dialogAwareEvaluateInPage')
        evaluations.push(release ? 'release' : 'script')
        if (release) {
          releases.push(params)
          return Promise.resolve({})
        }
        return new Promise((_resolve, reject) => { scripts.push({ expression: params.expression, reject }) })
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
  // The release names the evaluation whose id went to the page function right before the release function.
  const releasedOwnEvaluation = (): void => {
    const evaluationId = /"([^"]+)",\s*\(\(\) => \{ 'use strict'; return function releaseEvaluationDialogsInPage\(/.exec(scripts[0]!.expression)?.[1]
    expect(evaluationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(releases).toHaveLength(1)
    expect(releases[0]).toMatchObject({ contextId: 1 })
    expect(releases[0]!.expression.endsWith(`("${evaluationId}")`)).toBe(true)
  }
  return { browser, evaluations, scripts, print, alertOpens, alertCloses, releasedOwnEvaluation }
}

// An agent's script that a page's print dialog or alert cut off kept running in the page with the page's alert, confirm
// and prompt answered for it, so after the dialog closed a confirm the person met on the page was answered without
// showing, until the script ended or the page loaded again.
describe('dialog handling of an agent\'s script a page\'s dialog cut off', () => {
  it('ends once the print dialog closes', async () => {
    const { browser, evaluations, print, releasedOwnEvaluation } = backgroundTabWithGuardedPage()
    const running = evaluate(browser, 'waitForReport()', 'tab', {}, { timeoutMs: 60_000 })
    await vi.waitFor(() => expect(evaluations).toEqual(['script']))
    print(true)
    await expect(running).rejects.toMatchObject({ name: 'PrintDialogOpenError', sent: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(evaluations).toEqual(['script'])

    print(false)
    await vi.waitFor(() => expect(evaluations).toEqual(['script', 'release']))
    releasedOwnEvaluation()
  })

  it('ends once a website alert is answered', async () => {
    const { browser, evaluations, alertOpens, alertCloses, releasedOwnEvaluation } = backgroundTabWithGuardedPage()
    const running = evaluate(browser, 'waitForReport()', 'tab', {}, { timeoutMs: 60_000 })
    await vi.waitFor(() => expect(evaluations).toEqual(['script']))
    const cutOff = expect(running).rejects.toMatchObject({ name: 'WebsiteDialogOpenError', sent: true })
    await alertOpens()
    await cutOff
    expect(evaluations).toEqual(['script'])

    alertCloses()
    await vi.waitFor(() => expect(evaluations).toEqual(['script', 'release']))
    releasedOwnEvaluation()
  })

  // Chromium stops waiting on a promise it collected unsettled, such as a script's that waits for nothing, and the
  // script's own release never runs.
  it('ends at once when Chromium stops tracking a script that never settles', async () => {
    const { browser, evaluations, scripts, releasedOwnEvaluation } = backgroundTabWithGuardedPage()
    const running = evaluate(browser, 'new Promise(() => {})', 'tab', {}, { timeoutMs: 60_000 })
    await vi.waitFor(() => expect(scripts).toHaveLength(1))
    scripts[0]!.reject(new Error('Promise was collected'))
    await expect(running).rejects.toThrow('Promise was collected')
    expect(evaluations).toEqual(['script', 'release'])
    releasedOwnEvaluation()
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
