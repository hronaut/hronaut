import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ webContents: { getFocusedWebContents: () => null } }))
vi.mock('../src/main/browser/agent-input-scope/focus-isolation.js', () => ({
  beginAgentFocusIsolation: () => () => undefined,
  restoreHumanFocusAfterAgentInput: () => undefined
}))

const { withAgentInput } = await import('../src/main/browser/agent-input-scope/agent-input-scope.js')
const { syncHumanInteractionInputGuard } = await import('../src/main/browser/interaction-lock/human-input-guard.js')
const { guardPageCallsDuringPrintDialog, PrintDialogOpenError } = await import('../src/main/browser/print-dialog-guard.js')
const { PAGE_PRINT_DIALOG_CHANNEL } = await import('../src/shared/page-print-dialog.js')

/** A page whose calls the print dialog guard holds, recording what reaches it. */
function printablePage() {
  const scripts: string[] = []
  const commands: string[] = []
  const page = Object.assign(new EventEmitter(), {
    id: 7,
    mainFrame: { processId: 4, routingId: 1 },
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async (script: string) => { scripts.push(script); return true }),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined),
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
  const print = (open: boolean): void => { page.emit('ipc-message', { senderFrame: page.mainFrame }, PAGE_PRINT_DIALOG_CHANNEL, open) }
  return { page, scripts, commands, print }
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
      isHumanInteractionLocked: () => locked,
      syncHumanInteractionInputGuard: vi.fn(async (): Promise<void> => undefined)
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
    const lockAccess = {
      isDestroyed: () => false,
      findTab: () => tab,
      isHumanInteractionLocked: () => true,
      withDebugger: <T>(_page: unknown, operation: () => Promise<T>) => operation(),
      screenshotAreaSessions: () => new Map(),
      elementPickerSessions: () => new Map()
    }
    const { browser } = agentInputBrowser(true)
    browser.syncHumanInteractionInputGuard.mockImplementation(() => syncHumanInteractionInputGuard(lockAccess as never, tab as never))
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
