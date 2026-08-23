import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useNetworkController } from '../../src/renderer/src/composables/useNetworkController.js'
import type {
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkRouteSummary,
  BrowserNetworkSearchResult,
  BrowserState,
  BrowserTabState
} from '../../src/shared/types.js'

function tab(id = 'tab-1', networkRouteCount = 0): BrowserTabState {
  return {
    id,
    title: 'Example',
    url: 'https://example.test/app',
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
    devToolsOpen: false,
    networkRouteCount
  }
}

function request(id: string, method = 'GET'): BrowserNetworkRequest {
  return {
    id,
    url: `https://example.test/api/${id}`,
    method,
    resourceType: 'xhr',
    startedAt: '2026-08-21T12:00:00.000Z',
    completedAt: '2026-08-21T12:00:00.100Z',
    status: 200,
    detailsAvailable: true,
    durationMs: 100
  }
}

function details(id: string, method = 'GET'): BrowserNetworkRequestDetails {
  return {
    ...request(id, method),
    request: { headers: {} },
    response: { headers: {}, body: { available: true, text: '{}' } }
  }
}

function route(id: string): BrowserNetworkRouteSummary {
  return {
    id,
    urlPattern: `https://example.test/api/${id}`,
    behavior: 'abort',
    remainingMatches: 1,
    createdAt: '2026-08-21T12:00:00.000Z',
    abort: 'BlockedByClient'
  }
}

function state(activeTab: BrowserTabState): BrowserState {
  return {
    tabs: [activeTab],
    closedTabs: [],
    activeTabId: activeTab.id,
    allHumanInteractionLocked: false,
    mcpUrl: '',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => (resolve = next))
  return { promise, resolve }
}

function createController() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const synced: BrowserState[] = []
  const browser = {
    listNetworkRequests: vi.fn(async () => [] as BrowserNetworkRequest[]),
    getNetworkRequestDetails: vi.fn(async (_tabId: string, requestId: string) => details(requestId)),
    replayNetworkRequest: vi.fn(async (_tabId: string, requestId: string) => ({
      tabId: 'tab-1',
      originalRequestId: requestId,
      method: 'POST',
      url: `https://example.test/api/${requestId}`,
      replayedAt: '2026-08-21T12:00:01.000Z',
      confirmationRequired: true,
      confirmationAccepted: true,
      replayedRequest: request('replayed', 'POST'),
      caveats: []
    })),
    searchNetwork: vi.fn(async () => null as unknown as BrowserNetworkSearchResult),
    createNetworkHar: vi.fn(async () => ({
      log: {
        version: '1.2' as const,
        creator: { name: 'Hronaut' as const, version: '1' },
        comment: '',
        pages: [],
        entries: []
      },
      _hronaut: {
        generatedAt: '2026-08-21T12:00:00.000Z',
        tabId: 'tab-1',
        url: 'https://example.test/app',
        sanitized: true as const,
        includesBodies: false,
        requestCount: 0,
        availableRequestCount: 0,
        truncated: false,
        caveats: []
      }
    })),
    saveNetworkHar: vi.fn(async () => ({
      filename: 'network.har',
      path: '/tmp/network.har',
      bytes: 1,
      requestCount: 0,
      sanitized: true as const,
      includesBodies: false
    })),
    listNetworkRoutes: vi.fn(async (): Promise<BrowserNetworkRouteSummary[]> => []),
    addNetworkRoute: vi.fn(async (): Promise<BrowserNetworkRouteSummary[]> => []),
    moveNetworkRoute: vi.fn(async (): Promise<BrowserNetworkRouteSummary[]> => []),
    removeNetworkRoute: vi.fn(async (): Promise<BrowserNetworkRouteSummary[]> => []),
    clearNetworkRoutes: vi.fn(async () => state(tab('tab-1'))),
    getState: vi.fn(async () => state(tab('tab-1')))
  }
  const controller = useNetworkController({
    activeTab,
    open: ref(true),
    browser,
    translate: (key) => key,
    copyText: async () => true,
    syncState: async (operation) => { synced.push(await operation) },
    keepsSeparatePanelOpen: () => false
  })
  return { activeTab, synced, browser, controller }
}

describe('network controller', () => {
  it('invalidates an in-flight request list when reset on the same tab', async () => {
    const pending = deferred<BrowserNetworkRequest[]>()
    const { browser, controller } = createController()
    browser.listNetworkRequests.mockImplementationOnce(() => pending.promise)

    const loading = controller.refresh()
    controller.reset()
    pending.resolve([request('stale')])
    await loading

    expect(controller.requests.value).toEqual([])
    expect(controller.monitorState.value).toBe('idle')
  })

  it('keeps only the latest selected request details', async () => {
    const first = deferred<BrowserNetworkRequestDetails>()
    const second = deferred<BrowserNetworkRequestDetails>()
    const { browser, controller } = createController()
    browser.getNetworkRequestDetails
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const firstSelection = controller.selectRequest(request('first'))
    const secondSelection = controller.selectRequest(request('second'))
    first.resolve(details('first'))
    await firstSelection
    expect(controller.requestDetails.value).toBeNull()
    second.resolve(details('second'))
    await secondSelection

    expect(controller.requestDetails.value?.id).toBe('second')
    expect(controller.requestDetailsLoading.value).toBe(false)
  })

  it('requires a second action before replaying a side-effecting XHR', async () => {
    const { browser, controller } = createController()
    controller.requestDetails.value = details('original', 'POST')
    browser.listNetworkRequests.mockResolvedValue([request('replayed', 'POST')])

    await controller.replaySelectedRequest()
    expect(controller.replayState.value).toBe('confirming')
    expect(browser.replayNetworkRequest).not.toHaveBeenCalled()

    await controller.replaySelectedRequest()
    expect(browser.replayNetworkRequest).toHaveBeenCalledWith('tab-1', 'original', true)
    expect(controller.replayState.value).toBe('replayed')
    controller.dispose()
  })

  it('publishes the authoritative browser state after clearing routes', async () => {
    const { activeTab, synced, browser, controller } = createController()
    activeTab.value = tab('tab-1', 1)
    const next = state(tab('tab-1'))
    browser.clearNetworkRoutes.mockResolvedValue(next)

    await controller.clearRoutes()

    expect(browser.clearNetworkRoutes).toHaveBeenCalledWith('tab-1')
    expect(synced).toEqual([next])
    expect(controller.routes.value).toEqual([])
    expect(controller.routeState.value).toBe('ready')
  })

  it('does not let a pre-mutation route refresh overwrite newly added routes', async () => {
    const staleRefresh = deferred<BrowserNetworkRouteSummary[]>()
    const { browser, controller } = createController()
    browser.listNetworkRoutes.mockImplementationOnce(() => staleRefresh.promise)
    browser.addNetworkRoute.mockResolvedValue([route('new')])

    const refreshing = controller.refreshRoutes()
    controller.routePattern.value = 'https://example.test/api/new'
    await controller.addRouteFromDraft()
    staleRefresh.resolve([route('stale')])
    await refreshing

    expect(controller.routes.value).toEqual([route('new')])
    expect(controller.routeState.value).toBe('ready')
  })
})
