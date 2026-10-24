import type { NavigationEntry } from 'electron'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { SLEEPING_PAGE_URL } from '../tab-sleep/sleeping-page.js'

/** The tab fields forgetting cleared pages from open tabs' Back and Forward lists reads and changes. */
export interface TabHistoryPagesTab {
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
 * Histories taken from a tab and kept while something is waited for, such as a waking tab's history it goes back to
 * sleep with or a closing tab's history while its page answers whether it may close. They are held weakly, so a history
 * no longer used is let go.
 */
const heldHistories = new Set<WeakRef<NavigationHistorySnapshot>>()

/**
 * Lets forgetting cleared pages also reach a history kept while something is waited for, so it does not bring them back
 * afterwards; the history is given back.
 */
export function holdTabHistory<History extends NavigationHistorySnapshot | undefined>(history: History): History {
  if (!history) return history
  if (heldHistories.size >= 32) {
    for (const held of heldHistories) if (!held.deref()) heldHistories.delete(held)
  }
  heldHistories.add(new WeakRef(history))
  return history
}

/** Forgets the matching pages of a history taken from a tab, keeping the page it shows. True when any page went. */
function forgetPages(history: NavigationHistorySnapshot, matches: (url: string) => boolean): boolean {
  const { entries, index } = history
  const kept = entries.filter((entry, entryIndex) => entryIndex === index || !matches(entry.url))
  if (kept.length === entries.length) return false
  history.index = entries.slice(0, index).filter((entry) => !matches(entry.url)).length
  history.entries = kept
  return true
}

/**
 * Forgets the matching pages of a tab's own history, keeping the page it shows, as does a page Chromium is loading,
 * which it does not let go. A tab that shows the sleeping page keeps its own page before it, which it goes back to when
 * it wakes. True when any page went.
 */
function forgetOpenTabPages(webContents: TabHistoryPagesTab['webContents'], matches: (url: string) => boolean): boolean {
  let forgotten = false
  try {
    const history = webContents.navigationHistory
    const shown = history.getActiveIndex()
    const ownPage = history.getEntryAtIndex(shown)?.url === SLEEPING_PAGE_URL ? shown - 1 : shown
    for (let index = history.length() - 1; index >= 0; index -= 1) {
      if (index === shown || index === ownPage) continue
      const entry = history.getEntryAtIndex(index)
      if (entry && matches(entry.url) && history.removeEntryAtIndex(index)) forgotten = true
    }
  } catch {
    // Electron can destroy a page between isDestroyed() and the history calls while its tab closes.
  }
  return forgotten
}

/**
 * Forgets the pages whose history was cleared or removed from the Back and Forward lists of open tabs, as Chrome does,
 * so Back no longer leads to them and their saved scroll and form state goes, and from the histories held while
 * something is waited for. The page each tab shows stays. True when any page of an open tab went.
 */
export function forgetTabHistoryPages(tabs: Iterable<TabHistoryPagesTab>, matches: (url: string) => boolean): boolean {
  let forgotten = false
  for (const tab of tabs) {
    if (tab.sleepNavigationHistory && forgetPages(tab.sleepNavigationHistory, matches)) forgotten = true
    if (!tab.webContents.isDestroyed() && forgetOpenTabPages(tab.webContents, matches)) forgotten = true
  }
  for (const held of heldHistories) {
    const history = held.deref()
    if (history) forgetPages(history, matches)
    else heldHistories.delete(held)
  }
  return forgotten
}
