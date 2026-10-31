import type { WebContents } from 'electron'
import type { BrowserDialogAction, BrowserDialogHandlingOptions } from '../../../shared/types.js'
import { heldUntilFirstLoad, RendererExitedError } from '../renderer-exit-guard.js'
import { PrintDialogOpenError, whenPrintDialogCloses } from '../print-dialog-guard.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { publishChange } from '../browser-state/browser-state.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'

/** The buffer limits dialog monitoring gives the page's network domain, so retained request data stays bounded. */
const MAX_NETWORK_TOTAL_BUFFER_BYTES = 8 * 1024 * 1024
const MAX_NETWORK_RESOURCE_BUFFER_BYTES = 2 * 1024 * 1024
const MAX_NETWORK_POST_DATA_BYTES = 64 * 1024

/** Pages whose monitoring stopped at an exited renderer and starts again on their next load. */
const monitoringAfterNextLoad = new WeakSet<WebContents>()

/** Pages whose website dialog Hronaut or an agent answered through the debugger, until the dialog closes. */
const answeredThroughDebugger = new WeakSet<WebContents>()

/** Accepts or dismisses the website dialog the tab shows. */
export async function handleDialog(browser: Browser, action: BrowserDialogAction, tabId?: string): Promise<{
  handled: true
  action: BrowserDialogAction
}> {
  const tab = getTab(browser, tabId)
  const webContents = tab.webContents
  await withDebugger(browser, webContents, () => answerWebsiteDialog(webContents, { accept: action === 'accept' }))
  return { handled: true, action }
}

/**
 * Runs an operation that may open website dialogs, accepting or dismissing
 * each one, with the prompt text when given, and fails when answering one
 * failed. Without a dialog action it just runs the operation.
 */
export async function withOptionalDialogHandling<T>(
  browser: Browser,
  webContents: WebContents,
  options: BrowserDialogHandlingOptions,
  operation: () => Promise<T>
): Promise<T> {
  if (options.promptText !== undefined && options.dialogAction === undefined) {
    throw new Error('dialogAction is required when promptText is provided')
  }
  const dialogAction = options.dialogAction
  if (dialogAction === undefined) return operation()

  return withDebugger(browser, webContents, async () => {
    const answer = {
      accept: dialogAction === 'accept',
      ...(options.promptText !== undefined ? { promptText: options.promptText } : {})
    }
    let handling = Promise.resolve()
    let handlingError: unknown
    let dialogsClosed = 0
    const listener = (_event: Electron.Event, method: string, params: { type?: string }): void => {
      if (method === 'Page.javascriptDialogClosed') dialogsClosed++
      if (method !== 'Page.javascriptDialogOpening') return
      if (params.type !== 'alert' && params.type !== 'confirm') {
        // Electron shows no box for a page asking before it unloads or for a prompt, and answers them itself at once,
        // so the agent's answer goes first.
        handling = handling.then(() => answerWebsiteDialog(webContents, answer)).catch((error: unknown) => { handlingError = error })
        return
      }
      const closedBefore = dialogsClosed
      handling = handling.then(async () => {
        await afterDialogBoxShows()
        // An alert from a site the person blocked dialogs from is turned down at once, as is one over trusted chrome.
        if (dialogsClosed !== closedBefore || !webContents.debugger.isAttached()) return
        await answerWebsiteDialog(webContents, answer)
      }).catch((error: unknown) => { handlingError = error })
    }
    webContents.debugger.on('message', listener)
    try {
      await webContents.debugger.sendCommand('Page.enable')
      const result = await operation()
      await handling
      if (handlingError) throw handlingError
      return result
    } finally {
      webContents.debugger.removeListener('message', listener)
    }
  })
}

/** Forgets the page's monitor attachment and execution contexts and detaches its debugger. */
export function detachDialogMonitoring(browser: Browser, webContents: WebContents): void {
  browser.dialogMonitorAttachPromises.delete(webContents.id)
  browser.defaultExecutionContexts.delete(webContents.id)
  if (webContents.debugger.isAttached()) webContents.debugger.detach()
}

/**
 * Clears the tab's website dialog and dismisses it in the page while trusted
 * chrome covers the window, unless the tab closed or the browser is closing.
 */
export async function dismissWebsiteDialogForTrustedChrome(browser: Browser, tab: BrowserTab): Promise<void> {
  const webContents = tab.webContents
  if (tab.dialog) {
    tab.dialog = undefined
    publishChange(browser, false)
  }
  // The dialog was reported through the page's debugger. Enabling its domains again, as monitoring does, would wait for
  // the page, which the dialog holds until someone answers it.
  if (
    browser.destroyed
    || webContents.isDestroyed()
    || findTab(browser, tab.id) !== tab
    || !webContents.debugger.isAttached()
  ) return
  // Website dialogs are native Chromium surfaces and can otherwise appear
  // above renderer-owned trusted chrome. Reject them while a trusted modal
  // owns the window; the page must never get to cover or impersonate the
  // approval surface.
  await afterDialogBoxShows()
  if (webContents.isDestroyed() || !webContents.debugger.isAttached()) return
  await answerWebsiteDialog(webContents, { accept: false }).catch(() => undefined)
}

