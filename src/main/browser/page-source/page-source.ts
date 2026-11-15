import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { isWebUrl } from '../url.js'

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
export async function viewPageSource(browser: Browser, tab: Pick<BrowserTab, 'id' | 'url' | 'mcpGroupId'>): Promise<boolean> {
  const url = pageSourceAddress(tab.url)
  if (!url || browser.browserContentOccluded) return false
  await browser.createTab({ url, active: true, mcpGroupId: tab.mcpGroupId, openedFrom: { tabId: tab.id, background: false } })
  return true
}

/**
 * Chrome's View Frame Source, from the context menu of a frame inside the page: the frame's source in a new tab beside
 * the page, as View Page Source opens the page's, for a frame showing a web page only.
 */
export async function viewFrameSource(browser: Browser, tab: Pick<BrowserTab, 'id' | 'mcpGroupId'>, frameUrl: string): Promise<boolean> {
  const url = pageSourceAddress(frameUrl)
  if (!url || browser.browserContentOccluded) return false
  await browser.createTab({ url, active: true, mcpGroupId: tab.mcpGroupId, openedFrom: { tabId: tab.id, background: false } })
  return true
}

/** View Page Source for the tab the window shows, from the View menu and its key; see viewPageSource. */
export function viewShownPageSource(browser: Browser): Promise<boolean> {
  const tab = browser.activeTabId ? browser.tabs.get(browser.activeTabId) : undefined
  return tab ? viewPageSource(browser, tab) : Promise.resolve(false)
}
