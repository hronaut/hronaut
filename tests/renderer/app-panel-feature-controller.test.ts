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

function createHarness(detachedWindow = false, waitForPresentationTurn?: () => Promise<void>) {
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
  const controller = useAppPanelFeatureController(options)
  return {
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
