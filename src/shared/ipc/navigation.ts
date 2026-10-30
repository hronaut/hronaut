import type {
  BrowserFindOptions,
  BrowserFindResult,
  BrowserPdfExport,
  BrowserPdfOptions,
  BrowserState,
  BrowserZoomOptions,
  NavigateOptions
} from '../types.js'
import type { InvokeChannel } from './channel.js'

/** Moving a tab's page through its history, and what the toolbar and menus do to the page. A tab named by no id is the active one. */
export const NAVIGATION_IPC = {
  /** Shell → main: opens the address in the tab, as the person's own navigation. */
  navigate: 'browser:navigate' as InvokeChannel<[options: NavigateOptions], BrowserState>,
  /** Shell → main: Back. */
  back: 'browser:back' as InvokeChannel<[tabId?: string], BrowserState>,
  /** Shell → main: Forward. */
  forward: 'browser:forward' as InvokeChannel<[tabId?: string], BrowserState>,
  /** Shell → main: the list of pages Back or Forward goes through, at the anchor in CSS pixels; false when there was none to show. */
  showHistoryMenu: 'browser:show-history-menu' as InvokeChannel<[options: { tabId: string; direction: 'back' | 'forward'; anchor?: { x: number; y: number } }], boolean>,
  /** Shell → main: opens the page Back or Forward goes to, or the tab's own page for Reload, in a new tab beside the tab. */
  openNavigationInNewTab: 'browser:open-navigation-in-new-tab' as InvokeChannel<[options: { tabId: string; target: 'back' | 'forward' | 'reload'; active: boolean }], BrowserState>,
  /** Shell → main: Reload. */
  reload: 'browser:reload' as InvokeChannel<[tabId?: string], BrowserState>,
  /** Shell → main: asks the person whether to open the page the tab refused for its certificate, and opens it if they choose to. */
  proceedPastCertificateError: 'browser:proceed-past-certificate' as InvokeChannel<[tabId: string], BrowserState>,
  /** Shell → main: reloads without the cache. */
  reloadIgnoringCache: 'browser:reload-ignoring-cache' as InvokeChannel<[tabId?: string], BrowserState>,
  /** Shell → main: stops loading. */
  stop: 'browser:stop' as InvokeChannel<[tabId?: string], BrowserState>,
  /** Shell → main: finds the text in the page, or the next or previous match. */
  findInPage: 'browser:find-in-page' as InvokeChannel<[options: BrowserFindOptions], BrowserFindResult>,
  /** Shell → main: ends the search; with activateMatch, also clicks the active match. */
  stopFindInPage: 'browser:stop-find-in-page' as InvokeChannel<[tabId?: string, options?: { activateMatch?: boolean }], void>,
  /** Shell → main: zooms the page in, out, back to its default or to a percent. */
  setZoom: 'browser:set-zoom' as InvokeChannel<[options: BrowserZoomOptions], BrowserState>,
  /** Shell → main: saves the page as a PDF. */
  savePdf: 'browser:save-pdf' as InvokeChannel<[options: BrowserPdfOptions], BrowserPdfExport>,
  /** Shell → main: opens or closes Developer Tools; true when they are open after. */
  toggleDevTools: 'browser:toggle-devtools' as InvokeChannel<[tabId?: string], boolean>,
  /** Shell → main: opens Developer Tools on the Console, or turns open ones to it. */
  showDevToolsConsole: 'browser:show-devtools-console' as InvokeChannel<[tabId?: string], boolean>
} as const
