/**
 * The tab and site an entry came from. Unlike wallet requests, entries stay
 * listed across the site's own navigations, such as a dApp's route change,
 * because nothing waits on them.
 */
export interface WalletPage {
  workspaceId: string
  tabId: string
  topLevelOrigin: string
}

interface StoredEntry<T> {
  page: WalletPage
  entry: T
}

/**
 * What each tab's sites did, for `wallet_page_requests`: the newest
 * maxPerTab entries of each of the maxTabs most recently used tabs.
 */
export class WalletPageLog<T extends object> {
  private readonly tabs = new Map<string, Array<StoredEntry<T>>>()

  constructor(private readonly maxPerTab: number, private readonly maxTabs: number) {}

  add(page: WalletPage, entry: T): void {
    const key = tabKey(page)
    const entries = this.tabs.get(key) ?? []
    entries.push({ page: { workspaceId: page.workspaceId, tabId: page.tabId, topLevelOrigin: page.topLevelOrigin }, entry })
    if (entries.length > this.maxPerTab) entries.splice(0, entries.length - this.maxPerTab)
    this.tabs.delete(key)
    this.tabs.set(key, entries)
    for (const [leastRecent] of this.tabs) {
      if (this.tabs.size <= this.maxTabs) break
      this.tabs.delete(leastRecent)
    }
  }

  /** Entries of the tab's current site, oldest first. */
  forPage(page: WalletPage): T[] {
    return (this.tabs.get(tabKey(page)) ?? [])
      .filter((stored) => stored.page.topLevelOrigin === page.topLevelOrigin)
      .map((stored) => ({ ...stored.entry }))
  }

  clear(predicate: (page: WalletPage) => boolean): void {
    for (const [key, entries] of this.tabs) {
      if (entries[0] && predicate(entries[0].page)) this.tabs.delete(key)
    }
  }
}

function tabKey(page: WalletPage): string {
  return JSON.stringify([page.workspaceId, page.tabId])
}
