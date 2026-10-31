import { render } from '@testing-library/vue'
import { computed, defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppSiteNavigationFeatureController } from '../../src/renderer/src/composables/useAppSiteNavigationFeatureController.js'
import type { BrowserState, BrowserTabState, BrowsingDataSiteSummary } from '../../src/shared/types.js'

function tab(): BrowserTabState {
  return {
    id: 'active',
    title: 'Active page',
    url: 'https://example.test/path',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function state(): BrowserState {
  const active = tab()
  return {
    tabs: [active],
    closedTabs: [],
    activeTabId: active.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/tmp/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createHarness() {
  const browserState = ref(state())
  const settingsOpen = ref(true)
  const updateNoticeOpen = ref(true)
  const downloadsOpen = ref(true)
  const bookmarksOpen = ref(true)
  const historyOpen = ref(true)
  const tabSearchOpen = ref(true)
  const zoomOpen = ref(true)
  const findOpen = ref(true)
  const findFocused = ref(false)
  const browser = {
    closeTab: vi.fn(async () => browserState.value),
    navigate: vi.fn(async () => browserState.value),
    newTab: vi.fn(async () => browserState.value),
    reload: vi.fn(async () => browserState.value),
    proceedPastCertificateError: vi.fn(async () => browserState.value),
    reorderTab: vi.fn(async () => browserState.value),
    reorderTabs: vi.fn(async () => browserState.value),
    selectTab: vi.fn(async () => browserState.value),
    setAllTabsMuted: vi.fn(async () => browserState.value),
    setAllHumanInteractionLocked: vi.fn(async () => browserState.value),
    setTabHumanInteractionLocked: vi.fn(async () => browserState.value),
    setTabAgentPaused: vi.fn(async () => browserState.value),
    setTabPageLifecycle: vi.fn(async () => browserState.value),
    setTabMuted: vi.fn(async () => browserState.value),
    showWorkspaceContextMenu: vi.fn(async () => undefined),
    toggleDevTools: vi.fn(async () => true),
    showDevToolsConsole: vi.fn(async () => true)
  }
  const siteSummary: BrowsingDataSiteSummary = {
    origin: 'https://example.test',
    cookieCount: 2,
    historyEntries: 3,
    historyVisits: 5
  }
  const loadSiteSummary = vi.fn(async () => siteSummary)
  const closeFind = vi.fn(async () => { findOpen.value = false })
  const showToast = vi.fn()
  const setFollowAgentActivitySuspended = vi.fn()
  let controller!: ReturnType<typeof useAppSiteNavigationFeatureController>
  const view = render(defineComponent({
    setup() {
      controller = useAppSiteNavigationFeatureController({
        state: browserState,
        activeTab: computed(() => browserState.value.tabs[0]),
        browser,
        syncState: async (operation) => { browserState.value = await operation },
        collections: {
          bookmarks: ref([]),
          history: ref([]),
          removeHistoryEntry: vi.fn(async () => []),
          downloadsOpen,
          bookmarksOpen,
          historyOpen
        },
        shell: {
          setFollowAgentActivitySuspended,
          settingsOpen,
          settingsSection: ref('appearance'),
          updateNoticeOpen,
          tabSearchOpen,
          zoomOpen,
          findOpen,
          findFocused
        },
        site: {
          keepsSeparatePanelOpen: () => false,
          activeUrl: () => 'https://example.test/path',
          activeOrigin: () => 'https://example.test',
          settingsEntryBlocked: () => false
        },
        address: {
          siteSearches: () => [],
          theme: () => 'dark',
          locale: () => 'en-US',
          translate: (key) => key,
          formatNumber: String
        },
        privacy: {
          janitorSearch: ref(''),
          refresh: vi.fn(async () => undefined)
        },
        actions: {
          closeTransientPanels: vi.fn(),
          closeHelp: vi.fn(),
          closeFind,
          openSettingsSection: vi.fn(),
          loadSiteSummary,
          onActionError: vi.fn(),
          showToast
        }
      })
      return {}
    },
    template: '<div />'
  }))
  return {
    controller,
    view,
    browserState,
    browser,
    settingsOpen,
    updateNoticeOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen,
    zoomOpen,
    findOpen,
    findFocused,
    closeFind,
    loadSiteSummary,
    showToast,
    setFollowAgentActivitySuspended
  }
}

describe('app site navigation feature controller', () => {
  it('coordinates address focus and site summary from one active-site context', async () => {
    const harness = createHarness()

    expect(harness.setFollowAgentActivitySuspended).toHaveBeenLastCalledWith(false)

    harness.controller.addressBarController.handleFocus()
    await harness.controller.siteDataController.refresh()

    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.updateNoticeOpen.value).toBe(false)
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(false)
    expect(harness.historyOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)
    expect(harness.zoomOpen.value).toBe(false)
    expect(harness.closeFind).toHaveBeenCalledOnce()
    expect(harness.setFollowAgentActivitySuspended).toHaveBeenLastCalledWith(true)
    expect(harness.loadSiteSummary).toHaveBeenCalledWith({
      tabId: 'active',
      url: 'https://example.test/path'
    })
    harness.view.unmount()
    expect(harness.setFollowAgentActivitySuspended).toHaveBeenLastCalledWith(false)
  })

  // Following the agents' activity showed another tab while the person read the matches of Find, which closed Find.
  it('holds following the agents while the keyboard is in Find, as in the address bar', async () => {
    const harness = createHarness()
    expect(harness.setFollowAgentActivitySuspended).toHaveBeenLastCalledWith(false)
    harness.findFocused.value = true
    expect(harness.setFollowAgentActivitySuspended).toHaveBeenLastCalledWith(true)
    harness.findFocused.value = false
    expect(harness.setFollowAgentActivitySuspended).toHaveBeenLastCalledWith(false)
    harness.view.unmount()
  })

  it('disposes tab actions so late navigation failures cannot escape app teardown', async () => {
    const harness = createHarness()
    const pending = deferred<BrowserState>()
    harness.browser.navigate.mockReturnValueOnce(pending.promise)

    const navigation = harness.controller.browserTabActionsController.navigateAddress('https://slow.test/')
    harness.view.unmount()
    pending.reject(new Error('late navigation failure'))
    await navigation

    expect(harness.showToast).not.toHaveBeenCalled()
  })

  it('locks a website tab\'s input, and leaves Home alone', async () => {
    const harness = createHarness()
    harness.browserState.value = { ...state(), tabs: [{ ...tab(), url: 'hronaut://home/' }] }

    await harness.controller.browserTabActionsController.toggleTabHumanInteraction()
    expect(harness.browser.setTabHumanInteractionLocked).not.toHaveBeenCalled()

    harness.browserState.value = state()
    await harness.controller.browserTabActionsController.toggleTabHumanInteraction()
    expect(harness.browser.setTabHumanInteractionLocked).toHaveBeenCalledExactlyOnceWith('active', true)
    harness.view.unmount()
  })

  it('says when an address or a tab could not be opened', async () => {
    const harness = createHarness()
    harness.browser.navigate.mockRejectedValueOnce(new Error(''))
    await harness.controller.browserTabActionsController.navigateAddress('https://refused.test/')
    expect(harness.showToast).toHaveBeenLastCalledWith('error', 'runtime.navigation.failed', 'runtime.navigation.failedDescription')

    harness.browser.selectTab.mockRejectedValueOnce(new Error(''))
    await expect(harness.controller.browserTabActionsController.selectBrowserTab('active')).resolves.toBe(false)
    expect(harness.showToast).toHaveBeenLastCalledWith('error', 'runtime.workspace.openFailed', 'runtime.workspace.openDescription')
    expect(harness.showToast).toHaveBeenCalledTimes(2)
    harness.view.unmount()
  })

  it('invalidates a pending site summary when the app is torn down', async () => {
    const harness = createHarness()
    const pending = deferred<BrowsingDataSiteSummary>()
    harness.loadSiteSummary.mockReturnValueOnce(pending.promise)

    const refresh = harness.controller.siteDataController.refresh()
    harness.view.unmount()
    pending.resolve({
      origin: 'https://example.test',
      cookieCount: 99,
      historyEntries: 99,
      historyVisits: 99
    })
    await refresh

    expect(harness.controller.siteDataController.summary.value).toBeNull()
    expect(harness.controller.siteDataController.state.value).toBe('idle')
  })
})
