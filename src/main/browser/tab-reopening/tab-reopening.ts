import { MAX_BROWSER_TABS, type BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { uuidV7 } from '../../uuid-v7.js'
import { isHronautHomeUrl } from '../url.js'
import type { TabReopeningAccess, TabReopeningTab } from './tab-reopening-access.js'

const MAX_TABS = MAX_BROWSER_TABS
const MAX_CLOSED_TABS = MAX_TABS

/** Reopens the most recently closed tab, or the one with this id, and shows it, once tab label saves have settled. */
export async function reopenClosedTabAfterLabelSave<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, closedTabId?: string): Promise<BrowserState> {
  await reopenClosedTabEntry(access, closedTabId, true)
  return access.getState()
}

/**
 * Reopens the most recently closed tab, or the one with this id, showing it
 * when active is set. It is undefined when that tab is no longer remembered,
 * and the tab is remembered again when opening it fails.
 */
export async function reopenClosedTabEntry<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, closedTabId: string | undefined, active: boolean): Promise<Tab | undefined> {
  const index = closedTabId === undefined
    ? access.closedTabs().length - 1
    : access.closedTabs().findIndex((tab) => tab.id === closedTabId)
  if (index < 0) return undefined
  if (access.tabCount() >= MAX_TABS) throw new LocalizedError('appErrors.tabs.limit', { max: MAX_TABS })
  const [closed] = access.closedTabs().splice(index, 1)
  if (!closed) return undefined
  try {
    return await access.createTab({ url: closed.url, label: closed.label, pinned: closed.pinned, active, mcpGroupId: closed.mcpGroupId, zoomIsolated: closed.zoomIsolated === true, defaultFontSize: closed.defaultFontSize })
  } catch (error) {
    access.closedTabs().splice(index, 0, closed)
    throw error
  }
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
    defaultFontSize: source.defaultFontSize
  })
  access.reorderTab(duplicate.id, source.id, 'after')
  return access.getState()
}

/** Remembers a closed tab so it can be reopened, keeping only the newest; Hronaut Home is not remembered. */
export function rememberClosedTab<Tab extends TabReopeningTab>(access: TabReopeningAccess<Tab>, tab: Tab): void {
  if (isHronautHomeUrl(tab.url)) return
  access.closedTabs().push({
    id: uuidV7(),
    title: tab.title || tab.url,
    ...(tab.label ? { label: tab.label } : {}),
    url: tab.url,
    pinned: tab.pinned,
    closedAt: new Date().toISOString(),
    ...(tab.mcpGroupId ? { mcpGroupId: tab.mcpGroupId } : {}),
    ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
    ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {})
  })
  if (access.closedTabs().length > MAX_CLOSED_TABS) access.closedTabs().shift()
}
