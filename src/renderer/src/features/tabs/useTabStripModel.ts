import { computed } from 'vue'
import { isHronautHomeUrl } from '../../../../shared/home-url.js'
import type { BrowserSplitViewState } from '../../../../shared/split-view.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../../../shared/types.js'

/** A tab as the strip places and marks it. Its own row draws the rest, such as its title, icon and loading state. */
export interface StripTab extends Pick<BrowserTabState, 'id' | 'mcpGroupId' | 'active' | 'pinned'> {
  /** The tab shows Hronaut Home, which the Home button stands for instead of a row. */
  home: boolean
}

/** A workspace as the strip shows it, without its counts and times, which change while agents work in it. */
export type StripWorkspace = Pick<BrowserTabGroupState, 'id' | 'name' | 'description' | 'color' | 'pinnedAt' | 'hiddenFromSidebar'>

/** The Home tab as the Home button shows it. */
export interface StripHomeTab {
  active: boolean
  loading: boolean
}

/** Which two tabs the split view shows and how, without where its divider is. */
export type StripSplitView = Omit<BrowserSplitViewState, 'ratio'>

/**
 * What the tab strip draws from the browser state. Each part stays the same value while what it holds stays equal, and
 * each row reads its own tab with readTab, so a new state, such as one where an agent's page got its title, draws again
 * only the rows of the tabs that changed rather than the whole strip with every row and button in it.
 */
export function useTabStripModel(readState: () => BrowserState) {
  const tabs = computed<readonly StripTab[]>((previous) => {
    const next = readState().tabs.map((tab): StripTab => ({
      id: tab.id,
      mcpGroupId: tab.mcpGroupId,
      active: tab.active,
      pinned: tab.pinned,
      home: isHronautHomeUrl(tab.url)
    }))
    return previous && sameItems(previous, next) ? previous : next
  })

  const home = computed<StripHomeTab | undefined>((previous) => {
    const tab = readState().tabs.find((candidate) => isHronautHomeUrl(candidate.url))
    if (!tab) return undefined
    return previous?.active === tab.active && previous.loading === tab.loading ? previous : { active: tab.active, loading: tab.loading }
  })

  const workspaces = computed<readonly StripWorkspace[]>((previous) => {
    const next = readState().mcpTabGroups.map((group): StripWorkspace => ({
      id: group.id,
      name: group.name,
      description: group.description,
      color: group.color,
      pinnedAt: group.pinnedAt,
      hiddenFromSidebar: group.hiddenFromSidebar
    }))
    return previous && sameItems(previous, next) ? previous : next
  })

  const splitView = computed<StripSplitView | undefined>((previous) => {
    const split = readState().splitView
    if (!split) return undefined
    const next: StripSplitView = { firstTabId: split.firstTabId, secondTabId: split.secondTabId, orientation: split.orientation }
    return previous && sameFields(previous, next) ? previous : next
  })

  /** The split views put aside, whose tabs stay paired, as in Chrome. */
  const restingSplitViews = computed<readonly StripSplitView[]>((previous) => {
    const next = (readState().restingSplitViews ?? []).map((split): StripSplitView => ({
      firstTabId: split.firstTabId, secondTabId: split.secondTabId, orientation: split.orientation
    }))
    return previous && sameItems(previous, next) ? previous : next
  })

  const allHumanInteractionLocked = computed(() => readState().allHumanInteractionLocked)
  const allTabsMuted = computed(() => readState().allTabsMuted === true)
  const activeTabId = computed(() => readState().activeTabId)

  // The shell's store keeps its list of tabs while none of them changed, and the map with it, so no row looks again.
  let mappedTabs: readonly BrowserTabState[] | undefined
  const tabsById = computed<ReadonlyMap<string, BrowserTabState>>((previous) => {
    const tabs = readState().tabs
    if (previous && tabs === mappedTabs) return previous
    mappedTabs = tabs
    return new Map(tabs.map((tab) => [tab.id, tab]))
  })
  /** A tab of the latest state by its id; a row reads its tab with it, so the row alone draws again when the tab changes. */
  const readTab = (tabId: string): BrowserTabState | undefined => tabsById.value.get(tabId)

  /** How the split view in view shows the tab, or the one put aside pairs it; undefined when it is in none. */
  const tabSplit = (tabId: string): { orientation: 'horizontal' | 'vertical'; paired: boolean } | undefined => {
    const holds = (split: StripSplitView): boolean => split.firstTabId === tabId || split.secondTabId === tabId
    const shown = splitView.value
    const split = shown && holds(shown) ? shown : restingSplitViews.value.find(holds)
    if (!split) return undefined
    return { orientation: split.orientation === 'horizontal' ? 'horizontal' : 'vertical', paired: split !== shown }
  }

  return { tabs, home, workspaces, splitView, restingSplitViews, tabSplit, allHumanInteractionLocked, allTabsMuted, activeTabId, readTab }
}

function sameItems<T extends object>(previous: readonly T[], next: readonly T[]): boolean {
  return previous.length === next.length && previous.every((item, index) => sameFields(item, next[index]))
}

function sameFields(left: object, right: object): boolean {
  const before = left as Record<string, unknown>
  const after = right as Record<string, unknown>
  const keys = Object.keys(after)
  return keys.length === Object.keys(before).length && keys.every((key) => before[key] === after[key])
}
