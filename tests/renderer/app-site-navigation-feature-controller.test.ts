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
  const browser = {
    closeTab: vi.fn(async () => browserState.value),
    navigate: vi.fn(async () => browserState.value),
    reload: vi.fn(async () => browserState.value),
    reorderTab: vi.fn(async () => browserState.value),
    selectTab: vi.fn(async () => browserState.value),
    setAllHumanInteractionLocked: vi.fn(async () => browserState.value),
    setTabHumanInteractionLocked: vi.fn(async () => browserState.value),
    setTabMuted: vi.fn(async () => browserState.value),
    showWorkspaceContextMenu: vi.fn(async () => undefined),
    toggleDevTools: vi.fn(async () => true)
  }
  const siteSummary: BrowsingDataSiteSummary = {
    origin: 'https://example.test',
    cookieCount: 2,
    historyEntries: 3,
    historyVisits: 5
  }
  const loadSiteSummary = vi.fn(async () => siteSummary)
  const closeFind = vi.fn(async () => { findOpen.value = false })
  const onNavigateError = vi.fn()
  let controller!: ReturnType<typeof useAppSiteNavigationFeatureController>
  const view = render(defineComponent({
    setup() {
      controller = useAppSiteNavigationFeatureController({
        state: browserState,
        activeTab: computed(() => browserState.value.tabs[0]),
        browser,
        syncState: async (operation) => { browserState.value = await operation },
        isHome: () => false,
        collections: {
          bookmarks: ref([]),
          history: ref([]),
          downloadsOpen,
          bookmarksOpen,
          historyOpen
        },
        shell: {
          settingsOpen,
          settingsSection: ref('appearance'),
          updateNoticeOpen,
          tabSearchOpen,
          zoomOpen,
          findOpen
        },
        site: {
          keepsSeparatePanelOpen: () => false,
          activeUrl: () => 'https://example.test/path',
          activeOrigin: () => 'https://example.test',
          usesDefaultProfile: () => true,
          settingsEntryBlocked: () => false
        },
        address: {
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
          onSelectError: vi.fn(),
          onNavigateError
        }
      })
      return {}
    },
    template: '<div />'
  }))
  return {
    controller,
    view,
    browser,
    settingsOpen,
    updateNoticeOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen,
    zoomOpen,
    findOpen,
    closeFind,
    loadSiteSummary,
    onNavigateError
  }
}

describe('app site navigation feature controller', () => {
  it('coordinates address focus and site summary from one active-site context', async () => {
    const harness = createHarness()

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
    expect(harness.loadSiteSummary).toHaveBeenCalledWith({
      tabId: 'active',
      url: 'https://example.test/path'
    })
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

    expect(harness.onNavigateError).not.toHaveBeenCalled()
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
