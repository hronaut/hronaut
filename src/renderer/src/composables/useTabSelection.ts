import { ref, watch, type Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'

interface TabSelectionOptions {
  /** Whether the bar selects several tabs; the copy of the rail drawn over the page does not. */
  enabled: () => boolean
  /** The tabs the bar lists, in its order. */
  tabs: Readonly<Ref<readonly BrowserTabState[]>>
  activeTabId: () => string | null
  /** Whether Settings is drawn over the page, so that no tab is shown. */
  covered: () => boolean
  /** Command adds a tab on macOS, where Control with a click opens the menu; Control does elsewhere. */
  platform: () => string | undefined
  /** Shows the tab, as clicking it does. */
  activate: (tabId: string) => void
}

/**
 * Selecting several tabs of a workspace, as in Chrome's tab strip: Ctrl+click (Cmd+click on macOS) adds a tab to the
 * selection and shows it, or takes a selected tab out; Shift+click selects the tabs from the last one clicked to it
 * and shows it. A plain click, a tab shown any other way, or Settings leaves only the shown tab selected again, and
 * the selection never spans workspaces. The tab menu and a drag act on every selected tab.
 */
export function useTabSelection(options: TabSelectionOptions) {
  /** The selected tabs in the bar's order while there are several, else none. */
  const selectedTabIds = ref<string[]>([])
  // Where a Shift+click selects from: the tab last clicked, or the one shown.
  let anchorTabId: string | null = options.covered() ? null : options.activeTabId()
  // The tabs this bar asked to show that the state does not show yet, oldest first. A tab shown at the bar's request
  // keeps the selection, and the next click counts from the tab it asked for, however soon it comes.
  let pendingTabIds: string[] = []

  function workspaceOf(tabId: string | null): string | undefined {
    return options.tabs.value.find((candidate) => candidate.id === tabId)?.mcpGroupId
  }

  function listed(tabId: string | null): boolean {
    return options.tabs.value.some((candidate) => candidate.id === tabId)
  }

  function select(tabIds: ReadonlySet<string>): void {
    const ordered = options.tabs.value.filter((tab) => tabIds.has(tab.id)).map((tab) => tab.id)
    selectedTabIds.value = ordered.length > 1 ? ordered : []
  }

  function clearSelection(): void {
    if (selectedTabIds.value.length) selectedTabIds.value = []
  }

  function shownTabId(): string | null {
    if (options.covered()) return null
    return pendingTabIds[pendingTabIds.length - 1] ?? options.activeTabId()
  }

  function show(tabId: string): void {
    // Showing the tab already shown changes no state, so nothing is waited for.
    if (pendingTabIds.length || tabId !== options.activeTabId()) pendingTabIds.push(tabId)
    options.activate(tabId)
  }

  /** Shows the clicked tab, or with Ctrl, Cmd or Shift changes the selection. */
  function clickTab(event: MouseEvent, tab: BrowserTabState): void {
    const toggle = options.platform() === 'darwin' ? event.metaKey : event.ctrlKey
    const tabs = options.tabs.value
    const shown = shownTabId()
    const current = selectedTabIds.value.length ? selectedTabIds.value : shown !== null && listed(shown) ? [shown] : []
    // A tab of another workspace starts over, as a plain click does.
    if (!options.enabled() || (!toggle && !event.shiftKey) || current.some((tabId) => workspaceOf(tabId) !== tab.mcpGroupId)) {
      clearSelection()
      anchorTabId = tab.id
      show(tab.id)
      return
    }
    if (event.shiftKey) {
      const anchor = anchorTabId !== null && workspaceOf(anchorTabId) === tab.mcpGroupId ? anchorTabId : current[0] ?? tab.id
      const from = tabs.findIndex((candidate) => candidate.id === anchor)
      const to = tabs.findIndex((candidate) => candidate.id === tab.id)
      const range = tabs.slice(Math.min(from, to), Math.max(from, to) + 1).map((candidate) => candidate.id)
      // With Ctrl or Cmd too, the range adds to the selection.
      select(new Set(toggle ? [...current, ...range] : range))
      show(tab.id)
      return
    }
    anchorTabId = tab.id
    if (!current.includes(tab.id)) {
      select(new Set([...current, tab.id]))
      show(tab.id)
      return
    }
    // The only selected tab stays selected, as in Chrome.
    const remaining = current.filter((tabId) => tabId !== tab.id)
    if (!remaining.length) return
    select(new Set(remaining))
    // Taking out the shown tab shows the first selected tab instead, as in Chrome.
    if (tab.id === shown) show(remaining[0])
  }

  // A tab the bar asked for keeps the selection; one shown another way, as from the keyboard, tab search, the rail
  // drawn over the page or an agent, leaves only that tab selected, even when it was one of them.
  watch(options.activeTabId, (tabId) => {
    const requested = tabId === null ? -1 : pendingTabIds.indexOf(tabId)
    if (requested >= 0) {
      pendingTabIds = pendingTabIds.slice(requested + 1)
      return
    }
    pendingTabIds = []
    clearSelection()
    anchorTabId = tabId
  })

  // Settings drawn over the page shows no tab, as a page of its own would.
  watch(options.covered, (covered) => {
    if (!covered) return
    clearSelection()
    anchorTabId = null
  })

  // A closed tab, one hidden in a folded workspace, or one moved to another workspace leaves the selection.
  watch(() => options.tabs.value.map((tab) => `${tab.id}:${tab.mcpGroupId ?? ''}`).join('|'), () => {
    pendingTabIds = pendingTabIds.filter(listed)
    if (anchorTabId !== null && !listed(anchorTabId)) anchorTabId = null
    const stillListed = selectedTabIds.value.filter(listed)
    if (!stillListed.length) {
      clearSelection()
      return
    }
    const shown = shownTabId()
    const workspace = workspaceOf(shown !== null && stillListed.includes(shown) ? shown : stillListed[0])
    select(new Set(stillListed.filter((tabId) => workspaceOf(tabId) === workspace)))
  })

  watch(options.enabled, (enabled) => {
    if (!enabled) clearSelection()
  })

  /** The tabs a menu or drag of this tab acts on: every selected tab when it is one of them, else none. */
  function selectionWith(tabId: string): string[] {
    return selectedTabIds.value.includes(tabId) ? [...selectedTabIds.value] : []
  }

  return { selectedTabIds, clickTab, selectionWith, clearSelection }
}
