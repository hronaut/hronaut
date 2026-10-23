import { isWebUrl } from '../url.js'
import type { PageSourceAccess, PageSourceTab } from './page-source-access.js'

/**
 * Chrome's View Page Source: the page's address under `view-source:`, for a web page only. Hronaut Home and a page's
 * source have none, as Chrome shows no source of its own pages or of a source.
 */
export function pageSourceAddress(url: string): string | undefined {
  return isWebUrl(url) ? `view-source:${url}` : undefined
}

/**
 * Opens the page's source in a new tab beside it, in front and in the same workspace, as Chrome does for Ctrl+U,
 * Cmd+Option+U on macOS, or View Page Source in the page's context menu. Nothing opens behind trusted chrome, as a page
 * prints nothing there: the new tab would change the page under a dialog of Hronaut's, which may have opened while the
 * context menu was open. Says whether it opened one.
 */
export async function viewPageSource<Tab extends PageSourceTab>(access: PageSourceAccess<Tab>, tab: Tab): Promise<boolean> {
  const url = pageSourceAddress(tab.url)
  if (!url || access.browserContentOccluded()) return false
  await access.createTab({ url, active: true, mcpGroupId: tab.mcpGroupId, openedFrom: { tabId: tab.id, background: false } })
  return true
}

/**
 * Chrome's View Frame Source, from the context menu of a frame inside the page: the frame's source in a new tab beside
 * the page, as View Page Source opens the page's, for a frame showing a web page only.
 */
export async function viewFrameSource<Tab extends PageSourceTab>(access: PageSourceAccess<Tab>, tab: Tab, frameUrl: string): Promise<boolean> {
  const url = pageSourceAddress(frameUrl)
  if (!url || access.browserContentOccluded()) return false
  await access.createTab({ url, active: true, mcpGroupId: tab.mcpGroupId, openedFrom: { tabId: tab.id, background: false } })
  return true
}

/** View Page Source for the tab the window shows, from the View menu and its key; see viewPageSource. */
export function viewShownPageSource<Tab extends PageSourceTab>(access: PageSourceAccess<Tab>): Promise<boolean> {
  const tab = access.shownTab()
  return tab ? viewPageSource(access, tab) : Promise.resolve(false)
}
