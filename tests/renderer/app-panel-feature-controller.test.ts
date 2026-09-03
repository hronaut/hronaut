import { nextTick, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useAppPanelFeatureController,
  type AppPanelFeatureControllerOptions
} from '../../src/renderer/src/composables/useAppPanelFeatureController.js'
import { DETACHABLE_PANEL_IDS } from '../../src/shared/types.js'
import type {
  BrowserTabState,
  DetachablePanelId,
  HronautPanelWindowApi,
  PanelDock,
  PanelRedockRequest
} from '../../src/shared/types.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

type PanelListeners = {
  requested?: (panel: DetachablePanelId) => void
  active?: (panel: DetachablePanelId) => void
  redock?: (request: PanelRedockRequest) => void
  closed?: () => void
}

function createHarness(
  detachedWindow = false,
  waitForPresentationTurn?: () => Promise<void>,
  beforeCreate?: (
    api: HronautPanelWindowApi,
    panels: Record<DetachablePanelId, Ref<boolean>>
  ) => void
) {
  const panels = Object.fromEntries(DETACHABLE_PANEL_IDS.map((panel) => [panel, ref(false)])) as Record<DetachablePanelId, Ref<boolean>>
  const panelDock = ref<PanelDock>('right')
  const listeners: PanelListeners = {}
  const unsubscribers = Array.from({ length: 4 }, () => vi.fn())
  const openPanelWindow = vi.fn(async () => undefined)
  const panelWindowApi: HronautPanelWindowApi = {
    open: openPanelWindow,
    close: vi.fn(async () => undefined),
    setActive: vi.fn(async () => undefined),
    redock: vi.fn(async () => undefined),
    onPanelRequested: vi.fn((listener: NonNullable<PanelListeners['requested']>) => {
      listeners.requested = listener
      return unsubscribers[0]
    }),
    onActivePanelChanged: vi.fn((listener: NonNullable<PanelListeners['active']>) => {
      listeners.active = listener
      return unsubscribers[1]
    }),
    onRedockRequested: vi.fn((listener: NonNullable<PanelListeners['redock']>) => {
      listeners.redock = listener
      return unsubscribers[2]
    }),
    onClosed: vi.fn((listener: NonNullable<PanelListeners['closed']>) => {
      listeners.closed = listener
      return unsubscribers[3]
    })
  }
  const consoleHandle = {
    reset: vi.fn(),
    refresh: vi.fn(async () => undefined)
  }
  const networkHandle = {
    reset: vi.fn(),
    refresh: vi.fn(async () => undefined),
    refreshRoutes: vi.fn(async () => undefined),
    refreshAll: vi.fn(async () => undefined),
    openRequestConditions: vi.fn(async () => undefined)
  }
  const diagnostics = Object.fromEntries([
    'runAccessibilityAudit',
    'runQualityAudit',
    'runPerformanceReport',
    'runDesignOverview',
    'runPageMetadata',
    'runSecurityReport',
    'manageCodeCoverage',
    'manageCpuProfile',
    'runMemoryReport',
    'runDebugReport',
    'manageRepro',
    'manageDomChanges',
    'manageVisualCompare',
    'refreshInspectorIssues'
  ].map((action) => [action, vi.fn(async () => undefined)])) as Record<string, unknown>
  Object.assign(diagnostics, {
    accessibilityPanelOpen: panels.accessibility,
    qualityAuditPanelOpen: panels['quality-audit'],
    performancePanelOpen: panels.performance,
    designOverviewPanelOpen: panels['design-overview'],
    pageMetadataPanelOpen: panels['page-metadata'],
    securityPanelOpen: panels.security,
    coveragePanelOpen: panels.coverage,
    cpuProfilePanelOpen: panels['cpu-profile'],
    memoryPanelOpen: panels.memory,
    debugReportPanelOpen: panels['debug-report'],
    reproPanelOpen: panels['repro-recorder'],
    domChangesPanelOpen: panels['dom-changes'],
    visualComparePanelOpen: panels['visual-compare'],
    inspectorIssuesOpen: panels.issues
  })
  const activeTab = ref<BrowserTabState | undefined>({
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test',
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
  })
  const onActivate = vi.fn()
  const persistDock = vi.fn()
  const options: AppPanelFeatureControllerOptions = {
    registry: {
      siteControlsOpen: panels['site-controls'],
      siteStorageOpen: panels['site-storage'],
      pageToolsOpen: panels['page-tools'],
      responsivePanelOpen: panels['responsive-preview'],
      environmentPanelOpen: panels.environment,
      bookmarksOpen: panels.bookmarks,
      onActivate
    },
    transient: {
      shouldCloseDockedPanels: () => panelDock.value !== 'window',
      addressSuggestionsOpen: ref(false),
      zoomOpen: ref(false),
      downloadsOpen: ref(false),
      historyOpen: ref(false),
      tabSearchOpen: ref(false),
      updateNoticeOpen: ref(false),
      findOpen: ref(false),
      closeFind: vi.fn(async () => undefined)
    },
    developer: {
      consoleOpen: panels.console,
      consolePanel: ref(consoleHandle),
      networkOpen: panels.network,
      networkPanel: ref(networkHandle),
      keepsSeparatePanelOpen: () => panelDock.value === 'window'
    },
    detached: {
      panelId: null,
      detachedWindow,
      api: panelWindowApi,
      context: () => ({
        tabId: activeTab.value?.id ?? null,
        url: activeTab.value?.url,
        loading: activeTab.value?.loading
      }),
      refreshSiteData: vi.fn(),
      refreshSiteStorage: vi.fn(),
      loadResponsiveDraft: vi.fn(),
      loadEnvironmentDraft: vi.fn(),
      diagnostics: diagnostics as unknown as AppPanelFeatureControllerOptions['detached']['diagnostics'],
      waitForPresentationTurn
    },
    dock: {
      panelDock,
      persistDock
    },
    onError: vi.fn()
  }
  beforeCreate?.(panelWindowApi, panels)
  const controller = useAppPanelFeatureController(options)
  return {
    activeTab,
    consoleHandle,
    controller,
    listeners,
    networkHandle,
    onActivate,
    openPanelWindow,
    options,
    panelWindowApi,
    panels,
    persistDock,
    unsubscribers
  }
}

