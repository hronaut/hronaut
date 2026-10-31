import type { WebContents } from 'electron'
import type { BrowserDialogAction, BrowserDialogHandlingOptions } from '../../../shared/types.js'
import { heldUntilFirstLoad, RendererExitedError } from '../renderer-exit-guard.js'
import { PrintDialogOpenError, whenPrintDialogCloses } from '../print-dialog-guard.js'
import { WebsiteDialogOpenError, whenWebsiteDialogCloses } from '../website-dialog-guard.js'
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

/** Pages with an agent's action under way that answers the website dialogs it raises. */
const agentActionsAnsweringDialogs = new WeakSet<WebContents>()

/** Whether an agent's action under way on the page answers the website dialogs it raises, so none waits for the person. */
export function agentAnswersWebsiteDialogs(webContents: WebContents): boolean {
  return agentActionsAnsweringDialogs.has(webContents)
}

/**
 * Accepts or dismisses the website dialog the tab shows. Given the id of the dialog the agent read, it answers only that
 * one: after the person answered it, the page's next dialog, such as one asking to delete something, would take the
 * agent's answer instead.
 */
export async function handleDialog(browser: Browser, action: BrowserDialogAction, tabId?: string, dialogId?: string): Promise<{
  handled: true
  action: BrowserDialogAction
}> {
  const tab = getTab(browser, tabId)
  if (dialogId !== undefined && tab.dialog?.id !== dialogId) {
    throw new Error(tab.dialog
      ? 'That dialog was already answered and the page now shows another one; nothing was answered. Read it before answering it.'
      : 'That dialog was already answered and no dialog is showing; nothing was answered.')
  }
  const webContents = tab.webContents
  const answer = { accept: action === 'accept' }
  // The browser answers a dialog the page shows through the attached debugger, without the page. So the answer takes
  // no turn after page commands or monitoring set-up, which wait for the page the dialog holds.
  if (tab.dialog && webContents.debugger.isAttached()) await answerWebsiteDialog(webContents, answer)
  else await withDebugger(browser, webContents, () => answerWebsiteDialog(webContents, answer))
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
    // The debugger queue runs one operation on the page at a time.
    agentActionsAnsweringDialogs.add(webContents)
    try {
      await webContents.debugger.sendCommand('Page.enable')
      const result = await operation()
      await handling
      if (handlingError) throw handlingError
      return result
    } finally {
      agentActionsAnsweringDialogs.delete(webContents)
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
 * Waits for a command to the page unless a website dialog opens first, and then resolves undefined: the page answers
 * nothing until the dialog closes. The command still settles once it does.
 */
export function unlessWebsiteDialogOpens<T>(webContents: WebContents, command: Promise<T>): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const listener = (_event: Electron.Event, method: string): void => {
      if (method === 'Page.javascriptDialogOpening') settle(() => resolve(undefined))
    }
    const settle = (finish: () => void): void => {
      webContents.debugger.removeListener('message', listener)
      finish()
    }
    webContents.debugger.on('message', listener)
    command.then((value) => settle(() => resolve(value)), (error: unknown) => settle(() => reject(error)))
  })
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
 * Closes the box of a website dialog whose page went away while it showed, as when an agent closes the tab. Electron
 * closes a page's boxes when it navigates or its renderer exits, but not when the page is destroyed, so the box stayed
 * on screen and kept Hronaut's window disabled until the person clicked it. Called once the page is destroyed.
 */
export function closeWebsiteDialogBoxOfDestroyedPage(webContents: WebContents): void {
  answeredThroughDebugger.delete(webContents)
  try {
    webContents.emit('-cancel-dialogs')
  } catch (error) {
    console.warn('[browser] Could not close the dialog box of a closed page:', error)
  }
}

/**
 * Attaches the page's debugger, unless Developer Tools have it, and enables
 * the page, runtime, log, audit and network domains that website dialogs and
 * page diagnostics observe, then applies the human interaction lock. Concurrent
 * callers share one attachment, which page lifecycle and debugger operations
 * wait for. Once monitoring is in place it holds until the debugger detaches,
 * and a call does nothing.
 */
export function ensureDialogMonitoring(browser: Browser, tab: BrowserTab): Promise<void> {
  const webContents = tab.webContents
  const existing = browser.dialogMonitorAttachPromises.get(webContents.id)
  if (existing) return existing
  // Enabling the page's domains again would wait for the page, which a website dialog holds until someone answers it,
  // and every debugger operation waits for that.
  if (tab.networkDebuggerEnabled && webContents.debugger.isAttached()) return Promise.resolve()
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
      if (error instanceof WebsiteDialogOpenError) {
        // A page that alerts as it opens holds its renderer the same way until someone answers the dialog.
        void whenWebsiteDialogCloses(webContents).then(() => ensureDialogMonitoring(browser, tab))
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
