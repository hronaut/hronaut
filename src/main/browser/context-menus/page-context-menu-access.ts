import type { BrowserWindow, LoadURLOptions, WebContents } from 'electron'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import type { BrowserState } from '../../../shared/types.js'

/** The tab fields the page context menu reads. */
export interface PageContextMenuTab {
  id: string
  url: string
  mcpGroupId?: string
  webContents: WebContents
}

/** The tab manager options the page context menu uses for the clipboard and for reporting failed actions. */
export interface PageContextMenuOptions {
  copyText: (text: string) => Promise<void>
  copyImageAt: (webContents: WebContents, x: number, y: number) => Promise<void>
  onClipboardCopyFailed?: (error: unknown) => void
  onActionFailed?: (action: string, error: unknown) => void
}

/**
 * What the page context menu needs from the tab manager, which keeps the
 * tabs, the window, its options, localized text, tab creation, navigation and
 * DevTools private. Each menu action reads the manager when it runs, not when
 * the menu opens.
 */
export interface PageContextMenuAccess<Tab extends PageContextMenuTab> {
  findTab(tabId: string): Tab | undefined
  window(): BrowserWindow
  options(): PageContextMenuOptions
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Opens a tab beside the tab its page opened it from; the load options carry the page's referrer to the address. */
  createTab(options: { url: string; active: boolean; mcpGroupId?: string; loadOptions?: LoadURLOptions; openedFrom?: { tabId: string; background: boolean } }): Promise<Tab>
  back(tabId: string): Promise<BrowserState>
  forward(tabId: string): Promise<BrowserState>
  reload(tabId: string): Promise<BrowserState>
  reloadIgnoringCache(tabId: string): Promise<BrowserState>
  isHumanInteractionLocked(tab: Tab): boolean
  openDevTools(tab: Tab): Promise<void>
  /** Opens the print dialog for the tab's page, unless an agent is acting on it or something else holds it. */
  print(tab: Tab): Promise<void>
  /** Opens the page's source in a new tab beside it, for a web page. */
  viewSource(tab: Tab): Promise<boolean>
  /** Names the download Save Link As starts for this address in this page with the link's `download` name. */
  expectSavedLinkName(webContents: WebContents, url: string, linkName: string): void
}
