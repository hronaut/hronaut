/** The tab fields following which page opened which tab reads and changes. */
export interface LinkTabOpenerTab {
  id: string
  mcpGroupId?: string
  /** The tab whose page opened this one, from a link or a window it asked for, until Hronaut forgets it. */
  openedFromTabId?: string
}

/**
 * The tab to show when the shown tab closes, if a page of its workspace opened it, as in Chrome: the next tab that
 * page's tab opened, to its right first and then to its left (the tabs the closing tab opened count among them),
 * otherwise the tab that opened it. Undefined when no page opened it, or none of these can show, so the tab beside it
 * shows instead.
 */
export function tabAfterClosingLinkTab<Tab extends LinkTabOpenerTab>(
  ordered: readonly Tab[],
  tab: Tab,
  canShow: (candidate: Tab) => boolean
): Tab | undefined {
  const opener = ordered.find((candidate) => candidate.id === tab.openedFromTabId)
  if (!opener || opener === tab || opener.mcpGroupId !== tab.mcpGroupId) return undefined
  const index = ordered.indexOf(tab)
  const sibling = (candidate: Tab) => (
    candidate !== tab && candidate.mcpGroupId === tab.mcpGroupId && canShow(candidate)
    && (candidate.openedFromTabId === opener.id || candidate.openedFromTabId === tab.id)
  )
  return ordered.slice(index + 1).find(sibling)
    ?? ordered.slice(0, index).reverse().find(sibling)
    ?? (canShow(opener) ? opener : undefined)
}

/**
 * Hands the tabs a closed tab opened to the tab that opened it, as Chrome does, so they count among that page's tabs;
 * they were opened from no page once it was not.
 */
export function handOverTabsOpenedFrom<Tab extends LinkTabOpenerTab>(tabs: Iterable<Tab>, closed: Tab): void {
  for (const tab of tabs) {
    if (tab === closed || tab.openedFromTabId !== closed.id) continue
    if (closed.openedFromTabId && closed.openedFromTabId !== tab.id) tab.openedFromTabId = closed.openedFromTabId
    else delete tab.openedFromTabId
  }
}

/**
 * Forgets which page opened each tab of a workspace, as Chrome does when a page there opens a tab in front, or a tab
 * there goes to an address typed or given rather than followed from a link.
 */
export function forgetTabsOpenedFrom<Tab extends LinkTabOpenerTab>(tabs: Iterable<Tab>, mcpGroupId: string | undefined): void {
  if (!mcpGroupId) return
  for (const tab of tabs) {
    if (tab.mcpGroupId === mcpGroupId) delete tab.openedFromTabId
  }
}

/**
 * Whether the person going from one tab to another of the same workspace turns to another task, after which Chrome
 * forgets which page opened which tab: neither tab opened the other, and the two were not opened from the same page.
 */
export function switchLeavesOpenedTabs(from: LinkTabOpenerTab, to: LinkTabOpenerTab): boolean {
  if (from === to || !from.mcpGroupId || from.mcpGroupId !== to.mcpGroupId) return false
  return from.openedFromTabId !== to.openedFromTabId && to.openedFromTabId !== from.id && from.openedFromTabId !== to.id
}
