import { ref, watch, type Ref } from 'vue'
import type { BrowserTabState } from '../../../shared/types.js'

interface TabSelectionOptions {
  /** Whether the bar selects several tabs; the copy of the rail drawn over the page does not. */
  enabled: () => boolean
  /** The tabs the bar lists, in its order. */
  tabs: Readonly<Ref<readonly BrowserTabState[]>>
  activeTabId: () => string | null
  /** Command adds a tab on macOS, where Control with a click opens the menu; Control does elsewhere. */
  platform: () => string | undefined
  /** Shows the tab, as clicking it does. */
  activate: (tabId: string) => void
}

/**
 * Selecting several tabs of a workspace, as in Chrome's tab strip: Ctrl+click (Cmd+click on macOS) adds a tab to the
 * selection and shows it, or takes a selected tab out; Shift+click selects the tabs from the last one clicked to it
 * and shows it. A plain click, or a tab shown any other way, leaves only the shown tab selected again, and the
 * selection never spans workspaces. The tab menu and a drag act on every selected tab.
 */
export function useTabSelection(options: TabSelectionOptions) {
  /** The selected tabs in the bar's order while there are several, else none. */
  const selectedTabIds = ref<string[]>([])
  // Where a Shift+click selects from: the tab last clicked, or the one shown.
  let anchorTabId: string | null = options.activeTabId()

  function select(tabIds: ReadonlySet<string>): void {
    const ordered = options.tabs.value.filter((tab) => tabIds.has(tab.id)).map((tab) => tab.id)
    selectedTabIds.value = ordered.length > 1 ? ordered : []
  }

  function clearSelection(): void {
    if (selectedTabIds.value.length) selectedTabIds.value = []
  }

  /** Handles a click that selects; a click it leaves alone, without Ctrl, Cmd or Shift, is the bar's plain click. */
  function selectsOnClick(event: MouseEvent, tab: BrowserTabState): boolean {
    const toggle = options.platform() === 'darwin' ? event.metaKey : event.ctrlKey
    const tabs = options.tabs.value
    const workspaceOf = (tabId: string | null) => tabs.find((candidate) => candidate.id === tabId)?.mcpGroupId
    const shown = options.activeTabId()
    const current = selectedTabIds.value.length ? selectedTabIds.value : shown && tabs.some((candidate) => candidate.id === shown) ? [shown] : []
    // A tab of another workspace starts over, as a plain click does.
    if (!options.enabled() || (!toggle && !event.shiftKey) || current.some((tabId) => workspaceOf(tabId) !== tab.mcpGroupId)) {
      clearSelection()
      anchorTabId = tab.id
      return false
    }
    if (event.shiftKey) {
      const anchor = anchorTabId !== null && workspaceOf(anchorTabId) === tab.mcpGroupId && tabs.some((candidate) => candidate.id === anchorTabId)
        ? anchorTabId
        : current[0] ?? tab.id
      const from = tabs.findIndex((candidate) => candidate.id === anchor)
      const to = tabs.findIndex((candidate) => candidate.id === tab.id)
      const range = tabs.slice(Math.min(from, to), Math.max(from, to) + 1).map((candidate) => candidate.id)
      // With Ctrl or Cmd too, the range adds to the selection.
      select(new Set(toggle ? [...current, ...range] : range))
      options.activate(tab.id)
      return true
    }
    anchorTabId = tab.id
    if (!current.includes(tab.id)) {
      select(new Set([...current, tab.id]))
      options.activate(tab.id)
      return true
    }
    // The only selected tab stays selected, as in Chrome.
    const remaining = current.filter((tabId) => tabId !== tab.id)
    if (!remaining.length) return true
    select(new Set(remaining))
    if (tab.id === shown) {
      // The selected tab nearest to it is shown instead.
      const index = tabs.findIndex((candidate) => candidate.id === tab.id)
      const distance = (tabId: string) => Math.abs(tabs.findIndex((candidate) => candidate.id === tabId) - index)
      const nearest = remaining.reduce((best, tabId) => distance(tabId) < distance(best) ? tabId : best)
      options.activate(nearest)
    }
    return true
  }

  // A tab shown another way, as from the keyboard, tab search or an agent, leaves only that tab selected.
  watch(options.activeTabId, (tabId) => {
    if (tabId !== null && selectedTabIds.value.includes(tabId)) return
    clearSelection()
    anchorTabId = tabId
  })

  // A closed tab, or one hidden in a folded workspace, leaves the selection.
  watch(() => options.tabs.value.map((tab) => tab.id).join('|'), () => {
    if (selectedTabIds.value.length) select(new Set(selectedTabIds.value))
  })

  watch(options.enabled, (enabled) => {
    if (!enabled) clearSelection()
  })

  /** The tabs a menu or drag of this tab acts on: every selected tab when it is one of them, else none. */
  function selectionWith(tabId: string): string[] {
    return selectedTabIds.value.includes(tabId) ? [...selectedTabIds.value] : []
  }

  return { selectedTabIds, selectsOnClick, selectionWith, clearSelection }
}
