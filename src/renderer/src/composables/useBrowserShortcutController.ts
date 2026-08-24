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

  async function selectRelativeTab(offset: -1 | 1): Promise<void> {
    const tabs = options.state.value.tabs
    const activeTabId = options.state.value.activeTabId
    if (tabs.length < 2 || !activeTabId) return
    const current = tabs.findIndex((tab) => tab.id === activeTabId)
    if (current < 0) return
    const next = tabs[(current + offset + tabs.length) % tabs.length]
    if (next) await options.syncState(options.browser.selectTab(next.id))
  }

  async function execute(action: BrowserShortcutAction): Promise<void> {
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
    if (disposed || (options.state.value.allHumanInteractionLocked && action === 'close-tab')) return false
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
