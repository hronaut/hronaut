import type { WebContents } from 'electron'
import type { BrowserDialogAction, BrowserDialogHandlingOptions } from '../../../shared/types.js'
import { heldUntilFirstLoad, RendererExitedError } from '../renderer-exit-guard.js'
import { PrintDialogOpenError, whenPrintDialogCloses } from '../print-dialog-guard.js'
import type { WebsiteDialogsAccess, WebsiteDialogsTab } from './website-dialogs-access.js'

/** The buffer limits dialog monitoring gives the page's network domain, so retained request data stays bounded. */
const MAX_NETWORK_TOTAL_BUFFER_BYTES = 8 * 1024 * 1024
const MAX_NETWORK_RESOURCE_BUFFER_BYTES = 2 * 1024 * 1024
const MAX_NETWORK_POST_DATA_BYTES = 64 * 1024

/** Pages whose monitoring stopped at an exited renderer and starts again on their next load. */
const monitoringAfterNextLoad = new WeakSet<WebContents>()

/** Accepts or dismisses the website dialog the tab shows. */
export async function handleDialog<Tab extends WebsiteDialogsTab>(access: WebsiteDialogsAccess<Tab>, action: BrowserDialogAction, tabId?: string): Promise<{
  handled: true
  action: BrowserDialogAction
}> {
  const tab = access.getTab(tabId)
  const webContents = tab.webContents
  await access.withDebugger(webContents, () => webContents.debugger.sendCommand('Page.handleJavaScriptDialog', {
    accept: action === 'accept'
  }))
  return { handled: true, action }
}

/**
 * Runs an operation that may open website dialogs, accepting or dismissing
 * each one, with the prompt text when given, and fails when answering one
 * failed. Without a dialog action it just runs the operation.
 */
export async function withOptionalDialogHandling<Tab extends WebsiteDialogsTab, T>(
  access: WebsiteDialogsAccess<Tab>,
  webContents: WebContents,
  options: BrowserDialogHandlingOptions,
  operation: () => Promise<T>
): Promise<T> {
  if (options.promptText !== undefined && options.dialogAction === undefined) {
    throw new Error('dialogAction is required when promptText is provided')
  }
  const dialogAction = options.dialogAction
  if (dialogAction === undefined) return operation()

  return access.withDebugger(webContents, async () => {
    let handling = Promise.resolve()
    let handlingError: unknown
    const listener = (_event: Electron.Event, method: string): void => {
      if (method !== 'Page.javascriptDialogOpening') return
      handling = handling.then(async () => {
        await webContents.debugger.sendCommand('Page.handleJavaScriptDialog', {
          accept: dialogAction === 'accept',
          ...(options.promptText !== undefined ? { promptText: options.promptText } : {})
        })
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
export function detachDialogMonitoring<Tab extends WebsiteDialogsTab>(access: WebsiteDialogsAccess<Tab>, webContents: WebContents): void {
  access.dialogMonitorAttachPromises().delete(webContents.id)
  access.defaultExecutionContexts().delete(webContents.id)
  if (webContents.debugger.isAttached()) webContents.debugger.detach()
}

/**
 * Clears the tab's website dialog and dismisses it in the page while trusted
 * chrome covers the window, unless the tab closed or the browser is closing.
 */
export async function dismissWebsiteDialogForTrustedChrome<Tab extends WebsiteDialogsTab>(access: WebsiteDialogsAccess<Tab>, tab: Tab): Promise<void> {
  const webContents = tab.webContents
  if (tab.dialog) {
    tab.dialog = undefined
    access.changed(false)
  }
  if (access.isDestroyed() || webContents.isDestroyed() || access.findTab(tab.id) !== tab) return
  await ensureDialogMonitoring(access, tab)
  if (
    access.isDestroyed()
    || webContents.isDestroyed()
    || access.findTab(tab.id) !== tab
    || !webContents.debugger.isAttached()
  ) return
  // Website dialogs are native Chromium surfaces and can otherwise appear
  // above renderer-owned trusted chrome. Reject them while a trusted modal
  // owns the window; the page must never get to cover or impersonate the
  // approval surface.
  await webContents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined)
}

/**
 * Attaches the page's debugger, unless Developer Tools have it, and enables
 * the page, runtime, log, audit and network domains that website dialogs and
 * page diagnostics observe, then applies the human interaction lock. Concurrent
 * callers share one attachment, which page lifecycle and debugger operations
 * wait for.
 */
export function ensureDialogMonitoring<Tab extends WebsiteDialogsTab>(access: WebsiteDialogsAccess<Tab>, tab: Tab): Promise<void> {
  const webContents = tab.webContents
  const existing = access.dialogMonitorAttachPromises().get(webContents.id)
  if (existing) return existing
  const attaching = (async () => {
    if (
      access.isDestroyed()
      || webContents.isDestroyed()
      || webContents.isDevToolsOpened()
      || access.isDevToolsOpening(webContents.id)
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
        ignore: access.isHumanInteractionLocked(tab) && !access.isAgentInput(webContents.id)
      })
      // Emulation uncertainty also requires explicit recovery; never reapply it here.
    } catch (error) {
      tab.networkDebuggerEnabled = false
      if (access.isDestroyed() || webContents.isDestroyed()) return
      if (error instanceof RendererExitedError) {
        // A crashed page has nothing to monitor; its next load does.
        if (!monitoringAfterNextLoad.has(webContents)) {
          monitoringAfterNextLoad.add(webContents)
          webContents.once('dom-ready', () => {
            monitoringAfterNextLoad.delete(webContents)
            void ensureDialogMonitoring(access, tab)
          })
        }
        return
      }
      if (error instanceof PrintDialogOpenError) {
        // A page that prints as it opens, such as a receipt, holds its renderer in the print dialog; the page is
        // monitored once the person closes it.
        void whenPrintDialogCloses(webContents).then(() => ensureDialogMonitoring(access, tab))
        return
      }
      console.error('[browser] Could not enable page diagnostics:', error)
    }
  })()
  access.dialogMonitorAttachPromises().set(webContents.id, attaching)
  void attaching.finally(() => {
    if (access.dialogMonitorAttachPromises().get(webContents.id) === attaching) {
      access.dialogMonitorAttachPromises().delete(webContents.id)
    }
  })
  return attaching
}
