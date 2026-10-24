import { MAX_BROWSER_TABS, type BrowserClosedTabState, type BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { uuidV7 } from '../../uuid-v7.js'
import { isHronautHomeUrl } from '../url.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import type { TabReopeningAccess, TabReopeningTab } from './tab-reopening-access.js'

const MAX_TABS = MAX_BROWSER_TABS
const MAX_CLOSED_TABS = MAX_TABS
/** The pages a closed tab keeps on each side of the one it showed, as Chrome's sessions keep (gMaxPersistNavigationCount). */
const MAX_CLOSED_TAB_PAGES_EACH_SIDE = 6

/** What a remembered closed tab had shown: its back and forward pages, and whether History counted its page yet. */
interface ClosedTabHistory {
  pages: NavigationHistorySnapshot
  visited: boolean
}

/**
 * The history of each remembered closed tab that had one, which reopening restores. It stays here in the main process,
 * out of the closed tabs the browser state publishes, as the pages' saved scroll and form state is in it, and it goes
 * with the closed tab wherever the tab is held, such as an archived workspace's.
 */
const closedTabHistories = new WeakMap<BrowserClosedTabState, ClosedTabHistory>()

/**
 * Reopens the most recently closed tab, or the one with this id, in its place among its workspace's tabs, and shows it,
 * once tab label saves have settled.
 */
export async function reopenClosedTabAfterLabelSave<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, closedTabId?: string): Promise<BrowserState> {
  await reopenClosedTabEntry(access, closedTabId, true)
  return access.getState()
}

/**
 * Reopens the most recently closed tab, or the one with this id, showing it
 * when active is set, in its place among its workspace's tabs, as Chrome
 * does. It is undefined when that tab is no longer remembered, and the tab is
 * remembered again when opening it fails, unless the history that showed it
 * was cleared meanwhile.
 */
export async function reopenClosedTabEntry<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, closedTabId: string | undefined, active: boolean): Promise<Tab | undefined> {
  const index = closedTabId === undefined
    ? access.closedTabs().length - 1
    : access.closedTabs().findIndex((tab) => tab.id === closedTabId)
  if (index < 0) return undefined
  if (access.tabCount() >= MAX_TABS) throw new LocalizedError('appErrors.tabs.limit', { max: MAX_TABS })
  // Held aside while the tab opens, where forgetting closed tabs still reaches it.
  const held = access.closedTabs().splice(index, 1)
  const closed = held[0]
  if (!closed) return undefined
  access.detachedClosedTabs().add(held)
  const history = closedTabHistories.get(closed)
  let tab: Tab
  try {
    // With its back and forward history, as Chrome reopens a tab; loading the page it showed again is not another
    // visit, unless History had not counted it yet. A tab closed before its first page came has none, and its page is
    // a visit once it comes.
    tab = await access.createTab({
      url: closed.url,
      title: closed.title,
      label: closed.label,
      pinned: closed.pinned,
      ...(history ? { navigationHistory: copyHistory(history.pages), suppressInitialHistory: history.visited } : {}),
      active,
      mcpGroupId: closed.mcpGroupId,
      zoomIsolated: closed.zoomIsolated === true,
      defaultFontSize: closed.defaultFontSize,
      muted: closed.muted === true,
      tabAgentPaused: closed.tabAgentPaused === true,
      humanInteractionLocked: closed.humanInteractionLocked === true
    })
  } catch (error) {
    if (held.length) access.closedTabs().splice(index, 0, closed)
    throw error
  } finally {
    access.detachedClosedTabs().delete(held)
  }
  if (closed.place !== undefined && tab.pinned === closed.pinned) moveToPlace(access, tab, closed.place)
  return tab
}

/** The website tabs a tab moves among: its workspace's, pinned or not as it is. */
function tabPeers<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, tab: Tab): Tab[] {
  return access.orderedTabs().filter((candidate) => (
    candidate.mcpGroupId === tab.mcpGroupId && candidate.pinned === tab.pinned && !isHronautHomeUrl(candidate.url)
  ))
}

/** Moves a tab just opened after its peers to this place among them, or after the last of them when there are fewer now. */
function moveToPlace<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, tab: Tab, place: number): void {
  const peers = tabPeers(access, tab)
  // A tab closed or moved while it opened stays as it is.
  if (peers.at(-1) !== tab) return
  const others = peers.slice(0, -1)
  const target = others[Math.min(place, others.length - 1)]
  if (target) access.reorderTab(tab.id, target.id, place < others.length ? 'before' : 'after')
}

/** Opens a copy of the tab, with its back and forward history, right after it, once tab label saves have settled. Hronaut Home has no copy. */
export async function duplicateTabAfterLabelSave<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, tabId: string): Promise<BrowserState> {
  const source = access.getTab(tabId)
  if (isHronautHomeUrl(source.url)) throw new LocalizedError('appErrors.tabs.homeNotDuplicated')
  const navigationHistory = access.navigationHistorySnapshot(source)
  const duplicate = await access.createTab({
    url: source.url,
    title: source.title,
    label: source.label,
    pinned: source.pinned,
    suppressInitialHistory: true,
    active: true,
    navigationHistory,
    mcpGroupId: source.mcpGroupId,
    zoomIsolated: source.zoomIsolated,
    defaultFontSize: source.defaultFontSize,
    muted: source.tabMuted,
    tabAgentPaused: source.tabAgentPaused,
    humanInteractionLocked: source.humanInteractionLocked
  })
  access.reorderTab(duplicate.id, source.id, 'after')
  return access.getState()
}

