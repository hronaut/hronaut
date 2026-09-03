import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAppShellInteractionFeatureController } from '../../src/renderer/src/composables/useAppShellInteractionFeatureController.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string): BrowserTabState {
  return {
    id,
    url: `https://${id}.test/`,
    title: id,
    active: true,
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
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

function browserState(allHumanInteractionLocked = false): BrowserState {
  const active = tab('active')
  return {
    tabs: [active],
    closedTabs: [],
    activeTabId: active.id,
    allHumanInteractionLocked,
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
  const state = ref(browserState())
  const activeTab = computed(() => state.value.tabs.find((candidate) => candidate.id === state.value.activeTabId))
  const refs = {
    settings: ref(false),
    updateNotice: ref(false),
    help: ref(false),
    releaseHistory: ref(false),
    walletApproval: ref(false),
    siteStorage: ref(false),
    siteControls: ref(false),
    addressSuggestions: ref(false),
    pageTools: ref(false),
    console: ref(false),
    network: ref(false),
    responsive: ref(false),
    environment: ref(false),
    credentialPicker: ref(false),
    workspaceEditor: ref(false),
    find: ref(false),
    zoom: ref(false),
    tabSearch: ref(false),
    commandPalette: ref(false)
  }
  const closeSettings = vi.fn(() => { refs.settings.value = false })
  const closeHelp = vi.fn(() => { refs.help.value = false })
  const reportActionError = vi.fn()
  const reportShortcutError = vi.fn()
  const browser = {
    openHome: vi.fn(async () => state.value),
    newTab: vi.fn(async () => state.value),
    closeTab: vi.fn(async () => state.value),
    reopenClosedTab: vi.fn(async () => state.value),
    selectTab: vi.fn(async () => state.value),
    reload: vi.fn(async () => state.value),
    reloadIgnoringCache: vi.fn(async () => state.value)
  }
  const syncState = vi.fn(async (operation: Promise<BrowserState> | BrowserState) => {
    state.value = await operation
  })
  const noop = vi.fn()
  const asyncNoop = vi.fn(async () => undefined)
  const collections = {
    downloadsOpen: ref(false),
    bookmarksOpen: ref(false),
    bookmarksPanel: ref(null),
    historyOpen: ref(false),
    toggleCurrentBookmark: asyncNoop,
    toggleVisitHistory: asyncNoop,
    toggleDownloads: asyncNoop,
    toggleBookmarks: asyncNoop
  }
  const pageTools = {
    panelOpen: refs.pageTools,
    accessibilityPanelOpen: ref(false),
    qualityAuditPanelOpen: ref(false),
    performancePanelOpen: ref(false),
    designOverviewPanelOpen: ref(false),
    pageMetadataPanelOpen: ref(false),
    securityPanelOpen: ref(false),
    coveragePanelOpen: ref(false),
    cpuProfilePanelOpen: ref(false),
    memoryPanelOpen: ref(false),
    debugReportPanelOpen: ref(false),
    reproPanelOpen: ref(false),
    domChangesPanelOpen: ref(false),
    visualComparePanelOpen: ref(false),
    inspectorIssuesOpen: ref(false),
    areaCaptureState: ref<'idle' | 'picking'>('idle'),
    elementPickerState: ref<'idle' | 'picking'>('idle'),
    toggleAreaCapture: asyncNoop,
    cancelActiveElementPicker: asyncNoop,
    toggleElementPicker: asyncNoop,
    capturePageScreenshot: asyncNoop,
    copyPageSnapshot: asyncNoop,
    toggleInspectorIssues: asyncNoop,
    toggleDebugReport: asyncNoop,
    toggleReproRecorder: asyncNoop,
    toggleDomChanges: asyncNoop,
    toggleVisualCompare: asyncNoop,
    toggleQualityAudit: asyncNoop,
    toggleAccessibilityAudit: asyncNoop,
    togglePerformanceReport: asyncNoop,
    toggleDesignOverview: asyncNoop,
    togglePageMetadata: asyncNoop,
    toggleSecurityReport: asyncNoop,
    toggleCodeCoverage: asyncNoop,
    toggleCpuProfile: asyncNoop,
    toggleMemoryReport: asyncNoop
  }
  const controller = useAppShellInteractionFeatureController({
    state,
    activeTab,
    browser,
    syncState,
    isHome: () => false,
    transient: {
      credentialPickerOpen: refs.credentialPicker,
      workspaceEditorOpen: refs.workspaceEditor,
      findOpen: refs.find,
      zoomOpen: refs.zoom,
      tabSearchOpen: refs.tabSearch,
      commandPaletteOpen: refs.commandPalette,
      tabSearchPanel: computed(() => null),
      zoomBar: computed(() => null),
      commandPalettePanel: computed(() => null),
      openFindForTab: asyncNoop,
      closeFind: asyncNoop,
      closeWorkspace: noop,
      setZoom: asyncNoop
    },
    surfaces: {
      settings: { open: refs.settings, close: closeSettings, openSection: noop },
      updateNotice: refs.updateNotice,
      help: { open: refs.help, close: closeHelp, openDialog: noop },
      releaseHistory: { open: refs.releaseHistory, close: noop },
      walletApproval: refs.walletApproval,
      siteStorage: refs.siteStorage,
      siteControls: refs.siteControls,
      addressSuggestions: refs.addressSuggestions,
      pageTools: refs.pageTools,
      console: refs.console,
      network: refs.network,
      responsive: { open: refs.responsive, close: noop },
      environment: refs.environment
    },
    features: {
      collections,
      emulation: { toggleResponsivePreview: noop, toggleEnvironment: noop },
      pageTools,
      panels: { toggleConsole: noop, toggleNetworkMonitor: noop, openRequestConditions: noop },
      site: { toggleSiteStorage: noop, openPrivacySettings: noop, openUpdateSettings: noop }
    },
    navigation: {
      selectBrowserTab: async () => true,
      focusAddressInput: noop,
      expandTabGroup: noop,
      togglePageTools: noop,
      toggleDeveloperTools: asyncNoop
    },
    actions: {
      closeTransientPanels: noop,
      toggleMcpPaused: asyncNoop,
      openPurchase: asyncNoop,
      reportActionError,
      reportSplitViewError: noop,
      reportWorkspaceError: noop,
      reportShortcutError
    }
  })
  return {
    controller,
    state,
    refs,
    browser,
    syncState,
    reportActionError,
    reportShortcutError
  }
}

describe('app shell interaction feature controller', () => {
  it('routes command-palette browser commands through the shared shortcut controller', async () => {
    const harness = createHarness()

    await harness.controller.runCommandPaletteCommand('reload')

    expect(harness.browser.reload).toHaveBeenCalledWith('active')
    expect(harness.syncState).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('keeps trusted approval and interaction locks ahead of browser shortcuts', async () => {
    const harness = createHarness()
    harness.refs.walletApproval.value = true
    const approvalShortcut = new KeyboardEvent('keydown', {
      key: 'r', ctrlKey: true, cancelable: true
    })
    const approvalEscape = new KeyboardEvent('keydown', {
      key: 'Escape', cancelable: true
    })

    harness.controller.handleKeyDown(approvalShortcut)
    harness.controller.handleKeyDown(approvalEscape)
    expect(approvalEscape.defaultPrevented).toBe(true)
    expect(harness.browser.reload).not.toHaveBeenCalled()

    harness.refs.walletApproval.value = false
    harness.state.value = browserState(true)
    await expect(harness.controller.runBrowserShortcut('close-tab')).resolves.toBe(false)
    expect(harness.browser.closeTab).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('suppresses late shortcut and UI-action failures after aggregate disposal', async () => {
    const harness = createHarness()
    const pendingShortcut = deferred<BrowserState>()
    const pendingAction = deferred<void>()
    harness.browser.reload.mockReturnValueOnce(pendingShortcut.promise)

    const shortcut = harness.controller.runBrowserShortcut('reload')
    const action = harness.controller.runShellAction(() => pendingAction.promise)
    harness.controller.dispose()
    pendingShortcut.reject(new Error('late shortcut failure'))
    pendingAction.reject(new Error('late action failure'))

    await expect(shortcut).resolves.toBe(false)
    await expect(action).resolves.toBe(false)
    expect(harness.reportShortcutError).not.toHaveBeenCalled()
    expect(harness.reportActionError).not.toHaveBeenCalled()
  })
})
