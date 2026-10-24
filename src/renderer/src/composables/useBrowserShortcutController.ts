import { isHronautHomeUrl } from '../../../shared/home-url.js'
import { watch, type Ref } from 'vue'
import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import { pinnedWorkspaceAt, recentWorkspaces, WORKSPACE_CYCLE_MS } from '../../../shared/workspace-shortcuts.js'
import type {
  HronautApi,
  BrowserState,
  BrowserTabState
} from '../../../shared/types.js'

type ShortcutBrowserApi = Pick<
  HronautApi,
  'closeTab' | 'reopenClosedTab' | 'selectTab' | 'reload' | 'reloadIgnoringCache' | 'newTab' | 'reorderTab' | 'focusActivePage'
>

type ShortcutCallback = () => void | Promise<void>

export interface BrowserShortcutControllerOptions {
  state: Readonly<Ref<BrowserState>>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: ShortcutBrowserApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  settingsOpen: Ref<boolean>
  settingsTabOpen?: Ref<boolean>
  openSettings?: ShortcutCallback
  closeSettingsTab?: ShortcutCallback
  canRunAction: (action: BrowserShortcutAction) => boolean
  openNewTab: ShortcutCallback
  focusAddress: ShortcutCallback
  /** Hronaut Home, as the Home button opens it. */
  openHome?: ShortcutCallback
  openFind: ShortcutCallback
  /** The next or previous match of Find, opening it with its last text when it is closed. */
  findAgain?: (again: 'next' | 'previous') => void | Promise<void>
  setZoom: (action: 'in' | 'out' | 'reset') => void | Promise<void>
  toggleCurrentBookmark: ShortcutCallback
  toggleVisitHistory: ShortcutCallback
  toggleDownloads: ShortcutCallback
  toggleTabSearch: ShortcutCallback
  openPrivacySettings: ShortcutCallback
  toggleCommandPalette: ShortcutCallback
  toggleElementPicker: ShortcutCallback
  toggleDeveloperTools: ShortcutCallback
  showDeveloperToolsConsole: ShortcutCallback
  openAgentCard?: ShortcutCallback
  toggleFullPageView?: ShortcutCallback
  takeOverFromAgent?: ShortcutCallback
  toggleWorkspaceSwitcher?: ShortcutCallback
  onError: (action: BrowserShortcutAction, error: unknown) => void
}

