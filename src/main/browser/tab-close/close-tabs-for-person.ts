import type { BrowserState } from '../../../shared/types.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { isHronautHomeUrl } from '../url.js'
import type { PersonTabCloseAccess, PersonTabCloseTab } from './close-tabs-for-person-access.js'

/**
 * Closes tabs for the person, in order, stopping at one whose page asks to stay. The shown tab closes last, so it
 * hands over to a tab that stays open rather than waking a sleeping one only to close it next. Undo reopens those that
 * closed, each in its place among its workspace's tabs.
 */
export async function closeTabsForPerson<Tab extends PersonTabCloseTab>(access: PersonTabCloseAccess<Tab>, tabIds: readonly string[]): Promise<BrowserState> {
  const closed: { closedTabId: string; index: number; title: string }[] = []
  const pending = [...tabIds]
  try {
    while (pending.length) {
      const otherIndex = pending.findIndex((candidate) => candidate !== access.activeTabId())
      const tabId = pending.splice(otherIndex === -1 ? 0 : otherIndex, 1)[0]!
      const tab = tabIds.length === 1 ? access.getTab(tabId) : access.findTab(tabId)
      if (!tab) continue
      const index = tabPeers(access, tab).indexOf(tab)
      const remembered = new Set(access.closedTabs().map((entry) => entry.id))
      // The person's own close yields to a tab they select while the one that replaces it wakes.
      await access.closeTabInternal(tabId, true, true, true)
      if (access.findTab(tabId) === tab) break
      const entry = access.closedTabs().findLast((candidate) => !remembered.has(candidate.id) && candidate.url === tab.url && candidate.mcpGroupId === tab.mcpGroupId)
      if (entry) closed.push({ closedTabId: entry.id, index, title: entry.label || tabTitleForDisplay(entry, access.text('tabSearch.newTabTitle')) })
    }
  } finally {
    if (closed.length) {
      access.options().offerUndo?.({
        kind: 'tabs-closed',
        name: closed.at(-1)!.title,
        count: closed.length,
        undo: () => reopenClosedTabsInPlace(access, closed)
      })
    }
  }
  return access.getState()
}

/** The website tabs a tab moves among: its workspace's, pinned or not as it is. */
function tabPeers<Tab extends PersonTabCloseTab>(access: PersonTabCloseAccess<Tab>, tab: Tab): Tab[] {
  return access.orderedTabs().filter((candidate) => (
    candidate.mcpGroupId === tab.mcpGroupId && candidate.pinned === tab.pinned && !isHronautHomeUrl(candidate.url)
  ))
}

/** Reopens tabs closed together, the last closed first, so each goes back where it was; one tab is shown again. */
/** False when none of them could be reopened, such as after Reopen closed tab took them. */
function reopenClosedTabsInPlace<Tab extends PersonTabCloseTab>(access: PersonTabCloseAccess<Tab>, closed: readonly { closedTabId: string; index: number }[]): Promise<boolean> {
  return access.withTabLabelLifecycle(async () => {
    let reopened = 0
    for (const { closedTabId, index } of [...closed].reverse()) {
      const tab = await access.reopenClosedTabEntry(closedTabId, closed.length === 1)
      if (!tab) continue
      reopened += 1
      const peers = tabPeers(access, tab).filter((candidate) => candidate !== tab)
      const target = peers[Math.min(index, peers.length - 1)]
      if (target) access.reorderTab(tab.id, target.id, index < peers.length ? 'before' : 'after')
    }
    return reopened > 0
  })
}
