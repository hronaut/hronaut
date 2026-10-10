import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNetworkController } from '../../src/renderer/src/composables/useNetworkController.js'
import { useShellFeedbackController, type CopyTextWithFeedback } from '../../src/renderer/src/composables/useShellFeedbackController.js'
import type {
  BrowserNetworkHarExport,
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

describe('explicit selected request refresh', () => {
  it('rereads the same request with existing bounds and preserves filters without replay', async () => {
    const { controller, browser } = createController()
    try {
      await controller.selectRequest(request('pending'))
      controller.search.value = 'method:GET'
      controller.resourceFilter.value = 'fetch/xhr'
      const completed = details('pending')
      completed.response.body.text = 'completed response'
      browser.getNetworkRequestDetails.mockResolvedValueOnce(completed)
      await controller.refreshSelectedRequest()
      expect(browser.getNetworkRequestDetails).toHaveBeenLastCalledWith('tab-1', 'pending', 20_000)
      expect(controller.requestDetails.value).toEqual(completed)
      expect(controller.search.value).toBe('method:GET')
      expect(controller.resourceFilter.value).toBe('fetch/xhr')
      expect(browser.listNetworkRequests).not.toHaveBeenCalled()
      expect(browser.replayNetworkRequest).not.toHaveBeenCalled()
    } finally { controller.dispose() }
  })

  it('ignores missing selections, duplicate reads and an active replay', async () => {
    const { controller, browser } = createController()
    try {
      await controller.refreshSelectedRequest()
      expect(browser.getNetworkRequestDetails).not.toHaveBeenCalled()
      await controller.selectRequest(request('one'))
      controller.replayState.value = 'replaying'
      await controller.refreshSelectedRequest()
      expect(browser.getNetworkRequestDetails).toHaveBeenCalledTimes(1)
      controller.replayState.value = 'idle'
      const pending = deferred<BrowserNetworkRequestDetails>()
      browser.getNetworkRequestDetails.mockReturnValueOnce(pending.promise)
      const refreshing = controller.refreshSelectedRequest()
      await controller.refreshSelectedRequest()
      expect(browser.getNetworkRequestDetails).toHaveBeenCalledTimes(2)
      pending.resolve(details('one'))
      await refreshing
    } finally { controller.dispose() }
  })

  it.each(['selection', 'clear', 'reset', 'tab-change'] as const)('discards a late refresh after %s', async action => {
    const { controller, browser, activeTab } = createController()
    try {
      await controller.selectRequest(request('old'))
      const pending = deferred<BrowserNetworkRequestDetails>()
      browser.getNetworkRequestDetails.mockReturnValueOnce(pending.promise)
      const refreshing = controller.refreshSelectedRequest()
      if (action === 'selection') await controller.selectRequest(request('new'))
      if (action === 'clear') await controller.refresh(true)
      if (action === 'reset') controller.reset()
      if (action === 'tab-change') activeTab.value = tab('other-tab')
      pending.resolve(details('old'))
      await refreshing
      expect(controller.requestDetails.value?.id).not.toBe('old')
      if (action === 'selection') expect(controller.requestDetails.value?.id).toBe('new')
    } finally { controller.dispose() }
  })

  it('keeps the exact selection retryable after a failed read', async () => {
    const { controller, browser } = createController()
    try {
      await controller.selectRequest(request('one'))
      browser.getNetworkRequestDetails.mockRejectedValueOnce(new Error('Details unavailable'))
      await controller.refreshSelectedRequest()
      expect(controller.requestDetails.value).toBeNull()
      expect(controller.selectedRequestId.value).toBe('one')
      expect(controller.monitorError.value).toBe('Details unavailable')
      expect(controller.requestDetailsLoading.value).toBe(false)
      await controller.refreshSelectedRequest()
      expect(controller.requestDetails.value?.id).toBe('one')
      expect(controller.monitorError.value).toBe('')
    } finally { controller.dispose() }
  })
})

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

function createController(copyTextOverride?: CopyTextWithFeedback) {
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
  const copyText = vi.fn(copyTextOverride ?? (async () => true))
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

describe('Network detail copy failure ownership', () => {
  it.each((['json', 'curl', 'fetch', 'response', 'url'] as const).flatMap(format =>
    (['selection', 'refresh', 'newer', 'reset', 'dispose', 'tab', 'url'] as const).map(action => ({ format, action }))
  ))('suppresses obsolete $format detail-copy failure toasts after $action changes', async ({ format, action }) => {
    const pending = deferred<void>()
    const nativeCopy = vi.fn(async (_text: string): Promise<void> => {}).mockReturnValueOnce(pending.promise)
    const showToast = vi.fn()
    const shell = useShellFeedbackController({ browser: { copyText: nativeCopy }, translate: key => key, showToast })
    const { controller, activeTab } = createController(shell.copyText)
    await controller.selectRequest(request('older'))
    try {
      const older = controller.copyDetails(format)
      expect(nativeCopy).toHaveBeenCalledOnce()
      if (action === 'selection') await controller.selectRequest(request('newer'))
      else if (action === 'refresh') await controller.refreshSelectedRequest()
      else if (action === 'newer') await controller.copyDetails(format === 'json' ? 'url' : 'json')
      else if (action === 'reset') controller.reset()
      else if (action === 'dispose') controller.dispose()
      else if (action === 'tab') activeTab.value = tab('tab-2')
      else activeTab.value = { ...tab(), url: 'https://example.test/other' }
      pending.reject(new Error('Obsolete detail clipboard refusal'))
      await older
      expect(showToast).not.toHaveBeenCalled()
      expect(controller.detailsCopied.value).toBe(action === 'newer' ? (format === 'json' ? 'url' : 'json') : null)
      expect(controller.monitorError.value).toBe('')
    } finally { controller.dispose() }
  })

  it.each(['json', 'curl', 'fetch', 'response', 'url'] as const)('keeps current %s detail-copy failures visible', async format => {
    const showToast = vi.fn()
    const shell = useShellFeedbackController({
      browser: { copyText: vi.fn().mockRejectedValue(new Error('Current detail clipboard refusal')) },
      translate: key => key, showToast
    })
    const { controller } = createController(shell.copyText)
    controller.requestDetails.value = details('current')
    try {
      await controller.copyDetails(format)
      expect(showToast).toHaveBeenCalledExactlyOnceWith('error', 'runtime.capture.copyFailed', 'Current detail clipboard refusal')
      expect(controller.detailsCopied.value).toBeNull()
    } finally { controller.dispose() }
  })

  it.each(['json', 'curl', 'fetch', 'response', 'url'] as const)('keeps %s detail-copy failures relevant when only list filters change', async format => {
    const pending = deferred<void>()
    const showToast = vi.fn()
    const shell = useShellFeedbackController({
      browser: { copyText: vi.fn(() => pending.promise) }, translate: key => key, showToast
    })
    const { controller } = createController(shell.copyText)
    controller.requestDetails.value = details('current')
    try {
      const copying = controller.copyDetails(format)
      controller.search.value = 'different'
      controller.resourceFilter.value = 'image'
      controller.failuresOnly.value = true
      pending.reject(new Error('Relevant detail clipboard refusal'))
      await copying
      expect(showToast).toHaveBeenCalledExactlyOnceWith('error', 'runtime.capture.copyFailed', 'Relevant detail clipboard refusal')
    } finally { controller.dispose() }
  })

})

describe('HAR copy filter ownership', () => {
  it.each(['query', 'resource', 'failures', 'newer', 'reset', 'dispose', 'tab-change'])(
    'suppresses obsolete HAR failure toasts through the production feedback helper after %s', async action => {
      const pending = deferred<void>()
      const nativeCopy = vi.fn(async (_text: string) => {}).mockReturnValueOnce(pending.promise)
      const showToast = vi.fn()
      const shell = useShellFeedbackController({ browser: { copyText: nativeCopy }, translate: key => key, showToast })
      const { controller, activeTab } = createController(shell.copyText)
      try {
        const older = controller.copyHar()
        await vi.waitFor(() => expect(nativeCopy).toHaveBeenCalledOnce())
        if (action === 'query') controller.search.value = 'changed'
        else if (action === 'resource') controller.resourceFilter.value = 'fetch/xhr'
        else if (action === 'failures') controller.failuresOnly.value = true
        else if (action === 'newer') await controller.copyHar()
        else if (action === 'tab-change') activeTab.value = tab('tab-2')
        else if (action === 'reset') controller.reset()
        else controller.dispose()
        pending.reject(new Error('Obsolete native clipboard refusal'))
        await older
        expect(showToast).not.toHaveBeenCalled()
        expect(controller.harCopied.value).toBe(action === 'newer')
        expect(controller.monitorError.value).toBe('')
      } finally { controller.dispose() }
    }
  )

  it('keeps current HAR clipboard failures visible through the production feedback helper', async () => {
    const showToast = vi.fn()
    const shell = useShellFeedbackController({
      browser: { copyText: vi.fn().mockRejectedValue(new Error('Current native clipboard refusal')) },
      translate: key => key, showToast
    })
    const { controller } = createController(shell.copyText)
    try {
      await controller.copyHar()
      expect(showToast).toHaveBeenCalledExactlyOnceWith('error', 'runtime.capture.copyFailed', 'Current native clipboard refusal')
      expect(controller.harCopied.value).toBe(false)
    } finally { controller.dispose() }
  })

  function changeFilter(controller: ReturnType<typeof createController>['controller'], filter: string): void {
    if (filter === 'query') controller.search.value = 'method:POST'
    else if (filter === 'resource') controller.resourceFilter.value = 'fetch/xhr'
    else controller.failuresOnly.value = true
  }

  it.each(['query', 'resource', 'failures'])('clears completed HAR copy feedback synchronously after changing %s', async filter => {
    const { controller, copyText } = createController()
    try {
      await controller.copyHar()
      expect(controller.harCopied.value).toBe(true)
      changeFilter(controller, filter)
      expect(controller.harCopied.value).toBe(false)
      expect(copyText).toHaveBeenCalledOnce()
    } finally { controller.dispose() }
  })

  it.each(['query', 'resource', 'failures'].flatMap(filter => ['success', 'failure'].map(outcome => ({ filter, outcome }))))(
    'discards an export finishing with $outcome after a $filter change without another copy', async ({ filter, outcome }) => {
      const { controller, browser, copyText } = createController()
      const har = await browser.createNetworkHar()
      const pending = deferred<typeof har>()
      browser.createNetworkHar.mockReturnValueOnce(pending.promise)
      try {
        const copying = controller.copyHar()
        changeFilter(controller, filter)
        controller.monitorError.value = 'Newer monitor error'
        if (outcome === 'success') pending.resolve(har)
        else pending.reject(new Error('Obsolete HAR export failed'))
        await copying
        expect(copyText).not.toHaveBeenCalled()
        expect(controller.harCopied.value).toBe(false)
        expect(controller.monitorError.value).toBe('Newer monitor error')
      } finally { controller.dispose() }
    }
  )

  it.each(['success', 'false', 'rejection'])('ignores stale clipboard %s after an export filter changes', async outcome => {
    const { controller, copyText } = createController()
    const pending = deferred<boolean>()
    copyText.mockReturnValueOnce(pending.promise)
    try {
      const copying = controller.copyHar()
      await vi.waitFor(() => expect(copyText).toHaveBeenCalledOnce())
      controller.search.value = 'new filter'
      controller.monitorError.value = 'Newer monitor error'
      if (outcome === 'rejection') pending.reject(new Error('Obsolete clipboard refusal'))
      else pending.resolve(outcome === 'success')
      await copying
      expect(controller.harCopied.value).toBe(false)
      expect(controller.monitorError.value).toBe('Newer monitor error')
    } finally { controller.dispose() }
  })

  it('invalidates a pending HAR even when the query changes back before the next render', async () => {
    const { controller, browser, copyText } = createController()
    const har = await browser.createNetworkHar()
    const pending = deferred<typeof har>()
    browser.createNetworkHar.mockReturnValueOnce(pending.promise)
    try {
      const copying = controller.copyHar()
      controller.search.value = 'temporary query'
      controller.search.value = ''
      pending.resolve(har)
      await copying
      expect(copyText).not.toHaveBeenCalled()
      expect(controller.harCopied.value).toBe(false)
    } finally { controller.dispose() }
  })

  it('copies the new filter with unchanged export bounds after discarding an old export', async () => {
    const { controller, browser, copyText } = createController()
    const har = await browser.createNetworkHar()
    const pending = deferred<typeof har>()
    browser.createNetworkHar.mockReturnValueOnce(pending.promise)
    try {
      const older = controller.copyHar()
      controller.search.value = 'method:POST'
      controller.resourceFilter.value = 'fetch/xhr'
      controller.failuresOnly.value = true
      await controller.copyHar()
      pending.resolve(har)
      await older
      expect(browser.createNetworkHar).toHaveBeenLastCalledWith({ tabId: 'tab-1', query: 'method:POST', resourceType: 'fetch/xhr', errorsOnly: true, includeBodies: false, maxRequests: 100 })
      expect(copyText).toHaveBeenCalledOnce()
      expect(controller.harCopied.value).toBe(true)
    } finally { controller.dispose() }
  })

  it('preserves HAR feedback for non-export controls and does not reset details or file-save feedback', async () => {
    const { controller } = createController()
    try {
      await controller.copyHar()
      controller.sortBy.value = 'size'
      controller.sortDirection.value = 'desc'
      controller.contentSearchQuery.value = 'body text'
      expect(controller.harCopied.value).toBe(true)
      controller.detailsCopied.value = 'url'
      controller.harSaveState.value = 'saved'
      controller.search.value = 'new filter'
      expect(controller.detailsCopied.value).toBe('url')
      expect(controller.harSaveState.value).toBe('saved')
    } finally { controller.dispose() }
  })

  it('discards pending HAR work after disposal', async () => {
    const { controller, browser, copyText } = createController()
    const har = await browser.createNetworkHar()
    const pending = deferred<typeof har>()
    browser.createNetworkHar.mockReturnValueOnce(pending.promise)
    const copying = controller.copyHar()
    controller.dispose()
    controller.search.value = 'changed after disposal'
    pending.resolve(har)
    await copying
    expect(copyText).not.toHaveBeenCalled()
    expect(controller.harCopied.value).toBe(false)
  })
})

describe('network controller', () => {
  it('discards the removed records returned by Clear and preserves filters', async () => {
    const { browser, controller } = createController()
    controller.requests.value = [request('old')]
    controller.search.value = 'old'
    await controller.selectRequest(request('old'))
    browser.listNetworkRequests.mockResolvedValueOnce([request('old')])
    try {
      await controller.refresh(true)
      expect(browser.listNetworkRequests).toHaveBeenLastCalledWith('tab-1', true)
      expect(controller.requests.value).toEqual([])
      expect(controller.filteredRequests.value).toEqual([])
      expect(controller.selectedRequestId.value).toBeNull()
      expect(controller.requestDetails.value).toBeNull()
      expect(controller.search.value).toBe('old')
      expect(controller.monitorState.value).toBe('ready')
      browser.listNetworkRequests.mockResolvedValueOnce([request('new')])
      await controller.refresh()
      expect(controller.requests.value).toEqual([request('new')])
    } finally { controller.dispose() }
  })

  it('rejects an older refresh after clearing displayed records', async () => {
    const { browser, controller } = createController()
    const pending = deferred<BrowserNetworkRequest[]>()
    browser.listNetworkRequests.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([request('old')])
    try {
      const reading = controller.refresh()
      await controller.refresh(true)
      pending.resolve([request('old')])
      await reading
      expect(controller.requests.value).toEqual([])
    } finally { controller.dispose() }
  })

  it('keeps a newer refresh when an older Clear completes', async () => {
    const { browser, controller } = createController()
    const pending = deferred<BrowserNetworkRequest[]>()
    browser.listNetworkRequests.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([request('new')])
    try {
      const clearing = controller.refresh(true)
      await controller.refresh()
      pending.resolve([request('old')])
      await clearing
      expect(controller.requests.value).toEqual([request('new')])
    } finally { controller.dispose() }
  })

  it('retires a request selected while Clear is pending, including its late details', async () => {
    const { browser, controller } = createController()
    const clearing = deferred<BrowserNetworkRequest[]>()
    const selecting = deferred<BrowserNetworkRequestDetails>()
    controller.requests.value = [request('old')]
    browser.listNetworkRequests.mockReturnValueOnce(clearing.promise)
    browser.getNetworkRequestDetails.mockReturnValueOnce(selecting.promise)
    try {
      const clear = controller.refresh(true)
      const select = controller.selectRequest(request('old'))
      clearing.resolve([request('old')])
      await clear
      expect(controller.selectedRequestId.value).toBeNull()
      expect(controller.requestDetailsLoading.value).toBe(false)
      selecting.resolve(details('old'))
      await select
      expect(controller.requestDetails.value).toBeNull()
      expect(controller.detailsCopied.value).toBeNull()
    } finally { controller.dispose() }
  })

  it('retains displayed records when Clear fails', async () => {
    const { browser, controller } = createController()
    controller.requests.value = [request('old')]
    browser.listNetworkRequests.mockRejectedValueOnce(new Error('Clear failed'))
    try {
      await controller.refresh(true)
      expect(controller.requests.value).toEqual([request('old')])
      expect(controller.monitorState.value).toBe('error')
      expect(controller.monitorError.value).toBe('Clear failed')
    } finally { controller.dispose() }
  })

  it.each(['switch', 'reset'] as const)('discards a related request selection after a context %s', async (action) => {
    const { activeTab, browser, controller } = createController()
    const selecting = controller.selectRelatedRequest(request('old'))
    if (action === 'switch') activeTab.value = tab('tab-2')
    else controller.reset()
    await selecting
    expect(browser.getNetworkRequestDetails).not.toHaveBeenCalled()
    expect(controller.selectedRequestId.value).toBeNull()
    expect(controller.requestDetails.value).toBeNull()
    expect(controller.monitorError.value).toBe('')
    controller.dispose()
  })

  it('keeps a newer direct request selection while a related request waits for rendering', async () => {
    const { browser, controller } = createController()
    const selecting = controller.selectRelatedRequest(request('old'))
    await controller.selectRequest(request('new'))
    await selecting
    expect(browser.getNetworkRequestDetails).toHaveBeenCalledOnce()
    expect(browser.getNetworkRequestDetails).toHaveBeenCalledWith('tab-1', 'new', 20_000)
    expect(controller.selectedRequestId.value).toBe('new')
    expect(controller.requestDetails.value?.id).toBe('new')
    controller.dispose()
  })

  it('selects only the newest related request queued before rendering', async () => {
    const { browser, controller } = createController()
    const older = controller.selectRelatedRequest(request('old'))
    const newer = controller.selectRelatedRequest(request('new'))
    await Promise.all([older, newer])
    expect(browser.getNetworkRequestDetails).toHaveBeenCalledOnce()
    expect(browser.getNetworkRequestDetails).toHaveBeenCalledWith('tab-1', 'new', 20_000)
    expect(controller.selectedRequestId.value).toBe('new')
    expect(controller.requestDetails.value?.id).toBe('new')
    controller.dispose()
  })

  it.each(['success', 'failure'] as const)('ignores an older HAR export completing with %s after a newer copy', async (outcome) => {
    const { browser, controller, copyText } = createController()
    const har = await browser.createNetworkHar()
    const older = deferred<typeof har>()
    const newer = deferred<typeof har>()
    browser.createNetworkHar.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)
    const firstCopy = controller.copyHar()
    controller.search.value = 'newer filter'
    const secondCopy = controller.copyHar()
    newer.resolve({ ...har, log: { ...har.log, comment: 'newer export' } })
    await secondCopy
    if (outcome === 'success') older.resolve({ ...har, log: { ...har.log, comment: 'older export' } })
    else older.reject(new Error('Older export failed'))
    await firstCopy
    expect(copyText).toHaveBeenCalledOnce()
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('newer export'), expect.any(Function))
    expect(controller.harCopied.value).toBe(true)
    expect(controller.monitorError.value).toBe('')
    controller.dispose()
  })

  it('does not copy an older HAR after the newer export fails', async () => {
    const { browser, controller, copyText } = createController()
    const har = await browser.createNetworkHar()
    const older = deferred<typeof har>()
    browser.createNetworkHar.mockImplementationOnce(() => older.promise).mockRejectedValueOnce(new Error('Current export failed'))
    const firstCopy = controller.copyHar()
    await controller.copyHar()
    older.resolve(har)
    await firstCopy
    expect(copyText).not.toHaveBeenCalled()
    expect(controller.harCopied.value).toBe(false)
    expect(controller.monitorError.value).toBe('Current export failed')
    controller.dispose()
  })

  it('does not restore stale HAR feedback after a newer clipboard operation fails', async () => {
    const { controller, copyText } = createController()
    const older = deferred<boolean>()
    copyText.mockImplementationOnce(() => older.promise).mockResolvedValueOnce(false)
    const firstCopy = controller.copyHar()
    await Promise.resolve()
    expect(copyText).toHaveBeenCalledOnce()
    await controller.copyHar()
    older.resolve(true)
    await firstCopy
    expect(controller.harCopied.value).toBe(false)
    controller.dispose()
  })

  it.each([false, true].flatMap((clear) => (
    ['success', 'failure'].map((outcome) => ({ clear, outcome }))
  )))('keeps pending HAR saves exclusive across refresh (clear=$clear, $outcome)', async ({ clear, outcome }) => {
    const pending = deferred<BrowserNetworkHarExport>()
    const { browser, controller } = createController()
    browser.saveNetworkHar.mockImplementationOnce(() => pending.promise)
    browser.listNetworkRequests.mockResolvedValue([request('retained')])
    const saving = controller.saveHar()
    await controller.refresh(clear)
    expect(controller.harSaveState.value).toBe('saving')
    await controller.saveHar()
    expect(browser.saveNetworkHar).toHaveBeenCalledOnce()

    const exported: BrowserNetworkHarExport = {
      filename: 'network.har', path: '/tmp/network.har', bytes: 1,
      requestCount: 1, sanitized: true, includesBodies: false
    }
    if (outcome === 'success') pending.resolve(exported)
    else pending.reject(new Error('Export failed'))
    await saving
    expect(controller.harSaveState.value).toBe(outcome === 'success' ? 'saved' : 'idle')
    expect(controller.harExport.value).toEqual(outcome === 'success' ? exported : null)
    expect(controller.monitorError.value).toBe(outcome === 'success' ? '' : 'Export failed')
    await controller.saveHar()
    expect(browser.saveNetworkHar).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('saturates extreme response-byte totals instead of rendering them as zero bytes', async () => {
    const { browser, controller } = createController()
    browser.listNetworkRequests.mockResolvedValue([
      { ...request('first'), responseSizeBytes: Number.MAX_VALUE },
      { ...request('second'), responseSizeBytes: Number.MAX_VALUE }
    ])

    await controller.refresh()

    expect(controller.responseBytes.value).toBe(Number.MAX_SAFE_INTEGER)
    controller.dispose()
  })

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

  it('retires previous content matches while a new search is pending and after failure', async () => {
    const { browser, controller } = createController()
    controller.contentSearchQuery.value = 'example'
    browser.searchNetwork.mockResolvedValueOnce(searchResult())
    await controller.runContentSearch()
    expect(controller.contentSearchResult.value?.matches).toHaveLength(1)
    const pending = deferred<BrowserNetworkSearchResult>()
    browser.searchNetwork.mockImplementationOnce(() => pending.promise)
    controller.contentSearchQuery.value = 'different'
    const searching = controller.runContentSearch()
    const during = controller.contentSearchResult.value
    pending.reject(new Error('Search unavailable'))
    await searching
    expect(during).toBeNull()
    expect(controller.contentSearchResult.value).toBeNull()
    expect(controller.contentSearchState.value).toBe('error')
    expect(controller.contentSearchError.value).toBe('Search unavailable')
    browser.searchNetwork.mockResolvedValueOnce({ ...searchResult(), query: 'different' })
    await controller.runContentSearch()
    expect(controller.contentSearchResult.value?.query).toBe('different')
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

  it.each([true, false].flatMap((clear) => ['success', 'failure'].map((outcome) => ({ clear, outcome }))))('discards pending request details $outcome when the selection disappears (clear=$clear)', async ({ clear, outcome }) => {
    const { browser, controller } = createController()
    const pending = deferred<BrowserNetworkRequestDetails>()
    browser.getNetworkRequestDetails.mockImplementationOnce(() => pending.promise)

    const selecting = controller.selectRequest(request('original'))
    expect(controller.requestDetailsLoading.value).toBe(true)
    await controller.refresh(clear)
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

  it.each([
    'https://example.test/path?q=visible&token=%5BREDACTED%5D',
    'https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/',
    'file:///tmp/retained-page.html'
  ])('copies the displayed URL verbatim without reacquisition or replay: %s', async (url) => {
    const { browser, controller, copyText } = createController()
    controller.requestDetails.value = { ...details('copy'), url }
    await controller.copyDetails('url')
    expect(copyText).toHaveBeenCalledExactlyOnceWith(url, expect.any(Function))
    expect(browser.getNetworkRequestDetails).not.toHaveBeenCalled()
    expect(browser.replayNetworkRequest).not.toHaveBeenCalled()
    expect(controller.detailsCopied.value).toBe('url')
    controller.dispose()
  })

  it.each([
    '{"visible":"kept","accessToken":"[REDACTED]"}',
    'prefix\n[truncated after 20000 characters]',
    '[binary body omitted]',
    ''
  ])('copies only the retained response text %j without reacquiring it', async (body) => {
    const { browser, controller, copyText } = createController()
    controller.requestDetails.value = details('copy')
    controller.requestDetails.value.response.body = { available: true, text: body }
    await controller.copyDetails('response')
    expect(copyText).toHaveBeenCalledExactlyOnceWith(body, expect.any(Function))
    expect(browser.getNetworkRequestDetails).not.toHaveBeenCalled()
    expect(browser.replayNetworkRequest).not.toHaveBeenCalled()
    expect(controller.detailsCopied.value).toBe('response')
    controller.dispose()
  })

  it.each([
    { available: false, text: 'must not copy', reason: 'Unavailable' },
    { available: true },
    { text: 'availability unknown' }
  ])('does not copy an unavailable response body %j', async (body) => {
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('copy')
    controller.requestDetails.value.response.body = body
    await controller.copyDetails('response')
    expect(copyText).not.toHaveBeenCalled()
    expect(controller.detailsCopied.value).toBeNull()
    controller.dispose()
  })

  it.each((['response', 'url'] as const).flatMap((format) => (['selection', 'reset', 'dispose'] as const).map((change) => ({ format, change }))))('ignores $format-copy feedback after $change', async ({ format, change }) => {
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('older')
    copyText.mockImplementationOnce(() => pending.promise)
    const operation = controller.copyDetails(format)
    if (change === 'selection') await controller.selectRequest(request('newer'))
    else controller[change]()
    pending.resolve(true)
    await operation
    expect(controller.detailsCopied.value).toBeNull()
    controller.dispose()
  })

  it.each(['response', 'url'] as const)('reports a %s clipboard failure without successful copy feedback', async (format) => {
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('copy')
    copyText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await controller.copyDetails(format)
    expect(controller.monitorError.value).toBe('Clipboard unavailable')
    expect(controller.detailsCopied.value).toBeNull()
    controller.dispose()
  })

  it.each(['response', 'url'] as const)('keeps newer JSON copy feedback when an older %s copy completes', async (format) => {
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('copy')
    copyText.mockImplementationOnce(() => pending.promise)
    const older = controller.copyDetails(format)
    await controller.copyDetails('json')
    pending.resolve(true)
    await older
    expect(controller.detailsCopied.value).toBe('json')
    controller.dispose()
  })

  it.each(['response', 'url'] as const)('clears previous %s success when another clipboard write is refused', async (format) => {
    const { controller, copyText } = createController()
    controller.requestDetails.value = details('copy')
    await controller.copyDetails(format)
    expect(controller.detailsCopied.value).toBe(format)
    copyText.mockResolvedValueOnce(false)
    await controller.copyDetails(format)
    expect(controller.detailsCopied.value).toBeNull()
    controller.dispose()
  })

  it.each(['curl', 'response', 'url'] as const)('restarts copied feedback when %s is copied again', async (format) => {
    vi.useFakeTimers()
    const { controller } = createController()
    controller.requestDetails.value = details('copy')

    await controller.copyDetails(format)
    await vi.advanceTimersByTimeAsync(1_000)
    await controller.copyDetails(format)
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.detailsCopied.value).toBe(format)
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

  it.each([true, false].flatMap((clear) => ['success', 'failure'].map((outcome) => ({ clear, outcome }))))('discards pending copy $outcome when the selection disappears (clear=$clear)', async ({ clear, outcome }) => {
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    await controller.selectRequest(request('removed'))
    copyText.mockImplementationOnce(() => pending.promise)

    const copying = controller.copyDetails()
    await controller.refresh(clear)
    if (outcome === 'success') pending.resolve(true)
    else pending.reject(new Error('Old clipboard operation failed'))
    await copying

    expect(controller.selectedRequestId.value).toBeNull()
    expect(controller.detailsCopied.value).toBeNull()
    expect(controller.monitorError.value).toBe('')
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

describe('Network condition draft ownership', () => {
  const draft = (controller: ReturnType<typeof createController>['controller']) => ({
    mode: controller.routeMode.value, pattern: controller.routePattern.value,
    method: controller.routeMethod.value, times: controller.routeTimes.value,
    abort: controller.routeAbort.value, throttle: controller.routeThrottle.value,
    status: controller.routeStatus.value, headers: controller.routeHeaders.value, body: controller.routeBody.value
  })
  for (const phase of ['native add', 'state synchronization'] as const) {
    it.each(['mode', 'pattern', 'method', 'times', 'abort', 'throttle', 'status', 'headers', 'body', 'round trip'] as const)(`preserves newer %s edits during ${phase}`, async field => {
      const { controller, browser } = createController()
      const pendingAdd = deferred<BrowserNetworkRouteSummary[]>()
      const pendingState = deferred<BrowserState>()
      browser.addNetworkRoute.mockReturnValueOnce(pendingAdd.promise)
      browser.getState.mockReturnValueOnce(pendingState.promise)
      controller.routeMode.value = 'fulfill'
      controller.routePattern.value = 'https://example.test/first'
      controller.routeBody.value = 'original body'
      try {
        const adding = controller.addRouteFromDraft()
        if (phase === 'state synchronization') {
          pendingAdd.resolve([route('first')])
          await vi.waitFor(() => expect(browser.getState).toHaveBeenCalledOnce())
        }
        if (field === 'mode') controller.routeMode.value = 'throttle'
        if (field === 'pattern') controller.routePattern.value = 'https://example.test/next'
        if (field === 'method') controller.routeMethod.value = 'POST'
        if (field === 'times') controller.routeTimes.value = 3
        if (field === 'abort') controller.routeAbort.value = 'Failed'
        if (field === 'throttle') controller.routeThrottle.value = 'slow-3g'
        if (field === 'status') controller.routeStatus.value = 409
        if (field === 'headers') controller.routeHeaders.value = '{"x-next":"yes"}'
        if (field === 'body') controller.routeBody.value = 'next body'
        if (field === 'round trip') {
          controller.routeBody.value = 'temporary edit'
          controller.routeBody.value = 'original body'
        }
        const newer = draft(controller)
        pendingAdd.resolve([route('first')])
        pendingState.resolve(state(tab()))
        await adding
        expect(draft(controller)).toEqual(newer)
        expect(controller.routes.value).toEqual([route('first')])
        expect(controller.routeState.value).toBe('ready')
        expect(browser.addNetworkRoute).toHaveBeenCalledExactlyOnceWith('tab-1', {
          urlPattern: 'https://example.test/first', times: 1,
          response: { status: 200, headers: {}, body: 'original body' }
        })
      } finally { controller.dispose() }
    })
  }

  it.each(['reset', 'tab change', 'dispose'] as const)('does not clear a later draft after %s invalidates the add', async action => {
    const { controller, browser, activeTab } = createController()
    const pending = deferred<BrowserNetworkRouteSummary[]>()
    browser.addNetworkRoute.mockReturnValueOnce(pending.promise)
    controller.routePattern.value = 'https://example.test/first'
    try {
      const adding = controller.addRouteFromDraft()
      if (action === 'reset') controller.reset()
      if (action === 'tab change') activeTab.value = tab('other-tab')
      if (action === 'dispose') controller.dispose()
      controller.routePattern.value = 'https://example.test/later'
      pending.resolve([route('first')])
      await adding
      expect(controller.routePattern.value).toBe('https://example.test/later')
      expect(controller.routes.value).toEqual([])
      expect(browser.getState).not.toHaveBeenCalled()
    } finally { controller.dispose() }
  })

  it('clears an unchanged successfully submitted draft', async () => {
    const { controller, browser } = createController()
    controller.routePattern.value = 'https://example.test/first'
    controller.routeBody.value = 'submitted body'
    browser.addNetworkRoute.mockResolvedValueOnce([route('first')])
    try {
      await controller.addRouteFromDraft()
      expect(controller.routePattern.value).toBe('')
      expect(controller.routeBody.value).toBe('')
      expect(controller.routes.value).toEqual([route('first')])
    } finally { controller.dispose() }
  })
})