export function useBrowserShortcutController(options: BrowserShortcutControllerOptions) {
  let generation = 0
  let disposed = false
  let tabSelectionQueue: Promise<void> = Promise.resolve()
  // The workspaces the previous-workspace key steps through while it is pressed again and again, the workspace shown
  // when it was last pressed and the one it went to.
  let workspaceCycle: { order: string[]; next: number; at: number; from?: string; target?: string } | undefined
  // The workspaces the person has viewed here, the latest first.
  const viewedWorkspaces: string[] = []
  const stopViewedWatch = watch(() => options.activeTab.value?.mcpGroupId, (groupId) => {
    if (!groupId) return
    const index = viewedWorkspaces.indexOf(groupId)
    if (index >= 0) viewedWorkspaces.splice(index, 1)
    viewedWorkspaces.unshift(groupId)
    viewedWorkspaces.splice(50)
  }, { immediate: true })

  function websiteTabs(): BrowserTabState[] {
    return options.state.value.tabs.filter((tab) => !isHronautHomeUrl(tab.url))
  }

  async function performRelativeTabSelection(offset: -1 | 1): Promise<void> {
    if (disposed) return
    const settingsId = 'hronaut:settings'
    const tabs = options.state.value.tabs.map(tab => ({ id: tab.id }))
    if (options.settingsTabOpen?.value) tabs.splice(1, 0, { id: settingsId })
    const activeTabId = options.settingsOpen.value ? settingsId : options.state.value.activeTabId
    if (tabs.length < 2 || !activeTabId) return
    const current = tabs.findIndex((tab) => tab.id === activeTabId)
    if (current < 0) return
    const next = tabs[(current + offset + tabs.length) % tabs.length]
    if (next?.id === settingsId) await options.openSettings?.()
    else if (next) {
      options.settingsOpen.value = false
      await options.syncState(options.browser.selectTab(next.id))
    }
  }

  function selectRelativeTab(offset: -1 | 1): Promise<void> {
    const selection = tabSelectionQueue.then(() => performRelativeTabSelection(offset))
    tabSelectionQueue = selection.catch(() => undefined)
    return selection
  }

  /**
   * Moves the website tab in view one place among its workspace's tabs, on its side of the pinned ones, as Chrome's
   * Ctrl+Shift+Page Down and Page Up do. At either end it stays where it is.
   */
  async function performTabMove(offset: -1 | 1): Promise<void> {
    // Settings may have come into view while earlier tab changes ran, over the website the press was for.
    if (disposed || options.settingsOpen.value) return
    const tab = options.activeTab.value
    if (!tab || isHronautHomeUrl(tab.url)) return
    const peers = websiteTabs().filter((candidate) => candidate.mcpGroupId === tab.mcpGroupId && candidate.pinned === tab.pinned)
    const index = peers.findIndex((candidate) => candidate.id === tab.id)
    const target = index < 0 ? undefined : peers[index + offset]
    if (!target) return
    await options.syncState(options.browser.reorderTab(tab.id, target.id, offset > 0 ? 'after' : 'before'))
  }

  function moveTab(offset: -1 | 1): Promise<void> {
    // After the tab changes that came before, so each press moves it from where the last one left it.
    const move = tabSelectionQueue.then(() => performTabMove(offset))
    tabSelectionQueue = move.catch(() => undefined)
    return move
  }

  function directTabIndex(action: BrowserShortcutAction): number | null {
    if (action === 'select-last-tab') return -1
    const match = /^select-tab-([1-8])$/.exec(action)
    return match ? Number(match[1]) - 1 : null
  }

  async function performDirectTabSelection(index: number): Promise<void> {
    if (disposed) return
    const tabs = websiteTabs()
    const target = index === -1 ? tabs.at(-1) : tabs[index]
    if (!target) return
    options.settingsOpen.value = false
    if (target.id === options.state.value.activeTabId) return
    await options.syncState(options.browser.selectTab(target.id))
  }

  function selectDirectTab(index: number): Promise<void> {
    const selection = tabSelectionQueue.then(() => performDirectTabSelection(index))
    tabSelectionQueue = selection.catch(() => undefined)
    return selection
  }

  /** Shows a workspace: its last active tab, or a new tab when it has none. */
  async function performWorkspaceSelection(groupId: string): Promise<void> {
    if (disposed) return
    const state = options.state.value
    const group = state.mcpTabGroups.find((candidate) => candidate.id === groupId)
    if (!group) return
    options.settingsOpen.value = false
    const tabId = group.activeTabId ?? state.tabs.find((tab) => tab.mcpGroupId === group.id)?.id
    if (!tabId) await options.syncState(options.browser.newTab({ mcpGroupId: group.id, active: true }))
    else if (tabId !== state.activeTabId) await options.syncState(options.browser.selectTab(tabId))
  }

  function selectWorkspace(groupId: string): Promise<void> {
    const selection = tabSelectionQueue.then(() => performWorkspaceSelection(groupId))
    tabSelectionQueue = selection.catch(() => undefined)
    return selection
  }

  /**
   * The workspace used before this one. Pressed again soon after, the next one further back, in the order of recent use
   * when the first press came, and then back to where it started; after a pause it goes back and forth.
   */
  function previousWorkspace(): string | undefined {
    const now = performance.now()
    const groups = options.state.value.mcpTabGroups
    const current = options.activeTab.value?.mcpGroupId
    // Another way of moving, such as a pinned-workspace key, starts over; the last press may still be on its way.
    if (!workspaceCycle || now - workspaceCycle.at > WORKSPACE_CYCLE_MS
      || (current !== workspaceCycle.target && current !== workspaceCycle.from)) {
      const order = recentWorkspaces(groups, current, viewedWorkspaces).map((group) => group.id)
      workspaceCycle = { order: current && order.length ? [...order, current] : order, next: 0, at: now }
    }
    const cycle = workspaceCycle
    cycle.at = now
    cycle.from = current
    // A workspace closed since the first press is passed over.
    for (let tried = 0; tried < cycle.order.length; tried += 1) {
      const id = cycle.order[cycle.next % cycle.order.length]
      cycle.next += 1
      if (id && id !== current && groups.some((group) => group.id === id)) {
        cycle.target = id
        return id
      }
    }
    return undefined
  }

  function pinnedWorkspacePosition(action: BrowserShortcutAction): number | null {
    const match = /^select-workspace-([1-9])$/.exec(action)
    return match ? Number(match[1]) : null
  }

  async function execute(action: BrowserShortcutAction): Promise<void> {
    const index = directTabIndex(action)
    if (index !== null) {
      await selectDirectTab(index)
      return
    }
    const position = pinnedWorkspacePosition(action)
    if (position !== null) {
      const target = pinnedWorkspaceAt(options.state.value.mcpTabGroups, position)
      if (target) await selectWorkspace(target.id)
      return
    }
    if (action === 'previous-workspace') {
      const target = previousWorkspace()
      if (target) await selectWorkspace(target)
      return
    }
    switch (action) {
      case 'focus-address':
        await options.focusAddress()
        return
      // Pressed in Hronaut's window or its rail, the next pane is the page; from a page, F6 reaches the menu's
      // focus-address instead.
      case 'focus-next-pane':
        await options.browser.focusActivePage()
        return
      case 'open-home':
        await options.openHome?.()
        return
      case 'find':
        await options.openFind()
        return
      case 'find-next':
        await options.findAgain?.('next')
        return
      case 'find-previous':
        await options.findAgain?.('previous')
        return
      case 'reload':
        if (options.activeTab.value) await options.syncState(options.browser.reload(options.activeTab.value.id))
        return
      case 'reload-ignoring-cache':
        if (options.activeTab.value) await options.syncState(options.browser.reloadIgnoringCache(options.activeTab.value.id))
        return
      case 'new-tab':
        await options.openNewTab()
        return
      case 'close-tab':
        if (options.settingsOpen.value) {
          if (options.closeSettingsTab) await options.closeSettingsTab()
          else options.settingsOpen.value = false
          return
        }
        if (options.activeTab.value) await options.syncState(options.browser.closeTab(options.activeTab.value.id))
        return
      case 'reopen-closed-tab':
        options.settingsOpen.value = false
        await options.syncState(options.browser.reopenClosedTab())
        return
      case 'next-tab':
        await selectRelativeTab(1)
        return
      case 'previous-tab':
        await selectRelativeTab(-1)
        return
      case 'move-tab-next':
        await moveTab(1)
        return
      case 'move-tab-previous':
        await moveTab(-1)
        return
      case 'zoom-in':
        await options.setZoom('in')
        return
      case 'zoom-out':
        await options.setZoom('out')
        return
      case 'zoom-reset':
        await options.setZoom('reset')
        return
      case 'bookmark':
        await options.toggleCurrentBookmark()
        return
      case 'visit-history':
        await options.toggleVisitHistory()
        return
      case 'downloads':
        await options.toggleDownloads()
        return
      case 'search-tabs':
        await options.toggleTabSearch()
        return
      case 'clear-browsing-data':
        await options.openPrivacySettings()
        return
      case 'command-palette':
        await options.toggleCommandPalette()
        return
      case 'pick-element':
        await options.toggleElementPicker()
        return
      case 'toggle-devtools':
        await options.toggleDeveloperTools()
        return
      case 'open-console':
        await options.showDeveloperToolsConsole()
        return
      case 'agent-card':
        await options.openAgentCard?.()
        return
      case 'toggle-full-page':
        await options.toggleFullPageView?.()
        return
      case 'take-over':
        await options.takeOverFromAgent?.()
        return
      case 'switch-workspace':
        await options.toggleWorkspaceSwitcher?.()
    }
  }

  async function run(action: BrowserShortcutAction): Promise<boolean> {
    if (
      disposed
      || !options.canRunAction(action)
      || (options.settingsOpen.value && [
        'reload', 'reload-ignoring-cache', 'find', 'find-next', 'find-previous', 'bookmark', 'pick-element',
        'toggle-devtools', 'open-console', 'zoom-in', 'zoom-out', 'zoom-reset', 'agent-card', 'toggle-full-page', 'take-over',
        'move-tab-next', 'move-tab-previous', 'focus-next-pane'
      ].includes(action))
    ) return false
    const operationGeneration = generation
    try {
      await execute(action)
      return !disposed && operationGeneration === generation
    } catch (error) {
      if (!disposed && operationGeneration === generation) options.onError(action, error)
      return false
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
    stopViewedWatch()
  }

  return {
    run,
    selectRelativeTab,
    dispose
  }
}

export type BrowserShortcutController = ReturnType<typeof useBrowserShortcutController>
