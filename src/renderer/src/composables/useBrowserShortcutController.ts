import type { Ref } from 'vue'
import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type {
  HronautApi,
  BrowserState,
  BrowserTabState
} from '../../../shared/types.js'

type ShortcutBrowserApi = Pick<
  HronautApi,
  'closeTab' | 'reopenClosedTab' | 'selectTab' | 'reload' | 'reloadIgnoringCache'
>

type ShortcutCallback = () => void | Promise<void>

export interface BrowserShortcutControllerOptions {
  state: Readonly<Ref<BrowserState>>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: ShortcutBrowserApi
  syncState: (operation: Promise<BrowserState> | BrowserState) => Promise<void>
  settingsOpen: Ref<boolean>
  canRunAction: (action: BrowserShortcutAction) => boolean
  openNewTab: ShortcutCallback
  focusAddress: ShortcutCallback
  openFind: ShortcutCallback
  setZoom: (action: 'in' | 'out' | 'reset') => void | Promise<void>
  toggleCurrentBookmark: ShortcutCallback
  toggleVisitHistory: ShortcutCallback
  toggleTabSearch: ShortcutCallback
  openPrivacySettings: ShortcutCallback
  toggleCommandPalette: ShortcutCallback
  toggleElementPicker: ShortcutCallback
  toggleDeveloperTools: ShortcutCallback
  onError: (action: BrowserShortcutAction, error: unknown) => void
}

export function useBrowserShortcutController(options: BrowserShortcutControllerOptions) {
  let generation = 0
  let disposed = false
  let tabSelectionQueue: Promise<void> = Promise.resolve()

  function websiteTabs(): BrowserTabState[] {
    return options.state.value.tabs.filter((tab) => !tab.url.startsWith('hronaut://home'))
  }

  async function performRelativeTabSelection(offset: -1 | 1): Promise<void> {
    if (disposed) return
    const tabs = options.state.value.tabs
    const activeTabId = options.state.value.activeTabId
    if (tabs.length < 2 || !activeTabId) return
    const current = tabs.findIndex((tab) => tab.id === activeTabId)
    if (current < 0) return
    const next = tabs[(current + offset + tabs.length) % tabs.length]
    if (next) await options.syncState(options.browser.selectTab(next.id))
  }

  function selectRelativeTab(offset: -1 | 1): Promise<void> {
    const selection = tabSelectionQueue.then(() => performRelativeTabSelection(offset))
    tabSelectionQueue = selection.catch(() => undefined)
    return selection
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
    if (!target || target.id === options.state.value.activeTabId) return
    await options.syncState(options.browser.selectTab(target.id))
  }

  function selectDirectTab(index: number): Promise<void> {
    const selection = tabSelectionQueue.then(() => performDirectTabSelection(index))
    tabSelectionQueue = selection.catch(() => undefined)
    return selection
  }

  async function execute(action: BrowserShortcutAction): Promise<void> {
    const index = directTabIndex(action)
    if (index !== null) {
      await selectDirectTab(index)
      return
    }
    switch (action) {
      case 'focus-address':
        await options.focusAddress()
        return
      case 'find':
        await options.openFind()
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
    }
  }

  async function run(action: BrowserShortcutAction): Promise<boolean> {
    if (
      disposed
      || !options.canRunAction(action)
      || (options.state.value.allHumanInteractionLocked && action === 'close-tab')
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
  }

  return {
    run,
    selectRelativeTab,
    dispose
  }
}

export type BrowserShortcutController = ReturnType<typeof useBrowserShortcutController>
