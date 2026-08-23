import { computed, nextTick, ref, type Ref } from 'vue'
import type {
  BrowserNetworkAbortReason,
  BrowserNetworkHar,
  BrowserNetworkHarExport,
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkRequestSortBy,
  BrowserNetworkRequestSortDirection,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteSummary,
  BrowserNetworkSearchMatch,
  BrowserNetworkSearchResult,
  BrowserState,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'
import { DEFAULT_BROWSER_NETWORK_ABORT_REASON } from '../../../shared/types.js'
import {
  canFormatNetworkRequestCopy,
  formatNetworkRequestCopy,
  type BrowserNetworkRequestCopyFormat
} from '../../../shared/network-request-copy.js'
import { sortNetworkRequests } from '../../../shared/network-request-sort.js'
import { networkReplayRequiresConfirmation } from '../../../shared/network-replay.js'
import {
  networkResponseSourceLabel,
  serviceWorkerResponseSourceLabel
} from '../../../shared/network-response-source.js'
import {
  buildNetworkWaterfallRange,
  networkWaterfallPosition
} from '../../../shared/network-waterfall.js'
import {
  filterNetworkRequests,
  isNetworkRequestFailure,
  normalizeNetworkHarOptions
} from '../../../shared/network-har.js'

type NetworkBrowserApi = Pick<
  HronautApi,
  | 'listNetworkRequests'
  | 'getNetworkRequestDetails'
  | 'replayNetworkRequest'
  | 'searchNetwork'
  | 'createNetworkHar'
  | 'saveNetworkHar'
  | 'listNetworkRoutes'
  | 'addNetworkRoute'
  | 'moveNetworkRoute'
  | 'removeNetworkRoute'
  | 'clearNetworkRoutes'
  | 'getState'
>

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface NetworkControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  open: Ref<boolean>
  browser: NetworkBrowserApi
  translate: Translate
  copyText: (text: string) => Promise<boolean>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  keepsSeparatePanelOpen: () => boolean
}