/**
 * Forgets the remembered closed tabs whose address matches, as Chrome does when history is cleared: Recently closed
 * names the pages, and Reopen closed tab would bring them back. Those held aside while a tab reopens or a workspace
 * closes are forgotten too, so they are not put back. True when any was forgotten.
 */
export function forgetClosedTabs<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, matches: (url: string) => boolean): boolean {
  let forgotten = false
  for (const closedTabs of [access.closedTabs(), ...access.detachedClosedTabs()]) {
    for (let index = closedTabs.length - 1; index >= 0; index -= 1) {
      const closed = closedTabs[index]!
      if (!matches(closed.url)) {
        forgetHistoryPages(closed, matches)
        continue
      }
      closedTabs.splice(index, 1)
      forgotten = true
    }
  }
  return forgotten
}

/**
 * Forgets the workspace's remembered closed tabs whose address matches, such as those on pages its Site access rules
 * now deny, including those held aside while a tab reopens or the workspace closes. True when any was forgotten.
 */
export function forgetWorkspaceClosedTabs<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, workspaceId: string, matches: (url: string) => boolean): boolean {
  let forgotten = false
  for (const closedTabs of [access.closedTabs(), ...access.detachedClosedTabs()]) {
    for (let index = closedTabs.length - 1; index >= 0; index -= 1) {
      const closed = closedTabs[index]!
      if (closed.mcpGroupId !== workspaceId) continue
      if (!matches(closed.url)) {
        forgetHistoryPages(closed, matches)
        continue
      }
      closedTabs.splice(index, 1)
      forgotten = true
    }
  }
  return forgotten
}

/**
 * Remembers a closed tab, with its place among its workspace's tabs and its history, given when it was taken before its
 * page went away, so it can be reopened, keeping only the newest; Hronaut Home and a tab a download left empty are not
 * remembered. It is called while the tab is still among the open tabs.
 */
export function rememberClosedTab<Tab extends TabReopeningTab>(
  access: TabReopeningAccess<Tab>,
  tab: Tab,
  navigationHistory: NavigationHistorySnapshot = access.navigationHistorySnapshot(tab)
): void {
  if (isHronautHomeUrl(tab.url) || tab.leftEmptyByDownload) return
  const place = tabPeers(access, tab).indexOf(tab)
  const closed: BrowserClosedTabState = {
    id: uuidV7(),
    title: tab.title || tab.url,
    ...(tab.label ? { label: tab.label } : {}),
    url: tab.url,
    pinned: tab.pinned,
    closedAt: new Date().toISOString(),
    ...(tab.mcpGroupId ? { mcpGroupId: tab.mcpGroupId } : {}),
    ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
    ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
    ...(tab.tabMuted ? { muted: true } : {}),
    ...(tab.tabAgentPaused ? { tabAgentPaused: true } : {}),
    ...(tab.humanInteractionLocked ? { humanInteractionLocked: true } : {}),
    ...(place >= 0 ? { place } : {})
  }
  const pages = closedTabHistory(navigationHistory, tab.url)
  // A page closed before it was ready had no visit yet, which it gets when it reopens.
  const visited = tab.suppressInitialHistory === true || tab.pendingHistoryUrl !== tab.url
  if (pages) closedTabHistories.set(closed, { pages, visited })
  access.closedTabs().push(closed)
  if (access.closedTabs().length > MAX_CLOSED_TABS) access.closedTabs().shift()
}

/**
 * The history a closed tab keeps: up to six pages on each side of the one it showed. None when the tab's history does
 * not show its own address, as before its first page commits, so it reopens at its address.
 */
function closedTabHistory(snapshot: NavigationHistorySnapshot, url: string): NavigationHistorySnapshot | undefined {
  if (snapshot.entries[snapshot.index]?.url !== url) return undefined
  const first = Math.max(0, snapshot.index - MAX_CLOSED_TAB_PAGES_EACH_SIDE)
  return copyHistory({
    entries: snapshot.entries.slice(first, snapshot.index + MAX_CLOSED_TAB_PAGES_EACH_SIDE + 1),
    index: snapshot.index - first
  })
}

/** A copy whose entries a restore or a later forgetting cannot change under another. */
function copyHistory(history: NavigationHistorySnapshot): NavigationHistorySnapshot {
  return { entries: history.entries.map((entry) => ({ ...entry })), index: history.index }
}

/**
 * Forgets the pages of a closed tab's back and forward history whose address matches, so a page whose history was
 * cleared does not come back with Back once the tab reopens; the page it showed is kept, as its address does not match.
 */
function forgetHistoryPages(closed: BrowserClosedTabState, matches: (url: string) => boolean): void {
  const history = closedTabHistories.get(closed)
  if (!history) return
  const { entries, index } = history.pages
  const kept = entries.filter((entry, entryIndex) => entryIndex === index || !matches(entry.url))
  if (kept.length === entries.length) return
  history.pages = { entries: kept, index: entries.slice(0, index).filter((entry) => !matches(entry.url)).length }
}
