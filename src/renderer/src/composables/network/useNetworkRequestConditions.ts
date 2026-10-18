import { ref, watch, type Ref } from 'vue'
import { isHronautHomeUrl } from '../../../../shared/home-url.js'
import type {
  BrowserNetworkAbortReason,
  BrowserNetworkRouteInput,
  BrowserNetworkRouteSummary,
  BrowserState,
  BrowserTabState,
  HronautApi
} from '../../../../shared/types.js'
import { DEFAULT_BROWSER_NETWORK_ABORT_REASON } from '../../../../shared/types.js'

interface NetworkRequestConditionsOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<
    HronautApi,
    | 'listNetworkRoutes'
    | 'addNetworkRoute'
    | 'moveNetworkRoute'
    | 'setNetworkRouteEnabled'
    | 'removeNetworkRoute'
    | 'clearNetworkRoutes'
    | 'getState'
  >
  translate: (key: string, parameters?: Record<string, string | number>) => string
  syncState: (operation: Promise<BrowserState>) => Promise<void>
}

/** The network controller's page generation, which a page change advances. */
interface NetworkGeneration {
  currentGeneration: () => number
  isCurrent: (tabId: string, expectedGeneration: number) => boolean
}

/** The request conditions section: the tab's route list, the rule draft and its changes. */
export function useNetworkRequestConditions(
  options: NetworkRequestConditionsOptions,
  { currentGeneration, isCurrent }: NetworkGeneration
) {
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

  let routeRequestSequence = 0
  let routeMutationSequence = 0
  let routeRefreshPending = false
  let routeDraftGeneration = 0
  const stopRouteDraftTracking = watch([
    routeMode, routePattern, routeMethod, routeTimes, routeAbort,
    routeThrottle, routeStatus, routeHeaders, routeBody
  ], () => { routeDraftGeneration += 1 }, { flush: 'sync' })

  /** Retires in-flight route reads and changes, and drops a pending refresh. */
  function invalidateRouteRequests(): void {
    routeRequestSequence += 1
    routeMutationSequence += 1
    routeRefreshPending = false
  }

  function beginRouteMutation(): number {
    // A route list read can capture the pre-mutation snapshot and still resolve
    // after the mutation. Invalidate it so it cannot replace authoritative
    // mutation results with stale routes.
    routeRequestSequence += 1
    return ++routeMutationSequence
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

  async function readRoutes(tabId: string, expectedGeneration: number, preserveMutationError = false): Promise<void> {
    const sequence = ++routeRequestSequence
    try {
      const nextRoutes = await options.browser.listNetworkRoutes(tabId)
      if (sequence !== routeRequestSequence || !isCurrent(tabId, expectedGeneration)) return
      routes.value = nextRoutes
      if (!preserveMutationError) routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeRequestSequence || !isCurrent(tabId, expectedGeneration) || preserveMutationError) return
      routeState.value = 'error'
      routeError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function refreshRoutes(silent = false): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || isHronautHomeUrl(tab.url)) return
    // Main can expose a proposed list while Chromium is still applying it.
    // Coalesce refreshes until settlement; a rule may change meanwhile.
    if (routeState.value === 'saving') {
      routeRefreshPending = true
      return
    }
    if (!silent) routeState.value = 'loading'
    routeError.value = ''
    await readRoutes(tab.id, currentGeneration())
  }

  async function reconcilePendingRoutes(tabId: string, expectedGeneration: number, mutationSequence: number): Promise<void> {
    if (!routeRefreshPending || mutationSequence !== routeMutationSequence || !isCurrent(tabId, expectedGeneration)) return
    routeRefreshPending = false
    // Reconcile the list even after failure, without hiding the mutation error.
    await readRoutes(tabId, expectedGeneration, routeState.value === 'error')
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
    const expectedGeneration = currentGeneration()
    const sequence = beginRouteMutation()
    const submittedDraftGeneration = routeDraftGeneration
    let committed = false
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
      committed = true
      routes.value = nextRoutes
      if (routeDraftGeneration === submittedDraftGeneration) resetRouteDraft()
      await options.syncState(options.browser.getState())
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = committed
        ? options.translate('network.conditions.refreshAfterChangeFailed')
        : cause instanceof Error ? cause.message : String(cause)
    } finally {
      await reconcilePendingRoutes(tab.id, expectedGeneration, sequence)
    }
  }

  async function setRouteEnabled(routeId: string, enabled: boolean): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = currentGeneration()
    const sequence = beginRouteMutation()
    let committed = false
    routeState.value = 'saving'
    routeError.value = ''
    try {
      const nextRoutes = await options.browser.setNetworkRouteEnabled(tab.id, routeId, enabled)
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      committed = true
      routes.value = nextRoutes
      await options.syncState(options.browser.getState())
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = committed
        ? options.translate('network.conditions.refreshAfterChangeFailed')
        : cause instanceof Error ? cause.message : String(cause)
    } finally {
      await reconcilePendingRoutes(tab.id, expectedGeneration, sequence)
    }
  }

  async function removeRoute(routeId: string): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = currentGeneration()
    const sequence = beginRouteMutation()
    let committed = false
    routeState.value = 'saving'
    routeError.value = ''
    try {
      const nextRoutes = await options.browser.removeNetworkRoute(tab.id, routeId)
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      committed = true
      routes.value = nextRoutes
      await options.syncState(options.browser.getState())
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'ready'
    } catch (cause) {
      if (sequence !== routeMutationSequence || !isCurrent(tab.id, expectedGeneration)) return
      routeState.value = 'error'
      routeError.value = committed
        ? options.translate('network.conditions.refreshAfterChangeFailed')
        : cause instanceof Error ? cause.message : String(cause)
    } finally {
      await reconcilePendingRoutes(tab.id, expectedGeneration, sequence)
    }
  }

  async function moveRoute(routeId: string, direction: 'up' | 'down'): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    const expectedGeneration = currentGeneration()
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
    } finally {
      await reconcilePendingRoutes(tab.id, expectedGeneration, sequence)
    }
  }

  async function clearRoutes(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || (!tab.networkRouteCount && (!tab.networkConditionState || tab.networkConditionState.application === 'confirmed'))) return
    const expectedGeneration = currentGeneration()
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
    } finally {
      await reconcilePendingRoutes(tab.id, expectedGeneration, sequence)
    }
  }

  return {
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
    stopRouteDraftTracking,
    invalidateRouteRequests,
    resetRouteDraft,
    refreshRoutes,
    openRequestConditions,
    addRouteFromDraft,
    setRouteEnabled,
    removeRoute,
    moveRoute,
    clearRoutes
  }
}
