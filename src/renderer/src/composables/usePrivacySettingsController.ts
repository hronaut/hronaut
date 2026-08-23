import { computed, ref } from 'vue'
import type {
  HronautBrowsingDataApi,
  BrowsingDataClearOptions,
  BrowsingDataSummary,
  BrowsingDataWebsiteSummary
} from '../../../shared/types.js'

type PrivacyBrowsingDataApi = Pick<HronautBrowsingDataApi, 'summary' | 'websites' | 'clear'>
type Translate = (key: string, parameters?: Record<string, string | number>, plural?: number) => string
type PrivacySummaryState = 'idle' | 'loading' | 'clearing' | 'cleared' | 'error'
type PrivacyWebsiteState = 'idle' | 'loading' | 'clearing' | 'cleared' | 'error'

const DEFAULT_CLEAR_OPTIONS: BrowsingDataClearOptions = {
  history: true,
  cookiesAndSiteData: false,
  cache: true
}

export interface PrivacySettingsControllerOptions {
  api: PrivacyBrowsingDataApi
  translate: Translate
  confirm: (message: string) => boolean
  formatNumber: (value: number) => string
}

export function usePrivacySettingsController(options: PrivacySettingsControllerOptions) {
  const summary = ref<BrowsingDataSummary | null>(null)
  const clearOptions = ref<BrowsingDataClearOptions>({ ...DEFAULT_CLEAR_OPTIONS })
  const summaryState = ref<PrivacySummaryState>('idle')
  const summaryMessage = ref('')
  const websites = ref<BrowsingDataWebsiteSummary[]>([])
  const search = ref('')
  const websiteState = ref<PrivacyWebsiteState>('idle')
  const clearingOrigin = ref<string | null>(null)
  const websiteMessage = ref('')
  let summaryGeneration = 0
  let websiteGeneration = 0

  const selectedCount = computed(() => [
    clearOptions.value.history,
    clearOptions.value.cookiesAndSiteData,
    clearOptions.value.cache
  ].filter(Boolean).length)

  const clearing = computed(() => summaryState.value === 'clearing' || websiteState.value === 'clearing')
  const canClear = computed(() => (
    selectedCount.value > 0
    && summaryState.value !== 'loading'
    && !clearing.value
  ))

  const filteredWebsites = computed(() => {
    const query = search.value.trim().toLocaleLowerCase()
    if (!query) return websites.value
    return websites.value.filter((site) => (
      site.hostname.toLocaleLowerCase().includes(query)
      || site.origin.toLocaleLowerCase().includes(query)
      || site.title.toLocaleLowerCase().includes(query)
    ))
  })

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function refreshSummary(): Promise<void> {
    if (clearing.value) return
    const generation = ++summaryGeneration
    summaryState.value = 'loading'
    summaryMessage.value = ''
    try {
      const next = await options.api.summary()
      if (generation !== summaryGeneration || clearing.value) return
      summary.value = next
      summaryState.value = 'idle'
    } catch (error) {
      if (generation !== summaryGeneration || clearing.value) return
      summaryState.value = 'error'
      summaryMessage.value = errorMessage(error)
    }
  }

  async function refreshWebsites(): Promise<void> {
    if (clearing.value) return
    const generation = ++websiteGeneration
    websiteState.value = 'loading'
    websiteMessage.value = ''
    try {
      const next = await options.api.websites()
      if (generation !== websiteGeneration || clearing.value) return
      websites.value = next
      websiteState.value = 'idle'
    } catch (error) {
      if (generation !== websiteGeneration || clearing.value) return
      websiteState.value = 'error'
      websiteMessage.value = errorMessage(error)
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshSummary(), refreshWebsites()])
  }

  function selectedLabels(siteScoped: boolean): string[] {
    const selected: string[] = []
    if (clearOptions.value.history) selected.push(options.translate(siteScoped ? 'privacyActions.historySite' : 'privacyActions.historyAll'))
    if (clearOptions.value.cookiesAndSiteData) selected.push(options.translate(siteScoped ? 'privacyActions.cookiesSite' : 'privacyActions.cookiesAll'))
    if (clearOptions.value.cache) selected.push(options.translate('privacyActions.cache'))
    return selected
  }

  async function clearSelected(): Promise<void> {
    if (clearing.value) return
    const selected = selectedLabels(false)
    if (!selected.length) return
    const confirmed = options.confirm(options.translate('runtimeActions.browsingData.confirm', {
      items: selected.map((item) => options.translate('runtimeActions.browsingData.item', { item })).join('\n')
    }))
    if (!confirmed) return
    const summaryOperation = ++summaryGeneration
    const websiteOperation = ++websiteGeneration
    summaryState.value = 'clearing'
    summaryMessage.value = ''
    websiteState.value = 'idle'
    websiteMessage.value = ''
    try {
      const nextSummary = await options.api.clear({ ...clearOptions.value })
      const nextWebsites = await options.api.websites()
      if (summaryOperation !== summaryGeneration || websiteOperation !== websiteGeneration) return
      summary.value = nextSummary
      websites.value = nextWebsites
      summaryState.value = 'cleared'
      summaryMessage.value = options.translate('runtime.browsingData.cleared', {}, selected.length)
    } catch (error) {
      if (summaryOperation !== summaryGeneration || websiteOperation !== websiteGeneration) return
      summaryState.value = 'error'
      summaryMessage.value = errorMessage(error)
    }
  }

  async function clearWebsite(site: BrowsingDataWebsiteSummary): Promise<void> {
    if (clearing.value) return
    const selected = selectedLabels(true)
    if (!selected.length) return
    const confirmed = options.confirm(options.translate('privacyActions.clearSiteConfirm', {
      origin: site.origin,
      items: selected.map((item) => options.translate('runtimeActions.browsingData.item', { item })).join('\n')
    }))
    if (!confirmed) return
    const summaryOperation = ++summaryGeneration
    const websiteOperation = ++websiteGeneration
    websiteState.value = 'clearing'
    clearingOrigin.value = site.origin
    websiteMessage.value = ''
    summaryState.value = 'idle'
    summaryMessage.value = ''
    try {
      const nextSummary = await options.api.clear({ ...clearOptions.value, origin: site.origin })
      const nextWebsites = await options.api.websites()
      if (summaryOperation !== summaryGeneration || websiteOperation !== websiteGeneration) return
      summary.value = nextSummary
      websites.value = nextWebsites
      websiteState.value = 'cleared'
      websiteMessage.value = options.translate('privacyActions.clearedSite', { origin: site.origin })
    } catch (error) {
      if (summaryOperation !== summaryGeneration || websiteOperation !== websiteGeneration) return
      websiteState.value = 'error'
      websiteMessage.value = errorMessage(error)
    } finally {
      if (summaryOperation === summaryGeneration && websiteOperation === websiteGeneration) clearingOrigin.value = null
    }
  }

  function websiteMeta(site: BrowsingDataWebsiteSummary): string[] {
    const items: string[] = []
    if (site.cookieCount) items.push(options.translate('runtimeActions.browsingData.cookieMeta', { count: options.formatNumber(site.cookieCount) }, site.cookieCount))
    if (site.historyEntries) items.push(options.translate('privacyActions.historyWithVisits', { pages: options.formatNumber(site.historyEntries), visits: options.formatNumber(site.historyVisits) }, site.historyEntries))
    if (site.openTabCount) items.push(options.translate('privacyActions.openTabs', { count: options.formatNumber(site.openTabCount) }, site.openTabCount))
    if (site.bookmarkCount) items.push(options.translate('privacyActions.bookmarksKept', { count: options.formatNumber(site.bookmarkCount) }, site.bookmarkCount))
    if (site.savedPasswordCount) items.push(options.translate('privacyActions.accountsKept', { count: options.formatNumber(site.savedPasswordCount) }, site.savedPasswordCount))
    if (site.permissionDecisionCount) items.push(options.translate('privacyActions.decisionsKept', { count: options.formatNumber(site.permissionDecisionCount) }, site.permissionDecisionCount))
    return items
  }

  function resetSelection(): void {
    if (clearing.value) return
    clearOptions.value = { ...DEFAULT_CLEAR_OPTIONS }
    summaryMessage.value = ''
    summaryState.value = 'idle'
  }

  function dispose(): void {
    summaryGeneration += 1
    websiteGeneration += 1
  }

  return {
    summary,
    clearOptions,
    summaryState,
    summaryMessage,
    websites,
    search,
    websiteState,
    clearingOrigin,
    websiteMessage,
    selectedCount,
    clearing,
    canClear,
    filteredWebsites,
    refreshSummary,
    refreshWebsites,
    refresh,
    clearSelected,
    clearWebsite,
    websiteMeta,
    resetSelection,
    dispose
  }
}

export type PrivacySettingsController = ReturnType<typeof usePrivacySettingsController>