export function useNetworkController(options: NetworkControllerOptions) {
  const monitorState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const requests = ref<BrowserNetworkRequest[]>([])
  const requestDetails = ref<BrowserNetworkRequestDetails | null>(null)
  const selectedRequestId = ref<string | null>(null)
  const requestDetailsLoading = ref(false)
  const monitorError = ref('')
  const detailsCopied = ref<'json' | BrowserNetworkRequestCopyFormat | null>(null)
  const replayState = ref<'idle' | 'confirming' | 'replaying' | 'replayed' | 'error'>('idle')
  const replayMessage = ref('')
  const search = ref('')
  const contentSearchOpen = ref(false)
  const contentSearchQuery = ref('')
  const contentSearchCaseSensitive = ref(false)
  const contentSearchState = ref<'idle' | 'searching' | 'complete' | 'error'>('idle')
  const contentSearchResult = ref<BrowserNetworkSearchResult | null>(null)
  const contentSearchError = ref('')
  const resourceFilter = ref('')
  const failuresOnly = ref(false)
  const sortBy = ref<BrowserNetworkRequestSortBy>('start-time')
  const sortDirection = ref<BrowserNetworkRequestSortDirection>('asc')
  const harCopied = ref(false)
  const harSaveState = ref<'idle' | 'saving' | 'saved'>('idle')
  const harExport = ref<BrowserNetworkHarExport | null>(null)
  const requestConditionsExpanded = ref(false)
  const routes = ref<BrowserNetworkRouteSummary[]>([])
  const routeState = ref<'idle' | 'loading' | 'ready' | 'saving' | 'error'>('idle')
  const routeError = ref('')
  const routeMode = ref<'abort' | 'fulfill' | 'throttle'>('abort')
  const routePattern = ref('')
  const routeMethod = ref('')
  const routeTimes = ref(1)
  const routeAbort = ref<BrowserNetworkAbortReason>(DEFAULT_BROWSER_NETWORK_ABORT_REASON)
  const routeThrottle = ref<'fast-4g' | 'slow-4g' | 'slow-3g'>('slow-4g')
  const routeStatus = ref(200)
  const routeHeaders = ref('')
  const routeBody = ref('')

  let generation = 0
  let contentSearchSequence = 0
  let monitorRequestSequence = 0
  let routeRequestSequence = 0
  let routeMutationSequence = 0
  let requestDetailsSequence = 0
  let replayConfirmTimer: number | undefined
  const feedbackTimers = new Set<number>()

  const resourceFilters = computed(() => [
    { value: '', label: options.translate('network.filters.all') },
    { value: 'fetch/xhr', label: options.translate('network.filters.fetchXhr') },
    { value: 'document', label: options.translate('network.filters.document') },
    { value: 'script', label: 'JS' },
    { value: 'stylesheet', label: 'CSS' },
    { value: 'image', label: options.translate('network.filters.image') },
    { value: 'eventsource', label: 'SSE' },
    { value: 'websocket', label: 'WS' },
    { value: 'other', label: options.translate('network.filters.other') }
  ])

  const sortOptions = computed<Array<{ value: BrowserNetworkRequestSortBy; label: string }>>(() => [
    { value: 'start-time', label: options.translate('network.sorts.start') },
    { value: 'end-time', label: options.translate('network.sorts.end') },
    { value: 'duration', label: options.translate('network.sorts.duration') },
    { value: 'waiting', label: options.translate('network.sorts.waiting') },
    { value: 'size', label: options.translate('network.sorts.size') },
    { value: 'status', label: options.translate('network.sorts.status') }
  ])

  const filteredRequests = computed(() => sortNetworkRequests(
    filterNetworkRequests(
      requests.value,
      normalizeNetworkHarOptions({
        query: search.value,
        resourceType: resourceFilter.value || undefined,
        errorsOnly: failuresOnly.value,
        maxRequests: 200
      })
    ),
    sortBy.value,
    sortDirection.value
  ))
  const waterfallRange = computed(() => buildNetworkWaterfallRange(filteredRequests.value))
  const failureCount = computed(() => requests.value.filter(isNetworkRequestFailure).length)
  const responseBytes = computed(() => requests.value.reduce(
    (total, request) => total + (request.responseSizeBytes ?? 0),
    0
  ))

  function isCurrent(tabId: string, expectedGeneration: number): boolean {
    return generation === expectedGeneration && options.activeTab.value?.id === tabId
  }

  function scheduleFeedbackReset(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      feedbackTimers.delete(timer)
      callback()
    }, delay)
    feedbackTimers.add(timer)
  }

  function invalidateRequests(): void {
    generation += 1
    contentSearchSequence += 1
    monitorRequestSequence += 1
    routeRequestSequence += 1
    routeMutationSequence += 1
    requestDetailsSequence += 1
  }

  function beginRouteMutation(): number {
    // A route list read can capture the pre-mutation snapshot and still resolve
    // after the mutation. Invalidate it so it cannot replace authoritative
    // mutation results with stale routes.
    routeRequestSequence += 1
    return ++routeMutationSequence
  }

  function resetReplayFeedback(): void {
    if (replayConfirmTimer !== undefined) {
      window.clearTimeout(replayConfirmTimer)
      replayConfirmTimer = undefined
    }
    replayState.value = 'idle'
    replayMessage.value = ''
  }

  function resetRouteDraft(): void {
    routePattern.value = ''
    routeMethod.value = ''
    routeTimes.value = 1
    routeAbort.value = DEFAULT_BROWSER_NETWORK_ABORT_REASON
    routeThrottle.value = 'slow-4g'
    routeStatus.value = 200
    routeHeaders.value = ''
    routeBody.value = ''
  }

  function reset(closePanel = false): void {
    invalidateRequests()
    if (closePanel && !options.keepsSeparatePanelOpen()) options.open.value = false
    requests.value = []
    monitorState.value = 'idle'
    monitorError.value = ''
    requestDetails.value = null
    selectedRequestId.value = null
    requestDetailsLoading.value = false
    detailsCopied.value = null
    resetReplayFeedback()
    contentSearchOpen.value = false
    contentSearchState.value = 'idle'
    contentSearchResult.value = null
    contentSearchError.value = ''
    harCopied.value = false
    harSaveState.value = 'idle'
    harExport.value = null
    routes.value = []
    routeState.value = 'idle'
    routeError.value = ''
    resetRouteDraft()
  }

  async function refresh(clear = false): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || tab.url.startsWith('hronaut://home')) return
    const expectedGeneration = generation
    const sequence = ++monitorRequestSequence
    monitorState.value = 'loading'
    monitorError.value = ''
    harCopied.value = false
    harSaveState.value = 'idle'
    harExport.value = null
    if (clear) {
      requestDetails.value = null
      selectedRequestId.value = null
      detailsCopied.value = null
      resetReplayFeedback()
      contentSearchResult.value = null
      contentSearchState.value = 'idle'
    }
    try {
      const nextRequests = await options.browser.listNetworkRequests(tab.id, clear)
      if (sequence !== monitorRequestSequence || !isCurrent(tab.id, expectedGeneration)) return
      requests.value = nextRequests
      monitorState.value = 'ready'
      if (selectedRequestId.value && !nextRequests.some((request) => request.id === selectedRequestId.value)) {
        selectedRequestId.value = null
        requestDetails.value = null
      }
    } catch (cause) {
      if (sequence !== monitorRequestSequence || !isCurrent(tab.id, expectedGeneration)) return
      monitorState.value = 'error'
      monitorError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function refreshRoutes(silent = false): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || tab.url.startsWith('hronaut://home')) return
    const expectedGeneration = generation
    const sequence = ++routeRequestSequence
    if (!silent) routeState.value = 'loading'
    routeError.value = ''
    try {
      const nextRoutes = await options.browser.listNetworkRoutes(tab.id)
      if (sequence !== routeRequestSequence || !isCurrent(tab.id, expectedGeneration)) return
      routes.value = nextRoutes
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeRequestSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([refresh(), refreshRoutes()])
  }

  async function openRequestConditions(): Promise<void> {
    requestConditionsExpanded.value = true
    await refreshRoutes()
  }

  function parsedRouteHeaders(): Record<string, string> {
    const source = routeHeaders.value.trim()
    if (!source) return {}
    const parsed: unknown = JSON.parse(source)
    if (
      typeof parsed !== 'object'
      || parsed === null
      || Array.isArray(parsed)
      || Object.values(parsed as Record<string, unknown>).some((value) => typeof value !== 'string')
    ) throw new Error(options.translate('runtimeDetails.networkHeadersError'))
    return parsed as Record<string, string>
  }

  async function addRouteFromDraft(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = generation
    const sequence = beginRouteMutation()
    routeState.value = 'saving'
    routeError.value = ''
    try {
      const input: BrowserNetworkRouteInput = {
        urlPattern: routePattern.value.trim(),
        ...(routeMode.value === 'throttle'
          ? { throttle: routeThrottle.value }
          : {
              times: routeTimes.value,
              ...(routeMethod.value.trim() ? { method: routeMethod.value.trim().toUpperCase() } : {})
            }),
        ...(routeMode.value === 'abort'
          ? { abort: routeAbort.value }
          : routeMode.value === 'fulfill' ? {
              response: {
                status: routeStatus.value,
                headers: parsedRouteHeaders(),
                body: routeBody.value
              }
            } : {})
      }
      const nextRoutes = await options.browser.addNetworkRoute(tab.id, input)
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      await options.syncState(options.browser.getState())
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routes.value = nextRoutes
      resetRouteDraft()
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function removeRoute(routeId: string): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = generation
    const sequence = beginRouteMutation()
    routeState.value = 'saving'
    routeError.value = ''
    try {
      const nextRoutes = await options.browser.removeNetworkRoute(tab.id, routeId)
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      await options.syncState(options.browser.getState())
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routes.value = nextRoutes
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function moveRoute(routeId: string, direction: 'up' | 'down'): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = generation
    const sequence = beginRouteMutation()
    routeState.value = 'saving'
    routeError.value = ''
    try {
      const nextRoutes = await options.browser.moveNetworkRoute(tab.id, routeId, direction)
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routes.value = nextRoutes
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function clearRoutes(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab?.networkRouteCount) return
    const expectedGeneration = generation
    const sequence = beginRouteMutation()
    routeState.value = 'saving'
    routeError.value = ''
    try {
      await options.syncState(options.browser.clearNetworkRoutes(tab.id))
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routes.value = []
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function selectRequest(request: BrowserNetworkRequest): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = generation
    const sequence = ++requestDetailsSequence
    selectedRequestId.value = request.id
    requestDetails.value = null
    detailsCopied.value = null
    resetReplayFeedback()
    requestDetailsLoading.value = true
    monitorError.value = ''
    try {
      const details = await options.browser.getNetworkRequestDetails(tab.id, request.id, 20_000)
      if (
        sequence === requestDetailsSequence
        && isCurrent(tab.id, expectedGeneration)
        && selectedRequestId.value === request.id
      ) requestDetails.value = details
    } catch (cause) {
      if (sequence !== requestDetailsSequence || !isCurrent(tab.id, expectedGeneration)) return
      monitorError.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (sequence === requestDetailsSequence && isCurrent(tab.id, expectedGeneration)) {
        requestDetailsLoading.value = false
      }
    }
  }

  async function replaySelectedRequest(): Promise<void> {
    const tab = options.activeTab.value
    const request = requestDetails.value
    if (!tab || !request || request.resourceType.toLowerCase() !== 'xhr') return
    const expectedGeneration = generation
    const method = request.method.trim().toUpperCase()
    const confirmationRequired = networkReplayRequiresConfirmation(method)
    if (confirmationRequired && replayState.value !== 'confirming') {
      resetReplayFeedback()
      replayState.value = 'confirming'
      replayMessage.value = options.translate('networkReplayStatus.confirm', { method })
      replayConfirmTimer = window.setTimeout(() => resetReplayFeedback(), 6_000)
      return
    }
    resetReplayFeedback()
    replayState.value = 'replaying'
    replayMessage.value = options.translate('networkReplayStatus.replaying', { method })
    try {
      const result = await options.browser.replayNetworkRequest(tab.id, request.id, confirmationRequired)
      if (!isCurrent(tab.id, expectedGeneration)) return
      await refresh()
      if (!isCurrent(tab.id, expectedGeneration)) return
      const replayed = requests.value.find((candidate) => candidate.id === result.replayedRequest.id)
      if (replayed) await selectRequest(replayed)
      if (!isCurrent(tab.id, expectedGeneration)) return
      replayState.value = 'replayed'
      replayMessage.value = options.translate('networkReplayStatus.replayed', { method })
    } catch (cause) {
      if (!isCurrent(tab.id, expectedGeneration)) return
      replayState.value = 'error'
      replayMessage.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function selectRelatedRequest(request: BrowserNetworkRequest): Promise<void> {
    search.value = ''
    resourceFilter.value = ''
    failuresOnly.value = false
    await nextTick()
    await selectRequest(request)
  }

  function closeContentSearch(): void {
    contentSearchSequence += 1
    contentSearchOpen.value = false
    contentSearchState.value = 'idle'
    contentSearchResult.value = null
    contentSearchError.value = ''
  }

  function toggleContentSearch(): void {
    if (contentSearchOpen.value) closeContentSearch()
    else contentSearchOpen.value = true
  }

  async function runContentSearch(): Promise<void> {
    const tab = options.activeTab.value
    const query = contentSearchQuery.value.trim()
    if (!tab || !query) return
    const expectedGeneration = generation
    const sequence = ++contentSearchSequence
    contentSearchState.value = 'searching'
    contentSearchError.value = ''
    try {
      const result = await options.browser.searchNetwork({
        tabId: tab.id,
        query,
        caseSensitive: contentSearchCaseSensitive.value
      })
      if (sequence !== contentSearchSequence || !isCurrent(tab.id, expectedGeneration)) return
      contentSearchResult.value = result
      contentSearchState.value = 'complete'
    } catch (cause) {
      if (sequence !== contentSearchSequence || !isCurrent(tab.id, expectedGeneration)) return
      contentSearchState.value = 'error'
      contentSearchError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function selectSearchMatch(match: BrowserNetworkSearchMatch): Promise<void> {
    const request = requests.value.find((candidate) => candidate.id === match.requestId)
    if (!request) {
      contentSearchError.value = options.translate('runtime.network.removed')
      return
    }
    await selectRequest(request)
  }

  async function copyDetails(format: 'json' | BrowserNetworkRequestCopyFormat = 'json'): Promise<void> {
    if (!requestDetails.value) return
    monitorError.value = ''
    try {
      const text = format === 'json'
        ? JSON.stringify(requestDetails.value, null, 2)
        : formatNetworkRequestCopy(requestDetails.value, format)
      if (!await options.copyText(text)) return
      detailsCopied.value = format
      scheduleFeedbackReset(() => {
        if (detailsCopied.value === format) detailsCopied.value = null
      }, 1_500)
    } catch (cause) {
      monitorError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function harOptions(tabId: string) {
    return {
      tabId,
      query: search.value,
      resourceType: resourceFilter.value || undefined,
      errorsOnly: failuresOnly.value,
      includeBodies: false,
      maxRequests: 100
    }
  }

  async function copyHar(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = generation
    monitorError.value = ''
    try {
      const har: BrowserNetworkHar = await options.browser.createNetworkHar(harOptions(tab.id))
      if (!isCurrent(tab.id, expectedGeneration)) return
      if (!await options.copyText(JSON.stringify(har, null, 2))) return
      if (!isCurrent(tab.id, expectedGeneration)) return
      harCopied.value = true
      scheduleFeedbackReset(() => (harCopied.value = false), 1_500)
    } catch (cause) {
      if (!isCurrent(tab.id, expectedGeneration)) return
      monitorError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function saveHar(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || harSaveState.value === 'saving') return
    const expectedGeneration = generation
    monitorError.value = ''
    harSaveState.value = 'saving'
    harExport.value = null
    try {
      const exported = await options.browser.saveNetworkHar(harOptions(tab.id))
      if (!isCurrent(tab.id, expectedGeneration)) return
      harExport.value = exported
      harSaveState.value = 'saved'
      scheduleFeedbackReset(() => {
        if (harSaveState.value === 'saved') harSaveState.value = 'idle'
      }, 2_500)
    } catch (cause) {
      if (!isCurrent(tab.id, expectedGeneration)) return
      harSaveState.value = 'idle'
      monitorError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function requestStatus(request: BrowserNetworkRequest): string {
    if (request.error) return request.error.replace(/^net::/, '')
    if (request.status !== undefined) return String(request.status)
    return request.completedAt ? options.translate('runtime.network.done') : options.translate('runtime.network.pending')
  }

  function formatMilliseconds(value: number): string {
    if (value > 0 && value < 1) return '<1 ms'
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`
    const rounded = Math.round(value * 10) / 10
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ms`
  }

  function requestDuration(request: BrowserNetworkRequest): string {
    if (request.durationMs !== undefined) return formatMilliseconds(request.durationMs)
    if (!request.completedAt) return '—'
    const duration = Date.parse(request.completedAt) - Date.parse(request.startedAt)
    return Number.isFinite(duration) ? formatMilliseconds(Math.max(0, duration)) : '—'
  }

  function waterfallStyle(request: BrowserNetworkRequest): Record<string, string> {
    const position = networkWaterfallPosition(request, waterfallRange.value)
    if (!position) return {}
    return {
      '--network-waterfall-left': `${position.leftPercent.toFixed(3)}%`,
      '--network-waterfall-width': `${position.widthPercent.toFixed(3)}%`
    }
  }

  function waterfallLabel(request: BrowserNetworkRequest): string {
    const position = networkWaterfallPosition(request, waterfallRange.value)
    if (!position) return options.translate('network.details.timingUnavailable')
    const start = position.startOffsetMs > 0
      ? options.translate('network.details.startedAfter', { duration: formatMilliseconds(position.startOffsetMs) })
      : options.translate('network.details.firstRequest')
    const duration = position.durationMs === undefined
      ? options.translate('network.details.pending')
      : options.translate('network.details.total', { duration: formatMilliseconds(position.durationMs) })
    const waiting = request.waitingForResponseMs === undefined
      ? ''
      : `, ${options.translate('network.details.waitingResponse', { duration: formatMilliseconds(request.waitingForResponseMs) })}`
    return `${start}; ${duration}${waiting}`
  }

  function toggleSortDirection(): void {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  }

  function setSortBy(value: BrowserNetworkRequestSortBy): void {
    sortBy.value = value
    sortDirection.value = ['duration', 'waiting', 'size', 'status'].includes(value) ? 'desc' : 'asc'
  }

  function requestName(request: Pick<BrowserNetworkRequest, 'url'>): string {
    try {
      const url = new URL(request.url)
      return `${url.pathname.split('/').filter(Boolean).at(-1) || url.hostname}${url.search}`
    } catch {
      return request.url
    }
  }

  function requestSourceSummary(request: BrowserNetworkRequest): string {
    if (!request.responseSource) return options.translate('network.details.sourceUnavailable')
    const source = networkResponseSourceLabel(request.responseSource)
    if (request.responseSource !== 'service-worker' || !request.serviceWorkerResponseSource) return source
    return `${source} · ${serviceWorkerResponseSourceLabel(request.serviceWorkerResponseSource)}`
  }

  function initiatorLabel(type: string): string {
    return type.replace(/[-_]/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
  }

  function relationshipCount(details: BrowserNetworkRequestDetails): number {
    const relationships = details.relationships
    if (!relationships) return 0
    return Math.max(0, relationships.redirectChain.length - 1)
      + (relationships.triggeredBy ? 1 : 0)
      + relationships.dependents.length
  }

  function sourceLocation(url: string | undefined, lineNumber?: number, columnNumber?: number): string {
    const position = lineNumber !== undefined
      ? `:${lineNumber}${columnNumber !== undefined ? `:${columnNumber}` : ''}`
      : ''
    return `${url || options.translate('network.details.inlineScript')}${position}`
  }

  function timingRows(timing: BrowserNetworkRequestDetails['timing']): Array<{
    key: string
    label: string
    value: number
    subphase?: boolean
  }> {
    if (!timing) return []
    const rows = [
      { key: 'total', label: options.translate('network.details.timingRows.total'), value: timing.totalMs },
      { key: 'setup', label: options.translate('network.details.timingRows.setup'), value: timing.queuedAndConnectingMs },
      { key: 'proxy', label: options.translate('network.details.timingRows.proxy'), value: timing.proxyMs, subphase: true },
      { key: 'dns', label: options.translate('network.details.timingRows.dns'), value: timing.dnsMs, subphase: true },
      { key: 'connection', label: options.translate('network.details.timingRows.connection'), value: timing.connectionMs, subphase: true },
      { key: 'tls', label: options.translate('network.details.timingRows.tls'), value: timing.tlsMs, subphase: true },
      { key: 'service-worker', label: options.translate('network.details.timingRows.serviceWorker'), value: timing.serviceWorkerPreparationMs, subphase: true },
      { key: 'sent', label: options.translate('network.details.timingRows.sent'), value: timing.requestSentMs },
      { key: 'waiting', label: options.translate('network.details.timingRows.waiting'), value: timing.waitingForResponseMs },
      { key: 'headers', label: options.translate('network.details.timingRows.headers'), value: timing.responseHeadersMs },
      { key: 'download', label: options.translate('network.details.timingRows.download'), value: timing.contentDownloadMs }
    ]
    return rows.filter((row): row is { key: string; label: string; value: number; subphase?: boolean } => (
      row.value !== undefined && Number.isFinite(row.value)
    ))
  }

  function timingPercent(value: number, timing: BrowserNetworkRequestDetails['timing']): number {
    const rows = timingRows(timing)
    const scale = timing?.totalMs && timing.totalMs > 0
      ? timing.totalMs
      : Math.max(...rows.map((row) => row.value), 1)
    return Math.max(value > 0 ? 2 : 0, Math.min(100, value / scale * 100))
  }

  function dispose(): void {
    invalidateRequests()
    resetReplayFeedback()
    for (const timer of feedbackTimers) window.clearTimeout(timer)
    feedbackTimers.clear()
  }

  return {
    monitorState,
    requests,
    requestDetails,
    selectedRequestId,
    requestDetailsLoading,
    monitorError,
    detailsCopied,
    replayState,
    replayMessage,
    search,
    contentSearchOpen,
    contentSearchQuery,
    contentSearchCaseSensitive,
    contentSearchState,
    contentSearchResult,
    contentSearchError,
    resourceFilter,
    failuresOnly,
    sortBy,
    sortDirection,
    harCopied,
    harSaveState,
    harExport,
    requestConditionsExpanded,
    routes,
    routeState,
    routeError,
    routeMode,
    routePattern,
    routeMethod,
    routeTimes,
    routeAbort,
    routeThrottle,
    routeStatus,
    routeHeaders,
    routeBody,
    resourceFilters,
    sortOptions,
    filteredRequests,
    waterfallRange,
    failureCount,
    responseBytes,
    reset,
    refresh,
    refreshRoutes,
    refreshAll,
    openRequestConditions,
    resetRouteDraft,
    addRouteFromDraft,
    removeRoute,
    moveRoute,
    clearRoutes,
    selectRequest,
    resetReplayFeedback,
    replaySelectedRequest,
    selectRelatedRequest,
    closeContentSearch,
    toggleContentSearch,
    runContentSearch,
    selectSearchMatch,
    copyDetails,
    copyHar,
    saveHar,
    requestStatus,
    requestDuration,
    waterfallStyle,
    waterfallLabel,
    toggleSortDirection,
    setSortBy,
    requestName,
    requestSourceSummary,
    initiatorLabel,
    relationshipCount,
    sourceLocation,
    formatMilliseconds,
    timingRows,
    timingPercent,
    canFormatRequestCopy: canFormatNetworkRequestCopy,
    isRequestFailure: isNetworkRequestFailure,
    responseSourceLabel: networkResponseSourceLabel,
    serviceWorkerSourceLabel: serviceWorkerResponseSourceLabel,
    replayRequiresConfirmation: networkReplayRequiresConfirmation,
    dispose
  }
}