/**
 * Answers the page's website dialog through its debugger, which closes the dialog but leaves Electron's box for it on
 * screen; the box is closed as the debugger reports the dialog closed.
 */
async function answerWebsiteDialog(webContents: WebContents, answer: { accept: boolean, promptText?: string }): Promise<void> {
  answeredThroughDebugger.add(webContents)
  try {
    await webContents.debugger.sendCommand('Page.handleJavaScriptDialog', answer)
  } catch (error) {
    answeredThroughDebugger.delete(webContents)
    throw error
  }
}

/**
 * Waits until Electron has shown its box for the dialog the page just opened. The debugger reports the dialog before
 * Electron shows its box, and a dialog answered before then leaves the box on screen with nothing to close it.
 */
function afterDialogBoxShows(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Closes the box Electron shows for a website dialog that closed because Hronaut or an agent answered it through the
 * debugger, as for trusted chrome covering the pages or an agent's answer. That box would stay on screen and keep
 * Hronaut's window disabled until the person clicked it. Electron closes its boxes for a page on its internal
 * `-cancel-dialogs` event, which never answers the page. A dialog the person answered closed with its box, so nothing
 * is closed for it. Called as the dialog closes, before its page can open another; an alert or confirm is answered only
 * once its box shows, so the box is there to close.
 */
export function closeWebsiteDialogBox(webContents: WebContents): void {
  if (answeredThroughDebugger.delete(webContents) && !webContents.isDestroyed()) webContents.emit('-cancel-dialogs')
}

/**
 * Attaches the page's debugger, unless Developer Tools have it, and enables
 * the page, runtime, log, audit and network domains that website dialogs and
 * page diagnostics observe, then applies the human interaction lock. Concurrent
 * callers share one attachment, which page lifecycle and debugger operations
 * wait for.
 */
export function ensureDialogMonitoring(browser: Browser, tab: BrowserTab): Promise<void> {
  const webContents = tab.webContents
  const existing = browser.dialogMonitorAttachPromises.get(webContents.id)
  if (existing) return existing
  const attaching = (async () => {
    if (
      browser.destroyed
      || webContents.isDestroyed()
      || webContents.isDevToolsOpened()
      || browser.devToolsOpening.has(webContents.id)
      // A page that has not loaded yet has no renderer to answer; monitoring starts as its first load does.
      || heldUntilFirstLoad(webContents)
    ) return
    try {
      const attachedHere = !webContents.debugger.isAttached()
      if (attachedHere) webContents.debugger.attach('1.3')
      await webContents.debugger.sendCommand('Page.enable')
      // Network Document responses also include iframes. Establish the native
      // main-frame identity before recording any connection-security metadata.
      const frameTree = await webContents.debugger.sendCommand('Page.getFrameTree') as {
        frameTree?: { frame?: { id?: string } }
      }
      tab.mainFrameId = frameTree.frameTree?.frame?.id
      await webContents.debugger.sendCommand('Runtime.enable')
      await webContents.debugger.sendCommand('Runtime.setAsyncCallStackDepth', { maxDepth: 8 }).catch(() => undefined)
      await webContents.debugger.sendCommand('Log.enable').catch(() => undefined)
      await webContents.debugger.sendCommand('Audits.enable')
      await webContents.debugger.sendCommand('Network.enable', {
        maxTotalBufferSize: MAX_NETWORK_TOTAL_BUFFER_BYTES,
        maxResourceBufferSize: MAX_NETWORK_RESOURCE_BUFFER_BYTES,
        maxPostDataSize: MAX_NETWORK_POST_DATA_BYTES
      })
      // Reattachment never restores request conditions. A detached epoch
      // requires explicit recovery; dialog monitoring is independent.
      tab.networkDebuggerEnabled = true
      await webContents.debugger.sendCommand('Input.setIgnoreInputEvents', {
        ignore: browser.isHumanInteractionLocked(tab) && !browser.agentInputWebContents.has(webContents.id)
      })
      // Emulation uncertainty also requires explicit recovery; never reapply it here.
    } catch (error) {
      tab.networkDebuggerEnabled = false
      if (browser.destroyed || webContents.isDestroyed()) return
      if (error instanceof RendererExitedError) {
        // A crashed page has nothing to monitor; its next load does.
        if (!monitoringAfterNextLoad.has(webContents)) {
          monitoringAfterNextLoad.add(webContents)
          webContents.once('dom-ready', () => {
            monitoringAfterNextLoad.delete(webContents)
            void ensureDialogMonitoring(browser, tab)
          })
        }
        return
      }
      if (error instanceof PrintDialogOpenError) {
        // A page that prints as it opens, such as a receipt, holds its renderer in the print dialog; the page is
        // monitored once the person closes it.
        void whenPrintDialogCloses(webContents).then(() => ensureDialogMonitoring(browser, tab))
        return
      }
      console.error('[browser] Could not enable page diagnostics:', error)
    }
  })()
  browser.dialogMonitorAttachPromises.set(webContents.id, attaching)
  void attaching.finally(() => {
    if (browser.dialogMonitorAttachPromises.get(webContents.id) === attaching) {
      browser.dialogMonitorAttachPromises.delete(webContents.id)
    }
  })
  return attaching
}
