import type { BrowserState } from '../../../shared/types.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { findTab, getTab, orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { withTabLabelLifecycle } from '../tab-labels/tab-labels.js'
import { reopenClosedTabEntry } from '../tab-reopening/tab-reopening.js'
import { browserState } from '../browser-state/browser-state.js'
import { reorderTab } from '../tab-arrangement/tab-arrangement.js'

/**
 * Closes tabs for the person, in order, stopping at one whose page asks to stay. The shown tab closes last, so it
 * hands over to a tab that stays open rather than waking a sleeping one only to close it next. Undo reopens those that
 * closed, each in its place among its workspace's tabs.
 */
export async function closeTabsForPerson(browser: Browser, tabIds: readonly string[]): Promise<BrowserState> {
  const closed: { closedTabId: string; index: number; title: string }[] = []
  const pending = [...tabIds]
  try {
    while (pending.length) {
      const otherIndex = pending.findIndex((candidate) => candidate !== browser.activeTabId)
      const tabId = pending.splice(otherIndex === -1 ? 0 : otherIndex, 1)[0]!
      const tab = tabIds.length === 1 ? getTab(browser, tabId) : findTab(browser, tabId)
      if (!tab) continue
      const index = tabPeers(browser, tab).indexOf(tab)
      const remembered = new Set(browser.closedTabs.map((entry) => entry.id))
      // The person's own close yields to a tab they select while the one that replaces it wakes.
      await browser.closeTabInternal(tabId, true, true, true)
      if (findTab(browser, tabId) === tab) break
      const entry = browser.closedTabs.findLast((candidate) => !remembered.has(candidate.id) && candidate.url === tab.url && candidate.mcpGroupId === tab.mcpGroupId)
      if (entry) closed.push({ closedTabId: entry.id, index, title: entry.label || tabTitleForDisplay(entry, browser.text('tabSearch.newTabTitle')) })
    }
  } finally {
    if (closed.length) {
      browser.options.offerUndo?.({
        kind: 'tabs-closed',
        name: closed.at(-1)!.title,
        count: closed.length,
        undo: () => reopenClosedTabsInPlace(browser, closed)
      })
    }
  }
  return browserState(browser)
}

/** The website tabs a tab moves among: its workspace's, pinned or not as it is. */
function tabPeers(browser: Browser, tab: BrowserTab): BrowserTab[] {
  return orderedTabs(browser).filter((candidate) => (
    candidate.mcpGroupId === tab.mcpGroupId && candidate.pinned === tab.pinned && !isHronautHomeUrl(candidate.url)
  ))
}

/** Reopens tabs closed together, the last closed first, so each goes back where it was; one tab is shown again. */
/** False when none of them could be reopened, such as after Reopen closed tab took them. */
function reopenClosedTabsInPlace(browser: Browser, closed: readonly { closedTabId: string; index: number }[]): Promise<boolean> {
  return withTabLabelLifecycle(browser, async () => {
    let reopened = 0
    for (const { closedTabId, index } of [...closed].reverse()) {
      const tab = await reopenClosedTabEntry(browser, closedTabId, closed.length === 1)
      if (!tab) continue
      reopened += 1
      const peers = tabPeers(browser, tab).filter((candidate) => candidate !== tab)
      const target = peers[Math.min(index, peers.length - 1)]
      if (target) reorderTab(browser, tab.id, target.id, index < peers.length ? 'before' : 'after')
    }
    return reopened > 0
  })
}
