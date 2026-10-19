import { ref, watch, type Ref } from 'vue'
import type {
  BrowserNetworkRequest,
  BrowserNetworkSearchMatch,
  BrowserNetworkSearchResult,
  BrowserTabState,
  HronautApi
} from '../../../../shared/types.js'
import { friendlyUiError } from '../useAppToastController.js'

interface NetworkContentSearchOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<HronautApi, 'searchNetwork'>
  translate: (key: string, parameters?: Record<string, string | number>) => string
}

/** The recorded requests a match opens, and the controller's page generation. */
interface NetworkContentSearchContext {
  requests: Readonly<Ref<BrowserNetworkRequest[]>>
  selectRequest: (request: BrowserNetworkRequest) => Promise<void>
  currentGeneration: () => number
  isCurrent: (tabId: string, expectedGeneration: number) => boolean
}

/** Searching the recorded request and response contents, and opening a match. */
export function useNetworkContentSearch(
  options: NetworkContentSearchOptions,
  { requests, selectRequest, currentGeneration, isCurrent }: NetworkContentSearchContext
) {
  const contentSearchOpen = ref(false)
  const contentSearchQuery = ref('')
  const contentSearchCaseSensitive = ref(false)
  const contentSearchState = ref<'idle' | 'searching' | 'complete' | 'error'>('idle')
  const contentSearchResult = ref<BrowserNetworkSearchResult | null>(null)
  const contentSearchError = ref('')

  let contentSearchSequence = 0
  const stopContentSearchInputTracking = watch([contentSearchQuery, contentSearchCaseSensitive], () => {
    contentSearchSequence += 1
    contentSearchState.value = 'idle'
    contentSearchResult.value = null
    contentSearchError.value = ''
  }, { flush: 'sync' })

  /** Retires an in-flight search so its late result is ignored. */
  function invalidateContentSearch(): void {
    contentSearchSequence += 1
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
    const expectedGeneration = currentGeneration()
    const sequence = ++contentSearchSequence
    contentSearchState.value = 'searching'
    contentSearchResult.value = null
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
      contentSearchError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
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

  return {
    contentSearchOpen,
    contentSearchQuery,
    contentSearchCaseSensitive,
    contentSearchState,
    contentSearchResult,
    contentSearchError,
    stopContentSearchInputTracking,
    invalidateContentSearch,
    closeContentSearch,
    toggleContentSearch,
    runContentSearch,
    selectSearchMatch
  }
}
