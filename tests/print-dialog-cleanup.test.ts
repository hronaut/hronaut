import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ webContents: { getFocusedWebContents: () => null } }))
vi.mock('../src/main/browser/agent-input-scope/focus-isolation.js', () => ({
  beginAgentFocusIsolation: () => () => undefined,
  restoreHumanFocusAfterAgentInput: () => undefined
}))
// The locked browser below stubs withDebugger, which the input guard reaches through this.
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/debugger-lease/debugger-lease.js')>(),
  withDebugger: (browser: { withDebugger: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.withDebugger(...args)
}))

const { withAgentInput } = await import('../src/main/browser/agent-input-scope/agent-input-scope.js')
const { watchCredentialSubmission } = await import('../src/main/browser/credential-capture/credential-capture.js')
const { guardPageCallsDuringPrintDialog, PrintDialogOpenError } = await import('../src/main/browser/print-dialog-guard.js')
const { PAGE_IPC } = await import('../src/shared/ipc/page.js')

/** A page whose calls the print dialog guard holds, recording what reaches it. */
function printablePage() {
  const scripts: string[] = []
  const commands: string[] = []
  let finishWatch = (_candidate: unknown): void => undefined
  const watches = vi.fn(() => new Promise((resolve) => { finishWatch = resolve }))
  const page = Object.assign(new EventEmitter(), {
    id: 7,
    mainFrame: { processId: 4, routingId: 1 },
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async (script: string) => { scripts.push(script); return true }),
    // The watch for a submitted sign-in form answers once the person submits one.
    executeJavaScriptInIsolatedWorld: watches,
    capturePage: vi.fn(async () => undefined),
    printToPDF: vi.fn(async () => Buffer.alloc(0)),
    debugger: {
      sendCommand: vi.fn(async (method: string) => {
        commands.push(method)
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 3 }
        return {}
      })
    }
  })
  guardPageCallsDuringPrintDialog(page as never)
  const print = (open: boolean): void => { page.emit('ipc-message', { senderFrame: page.mainFrame }, PAGE_IPC.printDialog, open) }
  return { page, scripts, commands, watches, print, submit: (candidate: unknown) => finishWatch(candidate) }
}

/** A browser showing the page in its one tab, with nothing focused. */
function agentInputBrowser(locked = false) {
  const agentInput = new Map<number, number>()
  const tab = { id: 'tab' }
  return {
    agentInput,
    browser: {
      window: { isFocused: () => false },
      agentInputWebContents: agentInput,
      agentInputFocusSnapshots: new Map(),
      agentInputFocusGuardReleases: new Map(),
      tabs: new Map([[tab.id, tab]]),
      webContentsToTab: new Map([[7, tab.id]]),
      isHumanInteractionLocked: () => locked
    }
  }
}

const SET_FLAG = 'window.__hronautAgentInputActive = true'
const CLEAR_FLAG = 'delete window.__hronautAgentInputActive'

// Cleanup an agent's input could not do while the page's print dialog held the page runs once the dialog closes.
describe('cleanup after a print dialog', () => {
  it('clears the agent input flag once the print dialog the agent opened closes', async () => {
    const { page, scripts, print } = printablePage()
    const { browser, agentInput } = agentInputBrowser()
    const click = withAgentInput(browser as never, page as never, async () => {
      print(true)
      throw new PrintDialogOpenError(true)
    })

    await expect(click).rejects.toBeInstanceOf(PrintDialogOpenError)
    expect(scripts).toEqual([SET_FLAG])
    expect(agentInput.size).toBe(0)
    print(false)
    await vi.waitFor(() => expect(scripts).toEqual([SET_FLAG, CLEAR_FLAG]))
  })

  // A sign-in page the person printed lost its watch, so the sign-in that followed offered no password save.
  it('keeps watching for a submitted sign-in form through a print dialog', async () => {
    const { page, watches, print, submit } = printablePage()
    const onCredentialSubmitted = vi.fn()
    const tab = { url: 'https://example.test/sign-in', webContents: page, lastHumanInteractionAt: performance.now() }
    watchCredentialSubmission({ options: { onCredentialSubmitted } } as never, tab as never)
    print(true)
    print(false)
    submit({ origin: 'https://example.test', username: 'ada', password: 'correct horse' })
    await vi.waitFor(() => expect(onCredentialSubmitted).toHaveBeenCalledWith({ origin: 'https://example.test', username: 'ada', password: 'correct horse' }))
    // It watches again after the submission.
    expect(watches).toHaveBeenCalledTimes(2)
  })

  it('leaves the flag to a new agent input that began before the dialog closed', async () => {
    const { page, scripts, print } = printablePage()
    const { browser, agentInput } = agentInputBrowser()
    await expect(withAgentInput(browser as never, page as never, async () => {
      print(true)
      throw new PrintDialogOpenError(true)
    })).rejects.toBeInstanceOf(PrintDialogOpenError)

    agentInput.set(page.id, 1)
    print(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(scripts).toEqual([SET_FLAG])
  })

  it('keeps the click\'s own error on a locked tab and restores the frames\' wheel guards after the dialog', async () => {
    const { page, commands, print } = printablePage()
    const tab = { id: 'tab', webContents: page }
    const { browser } = agentInputBrowser(true)
    // The input guard runs on the locked tab's page, under the browser's debugger.
    Object.assign(browser, {
      destroyed: false,
      tabs: new Map([[tab.id, tab]]),
      withDebugger: <T>(_page: unknown, operation: () => Promise<T>) => operation(),
      screenshotAreaSessions: new Map(),
      elementPickerSessions: new Map()
    })
    const click = withAgentInput(browser as never, page as never, async () => {
      print(true)
      throw new PrintDialogOpenError(true)
    })

    await expect(click).rejects.toMatchObject({ name: 'PrintDialogOpenError', sent: true })
    // The native barrier is applied by the browser process even while the dialog is open.
    expect(commands).toEqual(['Input.setIgnoreInputEvents'])
    print(false)
    await vi.waitFor(() => expect(commands).toEqual([
      'Input.setIgnoreInputEvents', 'Input.setIgnoreInputEvents', 'Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate'
    ]))
  })
})
