import type { NavigationEntry } from 'electron'
import type { NavigationHistorySnapshot } from '../navigation-history.js'

/** The tab fields forgetting cleared pages from open tabs' Back and Forward lists reads and changes. */
export interface TabHistoryPagesTab {
  sleeping: boolean
  wakePromise?: Promise<void>
  /** The history a sleeping tab shows and wakes with. */
  sleepNavigationHistory?: NavigationHistorySnapshot
  webContents: {
    isDestroyed(): boolean
    navigationHistory: {
      length(): number
      getActiveIndex(): number
      getEntryAtIndex(index: number): NavigationEntry | null
      removeEntryAtIndex(index: number): boolean
    }
  }
}

/**
 * Forgets the pages whose history was cleared or removed from the Back and Forward lists of open tabs, as Chrome does,
 * so Back no longer leads to them and their saved scroll and form state goes. The page each tab shows stays, as does a
 * page Chromium is loading, which it does not let go. True when any page went.
 */
export function forgetTabHistoryPages(tabs: Iterable<TabHistoryPagesTab>, matches: (url: string) => boolean): boolean {
  let forgotten = false
  for (const tab of tabs) {
    if (tab.sleepNavigationHistory) {
      const { entries, index } = tab.sleepNavigationHistory
      const kept = entries.filter((entry, entryIndex) => entryIndex === index || !matches(entry.url))
      if (kept.length !== entries.length) {
        const keptBefore = entries.slice(0, index).filter((entry) => !matches(entry.url)).length
        tab.sleepNavigationHistory = { entries: kept, index: keptBefore }
        forgotten = true
      }
    }
    if (tab.webContents.isDestroyed()) continue
    const history = tab.webContents.navigationHistory
    const shown = history.getActiveIndex()
    // A sleeping or waking tab shows the sleeping page after its own page, which it goes back to when it wakes.
    const ownPage = tab.sleeping || tab.wakePromise ? shown - 1 : shown
    for (let index = history.length() - 1; index >= 0; index -= 1) {
      if (index === shown || index === ownPage) continue
      const entry = history.getEntryAtIndex(index)
      if (entry && matches(entry.url) && history.removeEntryAtIndex(index)) forgotten = true
    }
  }
  return forgotten
}
