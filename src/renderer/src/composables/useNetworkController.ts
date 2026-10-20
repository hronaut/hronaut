import { isHronautHomeUrl } from '../../../shared/home-url.js'
import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type {
  BrowserNetworkHar,
  BrowserNetworkHarExport,
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkRequestSortBy,
  BrowserNetworkRequestSortDirection,
  BrowserState,
  BrowserTabState,
  HronautApi,
  SupportedLocale
} from '../../../shared/types.js'
import { formatNumber } from '../../../shared/format.js'
import {
  canFormatNetworkRequestCopy,
  formatNetworkRequestCopy,
  NetworkRequestCopyRefusal,
  type BrowserNetworkRequestCopyFormat
} from '../../../shared/network-request-copy.js'
import { sortNetworkRequests } from '../../../shared/network-request-sort.js'
import { networkReplayRequiresConfirmation } from '../../../shared/network-replay.js'
import { totalNetworkResponseBytes } from '../../../shared/network-bytes.js'
import {
  buildNetworkWaterfallRange,
  networkRequestDurationMs,
  networkWaterfallPosition
} from '../../../shared/network-waterfall.js'
import {
  filterNetworkRequests,
  isNetworkRequestFailure,
  normalizeNetworkHarOptions
} from '../../../shared/network-har.js'
import { createFeedbackTimerRegistry } from './feedback-timer-registry.js'
import type { CopyTextWithFeedback } from './useShellFeedbackController.js'
import { createNetworkLabels } from './network/network-labels.js'
import { useNetworkContentSearch } from './network/useNetworkContentSearch.js'
import { useNetworkRequestConditions } from './network/useNetworkRequestConditions.js'
import { friendlyUiError } from './useAppToastController.js'

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
  | 'setNetworkRouteEnabled'
  | 'removeNetworkRoute'
  | 'clearNetworkRoutes'
  | 'getState'
>

type Translate = (key: string, parameters?: Record<string, string | number>) => string
type NetworkDetailsCopyFormat = 'json' | 'response' | 'url' | BrowserNetworkRequestCopyFormat