describe('app panel feature controller', () => {
  it('keeps window-docked panel switches exclusive and does not resurrect the previous panel', async () => {
    const harness = createHarness()
    harness.options.dock.panelDock.value = 'window'

    harness.controller.toggleConsole()
    expect(harness.controller.activePanelId.value).toBe('console')
    expect(harness.panels.console.value).toBe(true)

    await harness.controller.toggleNetworkMonitor()
    expect(DETACHABLE_PANEL_IDS.filter((panel) => harness.panels[panel].value)).toEqual(['network'])
    expect(harness.controller.activePanelId.value).toBe('network')

    harness.controller.toggleConsole()
    expect(DETACHABLE_PANEL_IDS.filter((panel) => harness.panels[panel].value)).toEqual(['console'])
    expect(harness.controller.activePanelId.value).toBe('console')

    harness.controller.toggleConsole()
    expect(DETACHABLE_PANEL_IDS.some((panel) => harness.panels[panel].value)).toBe(false)
    expect(harness.controller.activePanelId.value).toBeNull()
    harness.controller.dispose()
  })

  it('keeps a local panel choice newer than a queued detached presentation request', async () => {
    const presentationTurn = deferred()
    const harness = createHarness(true, () => presentationTurn.promise)

    harness.listeners.requested?.('page-tools')
    harness.controller.toggleConsole()
    presentationTurn.resolve()
    await nextTick()

    expect(DETACHABLE_PANEL_IDS.filter((panel) => harness.panels[panel].value)).toEqual(['console'])
    expect(harness.controller.activePanelId.value).toBe('console')
    expect(harness.consoleHandle.refresh).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('keeps a local panel close newer than a queued detached presentation request', async () => {
    const presentationTurn = deferred()
    const harness = createHarness(true, () => presentationTurn.promise)
    harness.controller.activatePanel('console')

    harness.listeners.requested?.('page-tools')
    harness.controller.toggleConsole()
    presentationTurn.resolve()
    await nextTick()

    expect(DETACHABLE_PANEL_IDS.some((panel) => harness.panels[panel].value)).toBe(false)
    expect(harness.controller.activePanelId.value).toBeNull()
    expect(harness.consoleHandle.refresh).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('does not let an automatic panel refresh cancel a newer native presentation', async () => {
    const presentationTurn = deferred()
    const harness = createHarness(true, () => presentationTurn.promise)
    harness.controller.activatePanel('performance')
    vi.mocked(harness.options.detached.diagnostics.runPerformanceReport).mockImplementation(async () => {
      harness.panels.performance.value = false
      harness.panels.performance.value = true
    })

    harness.listeners.requested?.('network')
    harness.activeTab.value = { ...harness.activeTab.value!, url: 'https://example.test/next' }
    await nextTick()
    presentationTurn.resolve()
    await vi.waitFor(() => expect(harness.controller.activePanelId.value).toBe('network'))

    expect(harness.networkHandle.refresh).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('rolls back panel watchers when event registration fails during construction', () => {
    let panels!: Record<DetachablePanelId, Ref<boolean>>
    let requestedUnsubscribe!: () => void

    expect(() => createHarness(false, undefined, (api, createdPanels) => {
      panels = createdPanels
      requestedUnsubscribe = vi.fn<() => void>()
      api.onPanelRequested = vi.fn(() => requestedUnsubscribe)
      api.onActivePanelChanged = vi.fn(() => {
        throw new Error('subscription failed')
      })
    })).toThrow('subscription failed')

    panels.console.value = true
    panels.network.value = true
    expect(DETACHABLE_PANEL_IDS.filter((panel) => panels[panel].value)).toEqual(['console', 'network'])
    expect(vi.mocked(requestedUnsubscribe)).toHaveBeenCalledOnce()
  })

  it('keeps controller identities stable and wires the newest detached request atomically', async () => {
    const firstTurn = deferred()
    const secondTurn = deferred()
    const waitForPresentationTurn = vi.fn()
      .mockReturnValueOnce(firstTurn.promise)
      .mockReturnValueOnce(secondTurn.promise)
    const harness = createHarness(true, waitForPresentationTurn)
    const registry = harness.controller.panelRegistryController
    const developer = harness.controller.developerPanelsShellController

    harness.listeners.requested?.('network')
    harness.listeners.requested?.('console')
    firstTurn.resolve()
    await nextTick()
    expect(harness.controller.activePanelId.value).toBeNull()

    secondTurn.resolve()
    await vi.waitFor(() => expect(harness.controller.activePanelId.value).toBe('console'))
    expect(harness.consoleHandle.refresh).toHaveBeenCalledOnce()
    expect(harness.networkHandle.refresh).not.toHaveBeenCalled()
    expect(harness.controller.panelRegistryController).toBe(registry)
    expect(harness.controller.developerPanelsShellController).toBe(developer)
    harness.controller.dispose()
  })

  it('disposes panel subscriptions once and prevents late IPC or ref changes from escaping', async () => {
    const harness = createHarness()
    harness.controller.activatePanel('network')
    harness.options.dock.panelDock.value = 'window'
    await nextTick()
    const openCalls = harness.openPanelWindow.mock.calls.length

    harness.controller.dispose()
    harness.controller.dispose()
    harness.listeners.active?.('console')
    harness.listeners.redock?.({ panel: 'console', dock: 'bottom' })
    harness.listeners.closed?.()
    harness.panels.console.value = true
    harness.options.dock.panelDock.value = 'right'
    await nextTick()

    expect(harness.unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(harness.openPanelWindow).toHaveBeenCalledTimes(openCalls)
    expect(harness.persistDock).toHaveBeenCalledTimes(1)
    expect(harness.onActivate).toHaveBeenCalledOnce()
  })
})
