import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from './typed-ipc.js'
import type { BrowserPdfPageSize, BrowserState } from '../shared/types.js'
import type { Browser } from './browser/browser.js'
import { showHistoryMenu } from './browser/context-menus/history-menu.js'
import { showDevToolsConsole, toggleDevTools } from './browser/devtools/devtools.js'
import { openNavigationInNewTab } from './browser/navigation-new-tab/navigation-new-tab.js'
import { findInPage, stopFindInPage } from './browser/page-find/page-find.js'
import { back, forward, reload, reloadIgnoringCache, stop, navigate } from './browser/page-navigation/page-navigation.js'
import { setZoom } from './browser/page-zoom/page-zoom.js'
import { savePdf } from './browser/pdf-export/pdf-export.js'
import { proceedPastTabCertificateError } from './browser/certificate-errors/browser-certificate-errors.js'
import { NAVIGATION_IPC } from '../shared/ipc/navigation.js'

interface NavigationIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc: TypedIpcMain['handle']
  tabs(): Browser | null
  /** The paper a PDF saved from Hronaut's controls uses when they name none: the standard paper of the person's region. */
  defaultPdfPageSize(): BrowserPdfPageSize
}

/**
 * Replies to a shell action with the browser state it returned. The shell drops a reply if a state arrived meanwhile,
 * which a state it has not drawn yet always does, so a change waiting for that draw is sent first, before the reply.
 */
async function stateReply(host: { tabs(): Browser | null }, reply: Promise<BrowserState>): Promise<BrowserState> {
  const state = await reply
  host.tabs()?.statePublication.beforeReply()
  return state
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerNavigationIpc(host: NavigationIpcHost): void {
  host.handleBrowserIpc(NAVIGATION_IPC.toggleDevTools, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    return toggleDevTools(host.tabs()!, optionalTabId(tabId))
  })
  host.handleBrowserIpc(NAVIGATION_IPC.showDevToolsConsole, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    return showDevToolsConsole(host.tabs()!, optionalTabId(tabId))
  })
  host.handleBrowserIpc(NAVIGATION_IPC.navigate, (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid navigation options')
    const { url, tabId } = options as Record<string, unknown>
    if (typeof url !== 'string') throw new TypeError('Invalid navigation options')
    return stateReply(host, navigate(host.tabs()!, url, optionalTabId(tabId), { byPerson: true }))
  })
  host.handleBrowserIpc(NAVIGATION_IPC.back, (event, tabId) => { host.assertTrustedSender(event); return stateReply(host, back(host.tabs()!, optionalTabId(tabId))) })
  host.handleBrowserIpc(NAVIGATION_IPC.forward, (event, tabId) => { host.assertTrustedSender(event); return stateReply(host, forward(host.tabs()!, optionalTabId(tabId))) })
  host.handleBrowserIpc(NAVIGATION_IPC.showHistoryMenu, (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid history list options')
    const { tabId, direction, anchor } = options as Record<string, unknown>
    if (typeof tabId !== 'string' || (direction !== 'back' && direction !== 'forward')) throw new TypeError('Invalid history list options')
    return showHistoryMenu(host.tabs()!, tabId, direction, validAnchor(anchor))
  })
  host.handleBrowserIpc(NAVIGATION_IPC.openNavigationInNewTab, (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid new tab options')
    const { tabId, target, active } = options as Record<string, unknown>
    if (typeof tabId !== 'string' || (target !== 'back' && target !== 'forward' && target !== 'reload') || typeof active !== 'boolean') {
      throw new TypeError('Invalid new tab options')
    }
    return openNavigationInNewTab(host.tabs()!, tabId, target, active)
  })
  host.handleBrowserIpc(NAVIGATION_IPC.reload, (event, tabId) => { host.assertTrustedSender(event); return stateReply(host, reload(host.tabs()!, optionalTabId(tabId))) })
  host.handleBrowserIpc(NAVIGATION_IPC.proceedPastCertificateError, (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab')
    return stateReply(host, proceedPastTabCertificateError(host.tabs()!, tabId))
  })
  host.handleBrowserIpc(NAVIGATION_IPC.reloadIgnoringCache, (event, tabId) => { host.assertTrustedSender(event); return reloadIgnoringCache(host.tabs()!, optionalTabId(tabId)) })
  host.handleBrowserIpc(NAVIGATION_IPC.stop, (event, tabId) => { host.assertTrustedSender(event); return stop(host.tabs()!, optionalTabId(tabId)) })
  host.handleBrowserIpc(NAVIGATION_IPC.findInPage, (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid find options')
    const { query, tabId, forward, findNext, caseSensitive } = options as Record<string, unknown>
    if (
      typeof query !== 'string'
      || (tabId !== undefined && typeof tabId !== 'string')
      || (forward !== undefined && typeof forward !== 'boolean')
      || (findNext !== undefined && typeof findNext !== 'boolean')
      || (caseSensitive !== undefined && typeof caseSensitive !== 'boolean')
    ) throw new TypeError('Invalid find options')
    return findInPage(host.tabs()!, query, { tabId, forward, findNext, caseSensitive })
  })
  host.handleBrowserIpc(NAVIGATION_IPC.stopFindInPage, (event, tabId: unknown, options: unknown = {}) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid find tab')
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid stop find options')
    const { activateMatch } = options as Record<string, unknown>
    if (activateMatch !== undefined && typeof activateMatch !== 'boolean') throw new TypeError('Invalid stop find options')
    stopFindInPage(host.tabs()!, tabId, { activateMatch })
  })
  host.handleBrowserIpc(NAVIGATION_IPC.setZoom, (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid page zoom options')
    const { tabId, action, percent } = options as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== 'in' && action !== 'out' && action !== 'reset' && action !== 'set')
      || (percent !== undefined && typeof percent !== 'number')
    ) throw new TypeError('Invalid page zoom options')
    return setZoom(host.tabs()!, { tabId, action, percent })
  })
  host.handleBrowserIpc(NAVIGATION_IPC.savePdf, (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid PDF options')
    const { tabId, filename, landscape, pageSize, outline, preferCSSPageSize } = options as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (filename !== undefined && typeof filename !== 'string')
      || (landscape !== undefined && typeof landscape !== 'boolean')
      || (pageSize !== undefined && pageSize !== 'A4' && pageSize !== 'Letter' && pageSize !== 'Legal')
      || (outline !== undefined && typeof outline !== 'boolean')
      || (preferCSSPageSize !== undefined && typeof preferCSSPageSize !== 'boolean')
    ) throw new TypeError('Invalid PDF options')
    return savePdf(host.tabs()!, { tabId, filename, landscape, pageSize: pageSize ?? host.defaultPdfPageSize(), outline, preferCSSPageSize })
  })
}

/** The place a list opens at, in the window's CSS pixels; one that is not a point on a window opens it at the pointer. */
function validAnchor(anchor: unknown): { x: number; y: number } | undefined {
  if (typeof anchor !== 'object' || anchor === null) return undefined
  const { x, y } = anchor as Record<string, unknown>
  const onWindow = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000
  return onWindow(x) && onWindow(y) ? { x, y } : undefined
}

/** The tab the shell names, or none for the active tab. */
function optionalTabId(value: unknown): string | undefined {
  if (value !== undefined && typeof value !== 'string') throw new TypeError('Invalid tab ID')
  return value
}