export interface NetworkControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  open: Ref<boolean>
  browser: NetworkBrowserApi
  translate: Translate
  locale: () => SupportedLocale
  copyText: CopyTextWithFeedback
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
  const detailsCopied = ref<NetworkDetailsCopyFormat | null>(null)
  const canCopyResponseBody = computed(() => !requestDetailsLoading.value
    && requestDetails.value?.response.body.available === true
    && typeof requestDetails.value.response.body.text === 'string')
  const replayState = ref<'idle' | 'confirming' | 'replaying' | 'replayed' | 'error'>('idle')
  const replayMessage = ref('')
  const search = ref('')
  const resourceFilter = ref('')
  const failuresOnly = ref(false)
  const sortBy = ref<BrowserNetworkRequestSortBy>('start-time')
  const sortDirection = ref<BrowserNetworkRequestSortDirection>('asc')
  const harCopied = ref(false)
  const harSaveState = ref<'idle' | 'saving' | 'saved'>('idle')
  const harExport = ref<BrowserNetworkHarExport | null>(null)

  let generation = 0
  let monitorRequestSequence = 0
  let requestDetailsSequence = 0
  let detailsCopySequence = 0
  let harCopySequence = 0
  let replaySequence = 0
  let replayConfirmTimer: number | undefined
  const feedbackTimers = createFeedbackTimerRegistry<'details' | 'har' | 'har-save'>()
  const stopPanelOpenTracking = watch(options.open, (open) => {
    if (open) return
    // Closing retires copy ownership; an already-dispatched write cannot be undone.
    detailsCopySequence += 1
    harCopySequence += 1
    detailsCopied.value = null
    harCopied.value = false
    feedbackTimers.clear('details')
    feedbackTimers.clear('har')
  }, { flush: 'sync' })
  // However the panel opens, from Page tools, Request conditions or the command palette, it reads the page's requests
  // and request conditions as they are now. The read waits for the flush, so it reads the tab the panel opens for.
  const stopPanelOpenRefresh = watch(options.open, (open) => {
    if (open) void refreshAll()
  })
  // Content search and request conditions own their state, request sequences
  // and input watchers; the page generation stays here.
  const { contentSearchOpen, contentSearchQuery, contentSearchCaseSensitive, contentSearchState,
    contentSearchResult, contentSearchError, stopContentSearchInputTracking, invalidateContentSearch,
    closeContentSearch, toggleContentSearch, runContentSearch, selectSearchMatch } = useNetworkContentSearch(
    options, { requests, selectRequest, currentGeneration: () => generation, isCurrent })
  const { requestConditionsExpanded, routes, routeState, routeError, routeMode, routePattern, routeMethod,
    routeTimes, routeAbort, routeThrottle, routeStatus, routeHeaders, routeBody, stopRouteDraftTracking,
    invalidateRouteRequests, resetRouteDraft, refreshRoutes, openRequestConditions, addRouteFromDraft,
    setRouteEnabled, removeRoute, moveRoute, clearRoutes } = useNetworkRequestConditions(
    options, { currentGeneration: () => generation, isCurrent })
  const stopHarFilterTracking = watch([search, resourceFilter, failuresOnly], () => {
    harCopySequence += 1
    harCopied.value = false
    feedbackTimers.clear('har')
  }, { flush: 'sync' })

  const labels = createNetworkLabels(options.translate)
  const resourceFilters = computed(() => [
    { value: '', label: options.translate('network.filters.all') },
    ...['fetch/xhr', 'document', 'script', 'stylesheet', 'image', 'eventsource', 'websocket', 'other']
      .map((value) => ({ value, label: labels.categoryLabel(value) }))
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
  const responseBytes = computed(() => totalNetworkResponseBytes(requests.value))

  function isCurrent(tabId: string, expectedGeneration: number): boolean {
    return generation === expectedGeneration && options.activeTab.value?.id === tabId
  }

  function invalidateRequests(): void {
    generation += 1
    invalidateContentSearch()
    monitorRequestSequence += 1
    invalidateRouteRequests()
    requestDetailsSequence += 1
    detailsCopySequence += 1
    harCopySequence += 1
  }

  function resetReplayFeedback(): void {
    replaySequence += 1
    if (replayConfirmTimer !== undefined) {
      window.clearTimeout(replayConfirmTimer)
      replayConfirmTimer = undefined
    }
    replayState.value = 'idle'
    replayMessage.value = ''
  }

  function reset(closePanel = false): void {
    invalidateRequests()
    feedbackTimers.clearAll()
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

  function clearRequestSelection(): void {
    requestDetailsSequence += 1
    detailsCopySequence += 1
    feedbackTimers.clear('details')
    selectedRequestId.value = null
    requestDetails.value = null
    requestDetailsLoading.value = false
    detailsCopied.value = null
  }

  async function refresh(clear = false): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || isHronautHomeUrl(tab.url)) return
    const expectedGeneration = generation
    const sequence = ++monitorRequestSequence
    monitorState.value = 'loading'
    monitorError.value = ''
    harCopied.value = false
    if (harSaveState.value !== 'saving') harSaveState.value = 'idle'
    harExport.value = null
    if (clear) {
      // Retire exports of the records being cleared before awaiting the clear.
      // This cannot undo a clipboard write that has already been dispatched.
      harCopySequence += 1
      feedbackTimers.clear('har')
      invalidateContentSearch()
      clearRequestSelection()
      resetReplayFeedback()
      contentSearchResult.value = null
      contentSearchState.value = 'idle'
      contentSearchError.value = ''
    }
    try {
      const nextRequests = await options.browser.listNetworkRequests(tab.id, clear)
      if (sequence !== monitorRequestSequence || !isCurrent(tab.id, expectedGeneration)) return
      // Clearing returns the removed records; they are no longer retained.
      requests.value = clear ? [] : nextRequests
      monitorState.value = 'ready'
      if (selectedRequestId.value && !requests.value.some((request) => request.id === selectedRequestId.value)) {
        clearRequestSelection()
      }
    } catch (cause) {
      if (sequence !== monitorRequestSequence || !isCurrent(tab.id, expectedGeneration)) return
      monitorState.value = 'error'
      monitorError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([refresh(), refreshRoutes()])
  }

  async function loadRequestDetails(request: Pick<BrowserNetworkRequest, 'id'>): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = generation
    const sequence = ++requestDetailsSequence
    detailsCopySequence += 1
    feedbackTimers.clear('details')
    selectedRequestId.value = request.id
    requestDetails.value = null
    detailsCopied.value = null
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
      monitorError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    } finally {
      if (sequence === requestDetailsSequence && isCurrent(tab.id, expectedGeneration)) {
        requestDetailsLoading.value = false
      }
    }
  }

  async function selectRequest(request: BrowserNetworkRequest): Promise<void> {
    if (!options.activeTab.value) return
    resetReplayFeedback()
    await loadRequestDetails(request)
  }

  async function refreshSelectedRequest(): Promise<void> {
    const id = selectedRequestId.value
    if (!id || requestDetailsLoading.value || replayState.value === 'replaying') return
    resetReplayFeedback()
    await loadRequestDetails({ id })
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
    const sequence = replaySequence
    const isReplayCurrent = () => sequence === replaySequence && isCurrent(tab.id, expectedGeneration)
    replayState.value = 'replaying'
    replayMessage.value = options.translate('networkReplayStatus.replaying', { method })
    try {
      const result = await options.browser.replayNetworkRequest(tab.id, request.id, confirmationRequired)
      if (!isReplayCurrent()) return
      await refresh()
      if (!isReplayCurrent()) return
      const replayed = requests.value.find((candidate) => candidate.id === result.replayedRequest.id)
      // Showing this operation's result preserves its feedback ownership;
      // a later user selection invalidates it through selectRequest instead.
      if (replayed) await loadRequestDetails(replayed)
      if (!isReplayCurrent()) return
      replayState.value = 'replayed'
      replayMessage.value = options.translate('networkReplayStatus.replayed', { method })
    } catch (cause) {
      if (!isReplayCurrent()) return
      replayState.value = 'error'
      replayMessage.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  async function selectRelatedRequest(request: BrowserNetworkRequest): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = generation
    const sequence = ++requestDetailsSequence
    search.value = ''
    resourceFilter.value = ''
    failuresOnly.value = false
    await nextTick()
    if (sequence !== requestDetailsSequence || !isCurrent(tab.id, expectedGeneration)) return
    await selectRequest(request)
  }

  async function copyDetails(format: NetworkDetailsCopyFormat = 'json'): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || !requestDetails.value) return
    if (format === 'response' && !canCopyResponseBody.value) return
    const expectedGeneration = generation
    const sequence = ++detailsCopySequence
    monitorError.value = ''
    detailsCopied.value = null
    feedbackTimers.clear('details')
    try {
      const text = format === 'json'
        ? JSON.stringify(requestDetails.value, null, 2)
        : format === 'response'
          ? requestDetails.value.response.body.text!
          : format === 'url'
            ? requestDetails.value.url
            : formatNetworkRequestCopy(requestDetails.value, format)
      const ownsFeedback = () => (
        sequence === detailsCopySequence
        && isCurrent(tab.id, expectedGeneration)
        && options.activeTab.value?.url === tab.url
      )
      if (!await options.copyText(text, ownsFeedback)) return
      if (!ownsFeedback()) return
      detailsCopied.value = format
      feedbackTimers.schedule('details', () => {
        if (detailsCopied.value === format) detailsCopied.value = null
      })
    } catch (cause) {
      if (sequence !== detailsCopySequence || !isCurrent(tab.id, expectedGeneration)) return
      // A request this format cannot copy says why in the interface language; agents keep the English message.
      monitorError.value = cause instanceof NetworkRequestCopyRefusal
        ? options.translate(cause.key)
        : friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
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
    const sequence = ++harCopySequence
    harCopied.value = false
    feedbackTimers.clear('har')
    monitorError.value = ''
    try {
      const har: BrowserNetworkHar = await options.browser.createNetworkHar(harOptions(tab.id))
      if (sequence !== harCopySequence || !isCurrent(tab.id, expectedGeneration)) return
      if (!await options.copyText(JSON.stringify(har, null, 2), () => (
        sequence === harCopySequence && isCurrent(tab.id, expectedGeneration)
      ))) return
      if (sequence !== harCopySequence || !isCurrent(tab.id, expectedGeneration)) return
      harCopied.value = true
      feedbackTimers.schedule('har', () => (harCopied.value = false))
    } catch (cause) {
      if (sequence !== harCopySequence || !isCurrent(tab.id, expectedGeneration)) return
      monitorError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
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
      feedbackTimers.schedule('har-save', () => {
        if (harSaveState.value === 'saved') harSaveState.value = 'idle'
      }, 2_500)
    } catch (cause) {
      if (!isCurrent(tab.id, expectedGeneration)) return
      harSaveState.value = 'idle'
      monitorError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  function requestStatus(request: BrowserNetworkRequest): string {
    if (request.error) return request.error.replace(/^net::/, '')
    if (request.status !== undefined) return String(request.status)
    return request.completedAt ? options.translate('runtime.network.done') : options.translate('runtime.network.pending')
  }

  // Durations use the interface language's decimal separator, such as 1,25 s in German.
  function formatMilliseconds(value: number): string {
    if (value > 0 && value < 1) return '<1 ms'
    if (value >= 1_000) {
      const digits = value >= 10_000 ? 1 : 2
      return `${formatNumber(options.locale(), value / 1_000, { minimumFractionDigits: digits, maximumFractionDigits: digits })} s`
    }
    // A Server-Timing entry can carry -0, which is written as 0.
    return `${formatNumber(options.locale(), value === 0 ? 0 : value, { maximumFractionDigits: 1, useGrouping: false })} ms`
  }

  // The same duration the waterfall and the Duration sort use.
  function requestDuration(request: BrowserNetworkRequest): string {
    const duration = networkRequestDurationMs(request)
    return duration === undefined ? '—' : formatMilliseconds(duration)
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
    const source = labels.responseSource(request.responseSource)
    if (request.responseSource !== 'service-worker' || !request.serviceWorkerResponseSource) return source
    return `${source} · ${labels.serviceWorkerSource(request.serviceWorkerResponseSource)}`
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
    stopPanelOpenTracking()
    stopPanelOpenRefresh()
    stopContentSearchInputTracking()
    stopRouteDraftTracking()
    stopHarFilterTracking()
    invalidateRequests()
    resetReplayFeedback()
    feedbackTimers.clearAll()
  }

  return {
    monitorState,
    requests,
    requestDetails,
    selectedRequestId,
    requestDetailsLoading,
    monitorError,
    detailsCopied,
    canCopyResponseBody,
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
    setRouteEnabled,
    removeRoute,
    moveRoute,
    clearRoutes,
    selectRequest,
    refreshSelectedRequest,
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
    initiatorLabel: labels.initiator,
    relationshipCount,
    sourceLocation,
    formatMilliseconds,
    timingRows,
    timingPercent,
    canFormatRequestCopy: canFormatNetworkRequestCopy,
    isRequestFailure: isNetworkRequestFailure,
    responseSourceLabel: labels.responseSource,
    serviceWorkerSourceLabel: labels.serviceWorkerSource,
    requestCategoryLabel: labels.requestCategory,
    resourceTypeLabel: labels.resourceType,
    messageDirectionLabel: labels.messageDirection,
    messageKindLabel: labels.messageKind,
    bodyPlaceholderLabel: labels.bodyPlaceholder,
    bodyReasonLabel: labels.bodyReason,
    replayRequiresConfirmation: networkReplayRequiresConfirmation,
    dispose
  }
}
