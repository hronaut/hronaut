import { isHronautHomeUrl } from '../../../shared/home-url.js'
import type { BrowserSplitViewState } from '../../../shared/split-view.js'
import type { BrowserState, BrowserTabState } from '../../../shared/types.js'

/**
 * What a person's tab action will do to the browser state, shown at once instead of after main's answer: under several
 * agents main can take a few frames to answer. The store shows the guess over every state that arrives until the action
 * settles, and then only main's state, so a refused or different outcome replaces it. A guess leaves the state as it is
 * whenever it cannot tell what main will do.
 */
export type BrowserStateGuess = (state: BrowserState) => BrowserState

/**
 * Selecting a tab shows it: it becomes the active tab and its workspace's, the tab shown before it no longer is, and a
 * split view it is not part of is put aside, while one put aside that holds it shows again. Main shows a sleeping or
 * loading tab only once it has woken, which can take seconds, so no guess shows one before main does.
 */
export function guessTabSelected(tabId: string): BrowserStateGuess {
  return (state) => {
    const target = state.tabs.find((tab) => tab.id === tabId)
    if (!target || state.activeTabId === tabId || target.sleeping || target.loading) return state
    const tabs = state.tabs.map((tab) => tab.active === (tab.id === tabId) ? tab : { ...tab, active: tab.id === tabId })
    const mcpTabGroups = state.mcpTabGroups.map((group) => group.id === target.mcpGroupId && group.activeTabId !== tabId
      ? { ...group, activeTabId: tabId }
      : group)
    const next: BrowserState = { ...state, activeTabId: tabId, tabs, mcpTabGroups }
    if (state.splitView && holdsTab(state.splitView, tabId)) return next
    // A pair whose other tab can no longer show beside the tab ends, as main ends it.
    const pair = state.restingSplitViews?.find((split) => holdsTab(split, tabId))
    const partnerId = pair && (pair.firstTabId === tabId ? pair.secondTabId : pair.firstTabId)
    const partner = state.tabs.find((tab) => tab.id === partnerId)
    const resting = [...(state.restingSplitViews ?? []).filter((split) => split !== pair), ...(state.splitView ? [state.splitView] : [])]
    delete next.splitView
    delete next.restingSplitViews
    if (pair && partner && !isHronautHomeUrl(partner.url) && !isHronautHomeUrl(target.url)) next.splitView = pair
    if (resting.length) next.restingSplitViews = resting
    return next
  }
}

function holdsTab(split: BrowserSplitViewState, tabId: string): boolean {
  return split.firstTabId === tabId || split.secondTabId === tabId
}

/** Muting a tab, or turning its sound back on. */
export function guessTabMuted(tabId: string, muted: boolean): BrowserStateGuess {
  return (state) => {
    const index = state.tabs.findIndex((tab) => tab.id === tabId)
    const tab = state.tabs[index]
    if (!tab || tab.muted === muted) return state
    const tabs = [...state.tabs]
    tabs[index] = { ...tab, muted }
    return { ...state, tabs }
  }
}

/**
 * Moving tabs, in the order they have, before or after the target tab, as main moves them: only within the target's
 * workspace and on its side of the pinned boundary, and never Home. Main refuses any other move, so the guess makes none.
 */
export function guessTabsMoved(tabIds: readonly string[], targetTabId: string, placement: 'before' | 'after'): BrowserStateGuess {
  return (state) => {
    const target = state.tabs.find((tab) => tab.id === targetTabId)
    const ids = new Set(tabIds)
    const moving = state.tabs.filter((tab) => ids.has(tab.id))
    if (!target || ids.has(target.id) || moving.length !== ids.size || moving.length === 0) return state
    const movable = (tab: BrowserTabState) => tab.mcpGroupId === target.mcpGroupId && tab.pinned === target.pinned && !isHronautHomeUrl(tab.url)
    if (!movable(target) || !moving.every(movable)) return state
    const staying = state.tabs.filter((tab) => !ids.has(tab.id))
    staying.splice(staying.indexOf(target) + (placement === 'after' ? 1 : 0), 0, ...moving)
    return staying.every((tab, index) => tab === state.tabs[index]) ? state : { ...state, tabs: staying }
  }
}
