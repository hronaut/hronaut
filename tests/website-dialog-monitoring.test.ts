import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { firstLoadStarts, holdUntilFirstLoad, RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'
import { ensureDialogMonitoring } from '../src/main/browser/website-dialogs/website-dialogs.js'
import { guardPageCallsDuringPrintDialog } from '../src/main/browser/print-dialog-guard.js'
import { PAGE_PRINT_DIALOG_CHANNEL } from '../src/shared/page-print-dialog.js'

function fixture() {
  const state = { crashed: true, attached: false }
  const commands: string[] = []
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    debugger: {
      isAttached: () => state.attached,
      attach: () => { state.attached = true },
      sendCommand: vi.fn(async (method: string) => {
        if (state.crashed && method !== 'Input.setIgnoreInputEvents') throw new RendererExitedError(false)
        commands.push(method)
        return method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'top' } } } : {}
      })
    }
  })
  const tab = { id: 'tab-1', webContents, networkDebuggerEnabled: false } as never as { webContents: typeof webContents; networkDebuggerEnabled: boolean; mainFrameId?: string }
  const attachments = new Map<number, Promise<void>>()
  const access = {
    isDestroyed: () => false,
    isDevToolsOpening: () => false,
    dialogMonitorAttachPromises: () => attachments,
    isHumanInteractionLocked: () => false,
    isAgentInput: () => false
  } as never
  return { state, commands, webContents, tab, access, attachments }
}

describe('dialog monitoring on a page whose renderer exited', () => {
  it('starts again on the next load without logging a failure', async () => {
    const f = fixture()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await ensureDialogMonitoring(f.access, f.tab as never)
      await ensureDialogMonitoring(f.access, f.tab as never)
      expect(f.tab.networkDebuggerEnabled).toBe(false)
      expect(f.webContents.listenerCount('dom-ready')).toBe(1)
      expect(error).not.toHaveBeenCalled()

      f.state.crashed = false
      f.webContents.emit('dom-ready')
      await f.attachments.get(7)
      expect(f.commands).toEqual(['Page.enable', 'Page.getFrameTree', 'Runtime.enable', 'Runtime.setAsyncCallStackDepth', 'Log.enable', 'Audits.enable', 'Network.enable', 'Input.setIgnoreInputEvents'])
      expect(f.tab).toMatchObject({ networkDebuggerEnabled: true, mainFrameId: 'top' })
      expect(f.webContents.listenerCount('dom-ready')).toBe(0)
    } finally {
      error.mockRestore()
    }
  })

  it('still reports other failures and does not wait for a load', async () => {
    const f = fixture()
    f.webContents.debugger.sendCommand.mockRejectedValueOnce(new Error('Protocol error'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await ensureDialogMonitoring(f.access, f.tab as never)
      expect(error).toHaveBeenCalledOnce()
      expect(f.webContents.listenerCount('dom-ready')).toBe(0)
    } finally {
      error.mockRestore()
    }
  })
})

// A page that prints as it opens, such as a receipt, held its renderer in the print dialog while monitoring started.
describe('dialog monitoring on a page its print dialog holds', () => {
  it('starts once the person closes the dialog, without logging a failure', async () => {
    const f = fixture()
    f.state.crashed = false
    const page = Object.assign(f.webContents, {
      mainFrame: { processId: 4, routingId: 1 },
      executeJavaScript: vi.fn(), executeJavaScriptInIsolatedWorld: vi.fn(), capturePage: vi.fn(), printToPDF: vi.fn()
    })
    guardPageCallsDuringPrintDialog(page as never)
    const print = (open: boolean): void => { page.emit('ipc-message', { senderFrame: page.mainFrame }, PAGE_PRINT_DIALOG_CHANNEL, open) }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      print(true)
      await ensureDialogMonitoring(f.access, f.tab as never)
      expect(f.tab.networkDebuggerEnabled).toBe(false)
      expect(f.commands).toEqual([])

      print(false)
      await vi.waitFor(() => expect(f.tab.networkDebuggerEnabled).toBe(true))
      expect(f.commands).toEqual(['Page.enable', 'Page.getFrameTree', 'Runtime.enable', 'Runtime.setAsyncCallStackDepth', 'Log.enable', 'Audits.enable', 'Network.enable', 'Input.setIgnoreInputEvents'])
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})

describe('dialog monitoring on a page that has not loaded yet', () => {
  // A tab restored asleep has no renderer until it wakes: its monitoring waited for one until then, and locking input
  // or any debugger operation on the tab waited with it.
  it('leaves the page alone until its first load starts, and is not waited for meanwhile', async () => {
    const f = fixture()
    f.state.crashed = false
    holdUntilFirstLoad(f.webContents)
    await ensureDialogMonitoring(f.access, f.tab as never)
    expect(f.state.attached).toBe(false)
    expect(f.commands).toEqual([])
    expect(f.attachments.size).toBe(0)
    expect(f.webContents.listenerCount('dom-ready')).toBe(0)

    firstLoadStarts(f.webContents)
    await ensureDialogMonitoring(f.access, f.tab as never)
    expect(f.state.attached).toBe(true)
    expect(f.commands).toEqual(['Page.enable', 'Page.getFrameTree', 'Runtime.enable', 'Runtime.setAsyncCallStackDepth', 'Log.enable', 'Audits.enable', 'Network.enable', 'Input.setIgnoreInputEvents'])
  })
})
