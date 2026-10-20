import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserPdfPageSize } from '../shared/types.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'

type NavigationIpcTabs = Pick<BrowserTabsManager,
  | 'toggleDevTools' | 'navigate' | 'back' | 'forward' | 'reload' | 'reloadIgnoringCache' | 'stop'
  | 'findInPage' | 'stopFindInPage' | 'setZoom' | 'savePdf'>

interface NavigationIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): NavigationIpcTabs | null
  /** The paper a PDF saved from Hronaut's controls uses when they name none: the standard paper of the person's region. */
  defaultPdfPageSize(): BrowserPdfPageSize
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerNavigationIpc(host: NavigationIpcHost): void {
  host.handleBrowserIpc('browser:toggle-devtools', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid tab ID')
    return host.tabs()!.toggleDevTools(tabId)
  })
  host.handleBrowserIpc('browser:navigate', (event, options) => { host.assertTrustedSender(event); return host.tabs()!.navigate(options.url, options.tabId) })
  host.handleBrowserIpc('browser:back', (event, tabId) => { host.assertTrustedSender(event); return host.tabs()!.back(tabId) })
  host.handleBrowserIpc('browser:forward', (event, tabId) => { host.assertTrustedSender(event); return host.tabs()!.forward(tabId) })
  host.handleBrowserIpc('browser:reload', (event, tabId) => { host.assertTrustedSender(event); return host.tabs()!.reload(tabId) })
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
  host.handleBrowserIpc('browser:stop-find-in-page', (event, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (tabId !== undefined && typeof tabId !== 'string') throw new TypeError('Invalid find tab')
    host.tabs()!.stopFindInPage(tabId)
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
