import { addressPasteText, pastesJavascriptScheme } from '../../../shared/address-paste.js'
import type { BrowserState, DroppedLinkTarget } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { createNewTab } from '../new-tabs/new-tabs.js'
import { navigate } from '../page-navigation/page-navigation.js'
import { getTab, orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState } from '../browser-state/browser-state.js'

/** The longest address Chrome loads (url::kMaxURLChars); longer text opens nothing. */
const MAX_DROPPED_TEXT_LENGTH = 2 * 1024 * 1024

/**
 * Opens a link, or other text, dropped on the tab strip or rail where it was dropped, as Chrome does: in the tab it was
 * dropped on, which loads it without being brought into view; or in a new tab, shown, before or after that tab, or at
 * the end of the workspace whose New tab button it was dropped on. The text is read as the address bar reads
 * a paste, and text that is no address searches, as it does there. As in Chrome, a dropped javascript: address never
 * runs, and nothing else of it opens either. The workspace's navigation policy applies as to any address.
 */
export async function openDroppedLink(browser: Browser, text: string,
  target: DroppedLinkTarget): Promise<BrowserState> {
  if (text.length > MAX_DROPPED_TEXT_LENGTH || pastesJavascriptScheme(text)) return browserState(browser)
  const address = addressPasteText(text)
  if (!address) return browserState(browser)
  if (!('tabId' in target)) return createNewTab(browser, { url: address, mcpGroupId: target.workspaceId }, true)
  const tab = getTab(browser, target.tabId)
  // Home is no tab of the strip; nothing is dropped on it.
  if (isHronautHomeUrl(tab.url)) return browserState(browser)
  if (target.placement === 'onto') return navigate(browser, address, tab.id, { byPerson: true })
  const placement = target.placement
  return createNewTab(browser, { url: address, mcpGroupId: tab.mcpGroupId }, true, (created) => placeBeside(browser, created, tab, placement))
}

/**
 * Puts the new tab before or after the tab it was dropped beside. Beside a pinned tab, it goes first among the
 * workspace's other tabs, as Chrome keeps a tab that is not pinned after the pinned ones.
 */
function placeBeside(browser: Browser, tab: BrowserTab, beside: BrowserTab, placement: 'before' | 'after'): void {
  // A tab that closed or left the workspace meanwhile leaves the new tab last in its workspace, where it opened.
  if (browser.tabs.get(beside.id) !== beside || beside.mcpGroupId !== tab.mcpGroupId) return
  const ordered = orderedTabs(browser).filter((candidate) => candidate !== tab)
  const index = beside.pinned
    ? ordered.findLastIndex((candidate) => candidate.mcpGroupId === tab.mcpGroupId && candidate.pinned && !isHronautHomeUrl(candidate.url)) + 1
    : ordered.indexOf(beside) + (placement === 'after' ? 1 : 0)
  ordered.splice(index, 0, tab)
  browser.tabs.clear()
  for (const orderedTab of ordered) browser.tabs.set(orderedTab.id, orderedTab)
}
