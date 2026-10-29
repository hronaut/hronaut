import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserPdfPageSize, BrowserState } from '../shared/types.js'
import type { Browser } from './browser/browser.js'

type NavigationIpcTabs = Pick<Browser,
  | 'beforeStateReply' | 'toggleDevTools' | 'showDevToolsConsole' | 'navigate' | 'back' | 'forward' | 'showHistoryMenu' | 'openNavigationInNewTab' | 'reload' | 'reloadIgnoringCache' | 'stop'
  | 'proceedPastCertificateError'
  | 'findInPage' | 'stopFindInPage' | 'setZoom' | 'savePdf'>

interface NavigationIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): NavigationIpcTabs | null
  /** The paper a PDF saved from Hronaut's controls uses when they name none: the standard paper of the person's region. */
  defaultPdfPageSize(): BrowserPdfPageSize
}

/**
 * Replies to a shell action with the browser state it returned. The shell drops a reply if a state arrived meanwhile,
 * which a state it has not drawn yet always does, so a change waiting for that draw is sent first, before the reply.
 */
async function stateReply(host: { tabs(): Pick<Browser, 'beforeStateReply'> | null }, reply: Promise<BrowserState>): Promise<BrowserState> {
  const state = await reply
  host.tabs()?.beforeStateReply()
  return state
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerNavigationIpc(host: NavigationIpcHost): void {
  host.handleBrowserIpc('browser:toggle-devtools', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return host.tabs()!.toggleDevTools(tabId)
  })
  host.handleBrowserIpc('browser:show-devtools-console', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return host.tabs()!.showDevToolsConsole(tabId)
  })
  host.handleBrowserIpc('browser:navigate', (event, options) => { host.assertTrustedSender(event); return stateReply(host, host.tabs()!.navigate(options.url, options.tabId, { byPerson: true })) })
  host.handleBrowserIpc('browser:back', (event, tabId) => { host.assertTrustedSender(event); return stateReply(host, host.tabs()!.back(tabId)) })
  host.handleBrowserIpc('browser:forward', (event, tabId) => { host.assertTrustedSender(event); return stateReply(host, host.tabs()!.forward(tabId)) })
  host.handleBrowserIpc('browser:show-history-menu', (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid history list options')
    const { tabId, direction, anchor } = options as Record<string, unknown>
    if (typeof tabId !== 'string' || (direction !== 'back' && direction !== 'forward')) throw new TypeError('Invalid history list options')
    return host.tabs()!.showHistoryMenu(tabId, direction, validAnchor(anchor))
  })
  host.handleBrowserIpc('browser:open-navigation-in-new-tab', (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid new tab options')
    const { tabId, target, active } = options as Record<string, unknown>
    if (typeof tabId !== 'string' || (target !== 'back' && target !== 'forward' && target !== 'reload') || typeof active !== 'boolean') {
      throw new TypeError('Invalid new tab options')
    }
    return host.tabs()!.openNavigationInNewTab(tabId, target, active)
  })
  host.handleBrowserIpc('browser:reload', (event, tabId) => { host.assertTrustedSender(event); return stateReply(host, host.tabs()!.reload(tabId)) })
  host.handleBrowserIpc('browser:proceed-past-certificate', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof tabId !== 'string') throw new TypeError('Invalid tab')
    return stateReply(host, host.tabs()!.proceedPastCertificateError(tabId))
  })
  host.handleBrowserIpc('browser:reload-ignoring-cache', (event, tabId) => { host.assertTrustedSender(event); return host.tabs()!.reloadIgnoringCache(tabId) })
  host.handleBrowserIpc('browser:stop', (event, tabId) => { host.assertTrustedSender(event); return host.tabs()!.stop(tabId) })
  host.handleBrowserIpc('browser:find-in-page', (event, options: unknown) => {
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
    return host.tabs()!.findInPage(query, { tabId, forward, findNext, caseSensitive })
  })
  host.handleBrowserIpc('browser:stop-find-in-page', (event, tabId: unknown, options: unknown = {}) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid find tab')
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid stop find options')
    const { activateMatch } = options as Record<string, unknown>
    if (activateMatch !== undefined && typeof activateMatch !== 'boolean') throw new TypeError('Invalid stop find options')
    host.tabs()!.stopFindInPage(tabId, { activateMatch })
  })
  host.handleBrowserIpc('browser:set-zoom', (event, options: unknown) => {
    host.assertTrustedSender(event)
    if (typeof options !== 'object' || options === null) throw new TypeError('Invalid page zoom options')
    const { tabId, action, percent } = options as Record<string, unknown>
    if (
      (tabId !== undefined && typeof tabId !== 'string')
      || (action !== 'in' && action !== 'out' && action !== 'reset' && action !== 'set')
      || (percent !== undefined && typeof percent !== 'number')
    ) throw new TypeError('Invalid page zoom options')
    return host.tabs()!.setZoom({ tabId, action, percent })
  })
  host.handleBrowserIpc('browser:save-pdf', (event, options: unknown) => {
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
    return host.tabs()!.savePdf({ tabId, filename, landscape, pageSize: pageSize ?? host.defaultPdfPageSize(), outline, preferCSSPageSize })
  })
}

/** The place a list opens at, in the window's CSS pixels; one that is not a point on a window opens it at the pointer. */
function validAnchor(anchor: unknown): { x: number; y: number } | undefined {
  if (typeof anchor !== 'object' || anchor === null) return undefined
  const { x, y } = anchor as Record<string, unknown>
  const onWindow = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000
  return onWindow(x) && onWindow(y) ? { x, y } : undefined
}
