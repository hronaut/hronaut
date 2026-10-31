import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { BrowserDebuggerQueue } from '../src/main/browser/debugger-queue.js'
import { closeWebsiteDialogBox, handleDialog, withOptionalDialogHandling } from '../src/main/browser/website-dialogs/website-dialogs.js'

// The debugger reports a website dialog before Electron handles it. Electron shows a box for an alert or confirm, and
// answers a page asking before it unloads, or a prompt, itself at once. Answering through the debugger closes the
// dialog but not Electron's box, which Hronaut closes as the dialog closes.

type DialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload'

function fixture() {
  const events: string[] = []
  let showing = false
  const debuggerEvents = new EventEmitter()
  const close = (by: string) => {
    showing = false
    events.push(`closed by ${by}`)
    debuggerEvents.emit('message', {}, 'Page.javascriptDialogClosed', {})
  }
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    debugger: Object.assign(debuggerEvents, {
      isAttached: () => true,
      // Chromium closes the dialog, and reports it closed, before the command returns.
      sendCommand: vi.fn(async (method: string, params?: { accept: boolean }) => {
        if (method !== 'Page.handleJavaScriptDialog') return {}
        if (!showing) throw new Error('No dialog is showing')
        close(params?.accept ? 'accept' : 'dismiss')
        return {}
      })
    })
  })
  webContents.on('-cancel-dialogs', () => events.push('box closed'))
  // As the page's debugger events do.
  debuggerEvents.on('message', (_event: unknown, method: string) => {
    if (method === 'Page.javascriptDialogClosed') closeWebsiteDialogBox(webContents as never)
  })
  const tab = { id: 'tab-1', webContents }
  const browser = {
    destroyed: false,
    debuggerQueue: new BrowserDebuggerQueue(),
    dialogMonitorAttachPromises: new Map<number, Promise<void>>(),
    devToolsOpening: new Set<number>(),
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id
  } as never

  /** The page opens a dialog; Electron handles it once the debugger's listeners and their microtasks have run. */
  function pageOpens(type: DialogType, electron: 'shows a box' | 'answers it' | 'turns it down'): void {
    showing = true
    debuggerEvents.emit('message', {}, 'Page.javascriptDialogOpening', { type, message: 'Unsaved draft' })
    setImmediate(() => {
      if (electron === 'shows a box') events.push('box shown')
      else if (showing) close(electron === 'answers it' ? 'Electron' : 'Electron, the site is blocked')
    })
  }
  return { events, webContents, tab, browser, pageOpens, close }
}

describe('answering website dialogs through the debugger', () => {
  it.each(['alert', 'confirm'] as const)('answers an agent\'s %s once its box shows, and closes the box', async (type) => {
    const f = fixture()
    await withOptionalDialogHandling(f.browser, f.webContents as never, { dialogAction: 'accept' }, async () => {
      f.pageOpens(type, 'shows a box')
    })
    expect(f.events).toEqual(['box shown', 'closed by accept', 'box closed'])
  })

  it.each(['beforeunload', 'prompt'] as const)('answers an agent\'s %s before Electron answers it itself', async (type) => {
    const f = fixture()
    await withOptionalDialogHandling(f.browser, f.webContents as never, { dialogAction: 'accept', promptText: 'typed' }, async () => {
      f.pageOpens(type, 'answers it')
    })
    expect(f.events).toEqual(['closed by accept', 'box closed'])
    expect(f.webContents.debugger.sendCommand).toHaveBeenCalledWith('Page.handleJavaScriptDialog', { accept: true, promptText: 'typed' })
  })

  it('leaves an alert Electron turned down at once, as for a blocked site, without failing the agent\'s action', async () => {
    const f = fixture()
    await expect(withOptionalDialogHandling(f.browser, f.webContents as never, { dialogAction: 'accept' }, async () => {
      f.pageOpens('alert', 'turns it down')
      return 'clicked'
    })).resolves.toBe('clicked')
    expect(f.events).toEqual(['closed by Electron, the site is blocked'])
    expect(f.webContents.debugger.sendCommand).not.toHaveBeenCalledWith('Page.handleJavaScriptDialog', expect.anything())
  })

  it('closes the box of an alert the agent answers with browser_dialog', async () => {
    const f = fixture()
    f.pageOpens('alert', 'shows a box')
    await new Promise((resolve) => setImmediate(resolve))
    await handleDialog(f.browser, 'dismiss', f.tab.id)
    expect(f.events).toEqual(['box shown', 'closed by dismiss', 'box closed'])
  })

  it('closes no box for a dialog the person answered in it', async () => {
    const f = fixture()
    f.pageOpens('confirm', 'shows a box')
    await new Promise((resolve) => setImmediate(resolve))
    f.close('the person')
    expect(f.events).toEqual(['box shown', 'closed by the person'])
  })

  it('closes no box later when an answer found no dialog', async () => {
    const f = fixture()
    await expect(handleDialog(f.browser, 'accept', f.tab.id)).rejects.toThrow('No dialog is showing')
    f.pageOpens('alert', 'shows a box')
    await new Promise((resolve) => setImmediate(resolve))
    f.close('the person')
    expect(f.events).toEqual(['box shown', 'closed by the person'])
  })
})
