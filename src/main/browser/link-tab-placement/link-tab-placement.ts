import { isHronautHomeUrl } from '../url.js'

/** The tab fields placing a tab a page opened reads. */
export interface LinkTabPlacementTab {
  id: string
  url: string
  pinned: boolean
  mcpGroupId?: string
  /** The tab whose page opened this one, from a link or a window it asked for. */
  openedFromTabId?: string
}

/**
 * Where a tab a page opened goes among its workspace's tabs, as in Chrome: right after the tab that opened it when it
 * opens in front, and after the tabs that tab already opened (and the tabs those opened) when it opens behind, so a
 * row of links opened one after another keeps their order beside the page. A pinned tab's links start after the
 * workspace's pinned tabs. The tab was just added after its workspace's tabs; the result is every tab in its new
 * order, or undefined when the tab stays last in its workspace, as a tab from the + button does.
 */
export function placeTabOpenedFromPage<Tab extends LinkTabPlacementTab>(ordered: readonly Tab[], tab: Tab, background: boolean): Tab[] | undefined {
  const opener = ordered.find((candidate) => candidate.id === tab.openedFromTabId)
  if (!opener || opener === tab || opener.mcpGroupId !== tab.mcpGroupId || tab.pinned
    || isHronautHomeUrl(opener.url) || isHronautHomeUrl(tab.url)) return undefined
  const others = ordered.filter((candidate) => candidate !== tab)
  const peers = others.filter((candidate) => candidate.mcpGroupId === tab.mcpGroupId && !candidate.pinned && !isHronautHomeUrl(candidate.url))
  let index = opener.pinned ? 0 : peers.indexOf(opener) + 1
  if (background) {
    const family = new Set([opener.id])
    for (const peer of peers.slice(index)) {
      if (!peer.openedFromTabId || !family.has(peer.openedFromTabId)) break
      family.add(peer.id)
      index += 1
    }
  }
  const next = peers[index]
  if (!next) return undefined
  others.splice(others.indexOf(next), 0, tab)
  return others
}
