import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function searchResult(): BrowserNetworkSearchResult {
  return {
    tabId: 'tab-1',
    query: 'example',
    caseSensitive: false,
    searchedAt: '2026-08-21T12:00:00.000Z',
    availableRequestCount: 1,
    searchedRequestCount: 1,
    matchingRequestCount: 1,
    resultCount: 1,
    occurrenceCount: 1,
    unavailableResponseBodyCount: 0,
    truncated: false,
    matches: [{
      requestId: 'original',
      url: 'https://example.test/api/original',
      method: 'GET',
      resourceType: 'xhr',
      field: 'response-body',
      label: 'Response body',
      snippet: 'example response',
      occurrenceCount: 1
    }],
    caveats: []
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
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
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
  const copyText = vi.fn(async () => true)
  const controller = useNetworkController({
    activeTab,
    open: ref(true),
    browser,
    translate: (key) => key,
    copyText,
    syncState: async (operation) => { synced.push(await operation) },
    keepsSeparatePanelOpen: () => false
  })
  return { activeTab, synced, browser, controller, copyText }
}

afterEach(() => {
  vi.useRealTimers()
})

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

  it.each(['success', 'failure'] as const)('ignores a pending content search %s after clearing the network log', async (outcome) => {
    const { browser, controller } = createController()
    const pending = deferred<BrowserNetworkSearchResult>()
    browser.searchNetwork.mockImplementationOnce(() => pending.promise)
    controller.contentSearchOpen.value = true
    controller.contentSearchQuery.value = 'example'

    const searching = controller.runContentSearch()
    await controller.refresh(true)
    if (outcome === 'success') pending.resolve(searchResult())
    else pending.reject(new Error('Search of the old log failed'))
    await searching

    expect(controller.requests.value).toEqual([])
    expect(controller.contentSearchResult.value).toBeNull()
    expect(controller.contentSearchState.value).toBe('idle')
    expect(controller.contentSearchError.value).toBe('')
    expect(controller.contentSearchOpen.value).toBe(true)
    expect(controller.contentSearchQuery.value).toBe('example')
    controller.dispose()
  })

  it('clears previous content search errors when clearing the network log and allows a new search', async () => {
    const { browser, controller } = createController()
    controller.contentSearchQuery.value = 'example'
    browser.searchNetwork.mockRejectedValueOnce(new Error('Search of the old log failed'))
    await controller.runContentSearch()

    await controller.refresh(true)

    expect(controller.contentSearchError.value).toBe('')
    expect(controller.contentSearchState.value).toBe('idle')
    const next = searchResult()
    browser.searchNetwork.mockResolvedValueOnce(next)
    await controller.runContentSearch()
    expect(controller.contentSearchResult.value).toEqual(next)
    expect(controller.contentSearchState.value).toBe('complete')
    controller.dispose()
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

  it.each(['success', 'failure'] as const)('discards pending request details %s and loading state when clearing the log', async (outcome) => {
    const { browser, controller } = createController()
    const pending = deferred<BrowserNetworkRequestDetails>()
    browser.getNetworkRequestDetails.mockImplementationOnce(() => pending.promise)

    const selecting = controller.selectRequest(request('original'))
    expect(controller.requestDetailsLoading.value).toBe(true)
    await controller.refresh(true)
    expect.soft(controller.requestDetailsLoading.value).toBe(false)
    if (outcome === 'success') pending.resolve(details('original'))
    else pending.reject(new Error('Details from the old log failed'))
    await selecting

    expect(controller.selectedRequestId.value).toBeNull()
    expect(controller.requestDetails.value).toBeNull()
    expect(controller.requestDetailsLoading.value).toBe(false)
    expect(controller.monitorError.value).toBe('')
    controller.dispose()
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

  it.each(['success', 'failure'] as const)('preserves a newer request selection after a late replay %s', async (outcome) => {
    const { browser, controller } = createController()
    const result = await browser.replayNetworkRequest('tab-1', 'original')
    const pending = deferred<typeof result>()
    browser.replayNetworkRequest.mockImplementationOnce(() => pending.promise)
    browser.listNetworkRequests.mockResolvedValue([request('newer'), result.replayedRequest])
    await controller.selectRequest(request('original'))

    const replaying = controller.replaySelectedRequest()
    await controller.selectRequest(request('newer'))
    if (outcome === 'success') pending.resolve(result)
    else pending.reject(new Error('Older replay failed'))
    await replaying

    expect(controller.selectedRequestId.value).toBe('newer')
    expect(controller.requestDetails.value?.id).toBe('newer')
    expect(controller.replayState.value).toBe('idle')
    expect(controller.replayMessage.value).toBe('')
    controller.dispose()
  })

  it('preserves a newer selection while the replay refresh is pending', async () => {
    const { browser, controller } = createController()
    const pending = deferred<BrowserNetworkRequest[]>()
    browser.listNetworkRequests.mockImplementationOnce(() => pending.promise)
    await controller.selectRequest(request('original'))

    const replaying = controller.replaySelectedRequest()
    await vi.waitFor(() => expect(browser.listNetworkRequests).toHaveBeenCalled())
    await controller.selectRequest(request('newer'))
    pending.resolve([request('newer'), request('replayed')])
    await replaying

    expect(controller.selectedRequestId.value).toBe('newer')
    expect(controller.requestDetails.value?.id).toBe('newer')
    expect(controller.replayState.value).toBe('idle')
    controller.dispose()
  })

  it('does not attach replay success to a request selected while replay details load', async () => {
    const { browser, controller } = createController()
    const pending = deferred<BrowserNetworkRequestDetails>()
    browser.listNetworkRequests.mockResolvedValue([request('newer'), request('replayed')])
    await controller.selectRequest(request('original'))
    browser.getNetworkRequestDetails.mockImplementationOnce(() => pending.promise)

    const replaying = controller.replaySelectedRequest()
    await vi.waitFor(() => expect(controller.selectedRequestId.value).toBe('replayed'))
    await controller.selectRequest(request('newer'))
    pending.resolve(details('replayed'))
    await replaying

    expect(controller.selectedRequestId.value).toBe('newer')
    expect(controller.requestDetails.value?.id).toBe('newer')
    expect(controller.replayState.value).toBe('idle')
    expect(controller.replayMessage.value).toBe('')
    controller.dispose()
  })

  it('does not restore replay feedback after the network log is cleared', async () => {
    const { browser, controller } = createController()
    const result = await browser.replayNetworkRequest('tab-1', 'original')
    const pending = deferred<typeof result>()
    browser.replayNetworkRequest.mockImplementationOnce(() => pending.promise)
    await controller.selectRequest(request('original'))

    const replaying = controller.replaySelectedRequest()
    await controller.refresh(true)
    pending.resolve(result)
    await replaying

    expect(controller.selectedRequestId.value).toBeNull()
    expect(controller.requestDetails.value).toBeNull()
    expect(controller.replayState.value).toBe('idle')
    expect(controller.replayMessage.value).toBe('')
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

  it('restarts copied feedback when the same request format is copied again', async () => {
    vi.useFakeTimers()
    const { controller } = createController()
    controller.requestDetails.value = details('copy')

    await controller.copyDetails('curl')
    await vi.advanceTimersByTimeAsync(1_000)
    await controller.copyDetails('curl')
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.detailsCopied.value).toBe('curl')
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.detailsCopied.value).toBeNull()
    controller.dispose()
  })

  it('does not restore request copy feedback after a context reset during clipboard write', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('copy')
    copyText.mockImplementationOnce(() => copying.promise)

    const operation = controller.copyDetails()
    controller.reset()
    copying.resolve(true)
    await operation

    expect(controller.detailsCopied.value).toBeNull()
    controller.dispose()
  })

  it('keeps the newest request copy format when clipboard writes finish out of order', async () => {
    const older = deferred<boolean>()
    const newer = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('copy')
    copyText
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const copyJson = controller.copyDetails('json')
    const copyCurl = controller.copyDetails('curl')
    newer.resolve(true)
    await copyCurl
    older.resolve(true)
    await copyJson

    expect(controller.detailsCopied.value).toBe('curl')
    controller.dispose()
  })

  it('does not show copy feedback on a request selected during clipboard write', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('older')
    copyText.mockImplementationOnce(() => copying.promise)

    const copy = controller.copyDetails()
    await controller.selectRequest(request('newer'))
    copying.resolve(true)
    await copy

    expect(controller.requestDetails.value?.id).toBe('newer')
    expect(controller.detailsCopied.value).toBeNull()
    controller.dispose()
  })
})
