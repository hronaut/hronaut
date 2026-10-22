import { describe, expect, it } from 'vitest'
import { guardPageCallsDuringPrintDialog, PAGE_PRINT_DIALOG_CHANNEL, PrintDialogOpenError } from '../src/main/browser/print-dialog-guard.js'

function deferred(): { promise: Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void } {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function fakePage() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const calls: Array<{ kind: string; args: unknown[]; reply: ReturnType<typeof deferred> }> = []
  const record = (kind: string) => (...args: unknown[]) => {
    const reply = deferred()
    calls.push({ kind, args, reply })
    return reply.promise
  }
  const page = {
    on: (event: string, listener: (...args: unknown[]) => void) => { listeners.set(event, [...(listeners.get(event) ?? []), listener]) },
    executeJavaScript: record('script'),
    executeJavaScriptInIsolatedWorld: record('isolated'),
    capturePage: record('capture'),
    printToPDF: record('pdf'),
    debugger: { sendCommand: record('command') }
  }
  guardPageCallsDuringPrintDialog(page as never)
  const emit = (event: string, ...args: unknown[]): void => { for (const listener of listeners.get(event) ?? []) listener(...args) }
  // What the page's preload sends on the browser's beforeprint (true) and afterprint (false).
  const printEvent = (open: unknown, channel = PAGE_PRINT_DIALOG_CHANNEL): void => emit('ipc-message', {}, channel, open)
  return { page, calls, emit, printEvent }
}

// An agent's click on a page's Print button never returned: window.print() holds the renderer in the system's print
// dialog, so the click, every later call on the tab and the workspace's lease waited until the person closed it.
describe('page calls during a print dialog', () => {
  it('lets the scripts, commands and captures waiting on the page go when its print dialog opens', async () => {
    const { page, printEvent } = fakePage()
    const click = page.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1 })
    const script = page.executeJavaScript('1', true)
    const isolated = page.executeJavaScriptInIsolatedWorld(7, [{ code: '2' }], true)
    const capture = page.capturePage()
    printEvent(true)
    await expect(click).rejects.toMatchObject({ name: 'PrintDialogOpenError', sent: true })
    await expect(click).rejects.toThrow('The page opened its print dialog during this action')
    await expect(script).rejects.toMatchObject({ sent: true })
    await expect(isolated).rejects.toBeInstanceOf(PrintDialogOpenError)
    await expect(capture).rejects.toBeInstanceOf(PrintDialogOpenError)
  })

  it('refuses new calls unsent while the dialog is open and reaches the page again once it closes', async () => {
    const { page, calls, printEvent } = fakePage()
    printEvent(true)
    await expect(page.debugger.sendCommand('Page.getFrameTree')).rejects.toMatchObject({ name: 'PrintDialogOpenError', sent: false })
    await expect(page.executeJavaScript('1')).rejects.toThrow('nothing was sent to it')
    await expect(page.capturePage()).rejects.toBeInstanceOf(PrintDialogOpenError)
    await expect(page.printToPDF({})).rejects.toBeInstanceOf(PrintDialogOpenError)
    expect(calls).toEqual([])

    printEvent(false)
    const command = page.debugger.sendCommand('Page.getFrameTree')
    expect(calls.map(call => call.kind)).toEqual(['command'])
    calls[0]!.reply.resolve({ frameTree: {} })
    await expect(command).resolves.toEqual({ frameTree: {} })
  })

  it('keeps the commands the browser process answers working while the dialog is open', async () => {
    const { page, calls, printEvent } = fakePage()
    const ignoring = page.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: true })
    printEvent(true)
    const cookies = page.debugger.sendCommand('Network.getAllCookies')
    const route = page.debugger.sendCommand('Fetch.continueRequest', { requestId: '1' })
    expect(calls.map(call => call.args[0])).toEqual(['Input.setIgnoreInputEvents', 'Network.getAllCookies', 'Fetch.continueRequest'])
    for (const call of calls) call.reply.resolve({})
    await expect(ignoring).resolves.toEqual({})
    await expect(cookies).resolves.toEqual({})
    await expect(route).resolves.toEqual({})
  })

  it('does not take a PDF export, which prints without a dialog, for the dialog', async () => {
    const { page, calls, printEvent } = fakePage()
    const pdf = page.printToPDF({})
    printEvent(true)
    const script = page.executeJavaScript('document.title')
    printEvent(false)
    expect(calls.map(call => call.kind)).toEqual(['pdf', 'script'])
    calls[0]!.reply.resolve(Buffer.from('%PDF'))
    calls[1]!.reply.resolve('Title')
    await expect(pdf).resolves.toEqual(Buffer.from('%PDF'))
    await expect(script).resolves.toBe('Title')

    // Once the export is done, the page's own print dialog counts again.
    printEvent(true)
    await expect(page.executeJavaScript('1')).rejects.toBeInstanceOf(PrintDialogOpenError)
  })

  it('ends the hold for a new document or a new renderer', async () => {
    const { page, calls, emit, printEvent } = fakePage()
    printEvent(true)
    emit('did-navigate')
    const script = page.executeJavaScript('1')
    printEvent(true)
    await expect(script).rejects.toBeInstanceOf(PrintDialogOpenError)
    emit('render-process-gone')
    void page.debugger.sendCommand('Page.getFrameTree')
    expect(calls.map(call => call.kind)).toEqual(['script', 'command'])
  })

  it('ignores other page messages and a malformed print report', async () => {
    const { page, calls, printEvent } = fakePage()
    printEvent(true, 'hronaut:page-exception')
    printEvent('true')
    printEvent(1)
    void page.executeJavaScript('1')
    expect(calls.map(call => call.kind)).toEqual(['script'])
  })

  it('settles a call normally when the page answers before any dialog', async () => {
    const { page, calls, printEvent } = fakePage()
    const script = page.executeJavaScript('1')
    calls[0]!.reply.resolve(1)
    await expect(script).resolves.toBe(1)
    printEvent(true)
    // A call that already settled is not reported again.
    await expect(script).resolves.toBe(1)
  })
})
