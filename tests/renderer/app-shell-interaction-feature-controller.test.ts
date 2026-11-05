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

function createHarness(extraNavigation: {
  selectBrowserTab?: (tabId: string) => Promise<boolean>
  takeOverFromAgent?: () => unknown
  tabStrip?: () => { selectedTabs: () => readonly string[]; foldedWorkspaceIds: () => ReadonlySet<string> | undefined } | undefined
} = {}) {
  const state = ref(browserState())
  const activeTab = computed(() => state.value.tabs.find((candidate) => candidate.id === state.value.activeTabId))
  const refs = {
    settings: ref(false),
    updateNotice: ref(false),
    help: ref(false),
    releaseHistory: ref(false),
    taskManager: ref(false),
    qrCode: ref(false),
    walletApproval: ref(false),
    trustedDialog: ref(false),
    agentSteps: ref(false),
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
    commandPalette: ref(false)
  }
  const closeSettings = vi.fn(() => { refs.settings.value = false })
  const closeHelp = vi.fn(() => { refs.help.value = false })
  const toggleTaskManager = vi.fn()
  const cancelTrustedDialog = vi.fn()
  const closeAgentSteps = vi.fn()
  const closeFind = vi.fn(async (_options?: { keepMatch?: boolean }) => undefined)
  const closeResponsivePreview = vi.fn()
  const reportActionError = vi.fn()
  const reportShortcutError = vi.fn()
  const browser = {
    openHome: vi.fn(async () => state.value),
    openHomeTabs: vi.fn(async () => state.value),
    newTab: vi.fn(async () => state.value),
    closeTab: vi.fn(async () => state.value),
    closeTabs: vi.fn(async () => state.value),
    reopenClosedTab: vi.fn(async () => state.value),
    selectTab: vi.fn(async () => state.value),
    reload: vi.fn(async () => state.value),
    reloadIgnoringCache: vi.fn(async () => state.value),
    reorderTab: vi.fn(async () => state.value),
    focusActivePage: vi.fn(async () => undefined)
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
    bookmarkAllTabs: asyncNoop,
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
    transient: {
      credentialPickerOpen: refs.credentialPicker,
      workspaceEditorOpen: refs.workspaceEditor,
      findOpen: refs.find,
      zoomOpen: refs.zoom,
      commandPaletteOpen: refs.commandPalette,
      commandPaletteView: ref<'commands' | 'workspaces'>('commands'),
      zoomBar: computed(() => null),
      commandPalettePanel: computed(() => null),
      agentStepsOpen: refs.agentSteps,
      closeAgentSteps,
      openFindForTab: asyncNoop,
      closeFind,
      closeWorkspace: noop,
      setZoom: asyncNoop
    },
    surfaces: {
      settings: { open: refs.settings, close: closeSettings, openSection: noop },
      updateNotice: refs.updateNotice,
      help: { open: refs.help, close: closeHelp, openDialog: noop },
      releaseHistory: { open: refs.releaseHistory, close: noop },
      taskManager: { open: refs.taskManager, close: noop, openDialog: noop, toggle: toggleTaskManager },
      qrCode: { open: refs.qrCode, close: noop },
      walletApproval: refs.walletApproval,
      trustedDialog: { open: refs.trustedDialog, cancel: cancelTrustedDialog },
      siteStorage: refs.siteStorage,
      siteControls: refs.siteControls,
      addressSuggestions: refs.addressSuggestions,
      pageTools: refs.pageTools,
      console: refs.console,
      network: refs.network,
      panelsInOwnWindow: () => false
    },
    features: {
      collections,
      emulation: {
        responsivePanelOpen: refs.responsive,
        environmentPanelOpen: refs.environment,
        closeResponsivePreview,
        toggleResponsivePreview: noop,
        toggleEnvironment: noop
      },
      pageTools,
      panels: { toggleConsole: noop, toggleNetworkMonitor: noop, openRequestConditions: noop },
      site: { toggleSiteStorage: noop, openPrivacySettings: noop, openUpdateSettings: noop }
    },
    navigation: {
      selectBrowserTab: async () => true,
      focusAddressInput: noop,
      expandTabGroup: noop,
      togglePageTools: noop,
      toggleDeveloperTools: asyncNoop,
      showDeveloperToolsConsole: asyncNoop,
      ...extraNavigation
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
    toggleTaskManager,
    cancelTrustedDialog,
    closeAgentSteps,
    closeFind,
    closeResponsivePreview,
    reportActionError,
    reportShortcutError
  }
}

describe('app shell interaction feature controller', () => {
  it('closes the tabs selected in the tab strip with the close-tab key', async () => {
    const harness = createHarness({ tabStrip: () => ({ selectedTabs: () => ['active', 'other'], foldedWorkspaceIds: () => undefined }) })

    await expect(harness.controller.runBrowserShortcut('close-tab')).resolves.toBe(true)

    expect(harness.browser.closeTabs).toHaveBeenCalledExactlyOnceWith(['active', 'other'])
    expect(harness.browser.closeTab).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('passes over the tabs of a workspace folded in the tab strip with the tab keys', async () => {
    const harness = createHarness({ tabStrip: () => ({ selectedTabs: () => [], foldedWorkspaceIds: () => new Set(['folded']) }) })
    const inWorkspace = (id: string, mcpGroupId: string) => ({ ...tab(id), mcpGroupId })
    harness.state.value = { ...harness.state.value, tabs: [inWorkspace('active', 'open'), inWorkspace('folded', 'folded'), inWorkspace('shown', 'open')] }

    await expect(harness.controller.runBrowserShortcut('select-tab-2')).resolves.toBe(true)
    await expect(harness.controller.runBrowserShortcut('select-last-tab')).resolves.toBe(true)

    expect(harness.browser.selectTab.mock.calls).toEqual([['shown'], ['shown']])
    harness.controller.dispose()
  })

  it('opens Home\'s Tabs view from the Search tabs shortcut and command, closing what covers Home', async () => {
    const harness = createHarness()
    harness.refs.settings.value = true
    harness.refs.updateNotice.value = true
    harness.refs.zoom.value = true

    await expect(harness.controller.runBrowserShortcut('search-tabs')).resolves.toBe(true)

    expect(harness.browser.openHomeTabs).toHaveBeenCalledOnce()
    expect(harness.syncState).toHaveBeenCalledOnce()
    expect(harness.refs.settings.value).toBe(false)
    expect(harness.refs.updateNotice.value).toBe(false)
    expect(harness.refs.zoom.value).toBe(false)

    harness.refs.commandPalette.value = true
    await harness.controller.runCommandPaletteCommand('search-tabs')

    expect(harness.browser.openHomeTabs).toHaveBeenCalledTimes(2)
    expect(harness.syncState).toHaveBeenCalledTimes(2)
    expect(harness.browser.openHome).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('routes command-palette browser commands through the shared shortcut controller', async () => {
    const harness = createHarness()

    await harness.controller.runCommandPaletteCommand('reload')

    expect(harness.browser.reload).toHaveBeenCalledWith('active')
    expect(harness.syncState).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('closes a site\'s request, All steps and the Responsive preview with Escape through their own controllers', () => {
    const harness = createHarness()
    const surfaces = [
      ['trustedDialog', harness.cancelTrustedDialog],
      ['agentSteps', harness.closeAgentSteps],
      ['responsive', harness.closeResponsivePreview]
    ] as const
    for (const [surface, close] of surfaces) {
      harness.refs[surface].value = true
      harness.controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
      expect(close, surface).toHaveBeenCalledOnce()
      harness.refs[surface].value = false
    }
    harness.controller.dispose()
  })

  it('closes Find with the person\'s Escape from elsewhere in the window, keeping its match', () => {
    const harness = createHarness()
    harness.refs.find.value = true

    harness.controller.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    expect(harness.closeFind).toHaveBeenCalledExactlyOnceWith({ keepMatch: true })
    harness.controller.dispose()
  })

  it('goes from Home to a website tab to focus the address, and stays on a website', async () => {
    const selectBrowserTab = vi.fn<(tabId: string) => Promise<boolean>>(async () => true)
    const harness = createHarness({ selectBrowserTab })
    const website = harness.state.value.tabs[0]
    harness.state.value = {
      ...harness.state.value,
      tabs: [website, { ...website, id: 'home', url: 'hronaut://home/' }],
      activeTabId: 'home'
    }

    await expect(harness.controller.runBrowserShortcut('focus-address')).resolves.toBe(true)
    expect(selectBrowserTab).toHaveBeenCalledExactlyOnceWith('active')

    harness.state.value = { ...harness.state.value, activeTabId: 'active' }
    await expect(harness.controller.runBrowserShortcut('focus-address')).resolves.toBe(true)
    expect(selectBrowserTab).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('keeps trusted approval modal while allowing tab escape from a page-input lock', async () => {
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
    await expect(harness.controller.runBrowserShortcut('close-tab')).resolves.toBe(true)
    expect(harness.browser.closeTab).toHaveBeenCalledWith('active')
    harness.controller.dispose()
  })

  it('goes to the next or previous match of Find by shortcut, but not over an open dialog', async () => {
    // Ctrl/Cmd+G reaches the menu from a dialog, which leaves it alone; with the palette or a wallet approval open, it
    // opened Find behind the dialog where Ctrl/Cmd+F does nothing.
    const harness = createHarness()
    await expect(harness.controller.runBrowserShortcut('find-next')).resolves.toBe(true)
    await expect(harness.controller.runBrowserShortcut('find-previous')).resolves.toBe(true)
    for (const dialog of ['commandPalette', 'workspaceEditor', 'credentialPicker', 'help', 'releaseHistory', 'taskManager', 'qrCode', 'agentSteps', 'walletApproval', 'settings'] as const) {
      harness.refs[dialog].value = true
      await expect(harness.controller.runBrowserShortcut('find-next'), dialog).resolves.toBe(false)
      await expect(harness.controller.runBrowserShortcut('find-previous'), dialog).resolves.toBe(false)
      harness.refs[dialog].value = false
    }
    harness.controller.dispose()
  })

  it('opens and closes the Task manager from the menu, but not over another dialog or the palette', async () => {
    // Chosen with the pointer, the View menu's Task manager reaches the shell under any dialog.
    const harness = createHarness()
    await expect(harness.controller.runBrowserShortcut('task-manager')).resolves.toBe(true)
    expect(harness.toggleTaskManager).toHaveBeenCalledOnce()
    for (const dialog of ['commandPalette', 'workspaceEditor', 'credentialPicker', 'help', 'releaseHistory', 'qrCode', 'agentSteps', 'walletApproval', 'trustedDialog', 'settings'] as const) {
      harness.refs[dialog].value = true
      await expect(harness.controller.runBrowserShortcut('task-manager'), dialog).resolves.toBe(false)
      harness.refs[dialog].value = false
    }
    expect(harness.toggleTaskManager).toHaveBeenCalledOnce()
    // Over its own dialog it closes it, as its key does.
    harness.refs.taskManager.value = true
    await expect(harness.controller.runBrowserShortcut('task-manager')).resolves.toBe(true)
    expect(harness.toggleTaskManager).toHaveBeenCalledTimes(2)
    // Not from under a site's request, a wallet approval or the sign-in picker that came up over it.
    for (const dialog of ['trustedDialog', 'walletApproval', 'credentialPicker'] as const) {
      harness.refs[dialog].value = true
      await expect(harness.controller.runBrowserShortcut('task-manager'), dialog).resolves.toBe(false)
      harness.refs[dialog].value = false
    }
    expect(harness.toggleTaskManager).toHaveBeenCalledTimes(2)
    // Downloads from the menu would open behind it.
    await expect(harness.controller.runBrowserShortcut('downloads')).resolves.toBe(false)
    harness.controller.dispose()
  })

  it('takes over from the agent by shortcut, but not over an open dialog', async () => {
    const takeOverFromAgent = vi.fn()
    const harness = createHarness({ takeOverFromAgent })
    await expect(harness.controller.runBrowserShortcut('take-over')).resolves.toBe(true)
    expect(takeOverFromAgent).toHaveBeenCalledOnce()
    harness.refs.commandPalette.value = true
    await expect(harness.controller.runBrowserShortcut('take-over')).resolves.toBe(false)
    harness.refs.commandPalette.value = false
    harness.refs.workspaceEditor.value = true
    await expect(harness.controller.runBrowserShortcut('take-over')).resolves.toBe(false)
    expect(takeOverFromAgent).toHaveBeenCalledOnce()
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
