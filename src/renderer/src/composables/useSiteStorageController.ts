import { computed, ref, type Ref } from 'vue'
import type {
  BrowserIndexedDbReport,
  BrowserPwaReport,
  BrowserStorageChange,
  BrowserStorageChangesAction,
  BrowserStorageChangesReport,
  BrowserStorageItem,
  BrowserStorageKind,
  BrowserStorageResult,
  BrowserStorageUsageReport,
  BrowserTabState,
  HronautApi,
  SupportedLocale
} from '../../../shared/types.js'

type SiteStorageBrowserApi = Pick<
  HronautApi,
  'manageStorage' | 'inspectStorageUsage' | 'inspectIndexedDb' | 'inspectPwa' | 'storageChanges'
>

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface SiteStorageControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  open: Ref<boolean>
  locale: Readonly<Ref<SupportedLocale>>
  browser: SiteStorageBrowserApi
  translate: Translate
  copyText: (text: string) => Promise<boolean>
  confirm: (message: string) => boolean
  keepsSeparatePanelOpen: () => boolean
}

export function useSiteStorageController(options: SiteStorageControllerOptions) {
  const kind = ref<BrowserStorageKind>('local-storage')
  const result = ref<BrowserStorageResult | null>(null)
  const state = ref<'idle' | 'loading' | 'saving' | 'error'>('idle')
  const error = ref('')
  const search = ref('')
  const key = ref('')
  const value = ref('')
  const changesOpen = ref(false)
  const changesReport = ref<BrowserStorageChangesReport | null>(null)
  const changesState = ref<'idle' | 'loading' | 'error'>('idle')
  const changesError = ref('')
  const changesCopied = ref(false)
  const usageOpen = ref(false)
  const usageReport = ref<BrowserStorageUsageReport | null>(null)
  const usageState = ref<'idle' | 'loading' | 'error'>('idle')
  const usageError = ref('')
  const usageCopied = ref(false)
  const indexedDbOpen = ref(false)
  const indexedDbReport = ref<BrowserIndexedDbReport | null>(null)
  const indexedDbState = ref<'idle' | 'loading' | 'error'>('idle')
  const indexedDbError = ref('')
  const indexedDbDatabase = ref('')
  const indexedDbStore = ref('')
  const indexedDbOffset = ref(0)
  const indexedDbSearch = ref('')
  const indexedDbCopied = ref(false)
  const pwaOpen = ref(false)
  const pwaReport = ref<BrowserPwaReport | null>(null)
  const pwaState = ref<'idle' | 'loading' | 'error'>('idle')
  const pwaError = ref('')
  const pwaCache = ref('')
  const pwaQuery = ref('')
  const pwaOffset = ref(0)
  const pwaCopied = ref(false)

  let generation = 0
  let listSequence = 0
  let changesSequence = 0
  let usageSequence = 0
  let indexedDbSequence = 0
  let pwaSequence = 0
  const feedbackTimers = new Set<number>()

  const activeWebUrl = computed(() => {
    try {
      const url = new URL(options.activeTab.value?.url ?? '')
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
    } catch {
      return null
    }
  })

  const activeHostname = computed(() => {
    try {
      return new URL(activeWebUrl.value ?? '').hostname
    } catch {
      return ''
    }
  })

  const filteredItems = computed(() => {
    const query = search.value.trim().toLocaleLowerCase()
    const items = result.value?.items ?? []
    if (!query) return items
    return items.filter((item) => (
      item.key.toLocaleLowerCase().includes(query)
      || item.value?.toLocaleLowerCase().includes(query)
      || item.domain?.toLocaleLowerCase().includes(query)
    ))
  })

  const kindLabel = computed(() => options.translate({
    'local-storage': 'runtime.storage.local',
    'session-storage': 'runtime.storage.session',
    cookies: 'runtime.storage.cookies'
  }[kind.value]))

  const filteredIndexedDbEntries = computed(() => {
    const query = indexedDbSearch.value.trim().toLocaleLowerCase()
    const entries = indexedDbReport.value?.entries ?? []
    if (!query) return entries
    return entries.filter((entry) => (
      entry.key.toLocaleLowerCase().includes(query)
      || entry.primaryKey.toLocaleLowerCase().includes(query)
      || entry.valueType.toLocaleLowerCase().includes(query)
      || entry.valuePreview?.toLocaleLowerCase().includes(query)
    ))
  })

  function isCurrent(tabId: string, expectedGeneration: number): boolean {
    return generation === expectedGeneration && options.activeTab.value?.id === tabId
  }

  function scheduleFeedbackReset(target: Ref<boolean>): void {
    const timer = window.setTimeout(() => {
      feedbackTimers.delete(timer)
      target.value = false
    }, 1_500)
    feedbackTimers.add(timer)
  }

  function invalidateRequests(): void {
    generation += 1
    listSequence += 1
    changesSequence += 1
    usageSequence += 1
    indexedDbSequence += 1
    pwaSequence += 1
  }

  function reset(closePanel = false): void {
    invalidateRequests()
    if (closePanel && !options.keepsSeparatePanelOpen()) options.open.value = false
    result.value = null
    state.value = 'idle'
    error.value = ''
    search.value = ''
    key.value = ''
    value.value = ''
    changesOpen.value = false
    changesReport.value = null
    changesState.value = 'idle'
    changesError.value = ''
    changesCopied.value = false
    usageOpen.value = false
    usageReport.value = null
    usageState.value = 'idle'
    usageError.value = ''
    usageCopied.value = false
    indexedDbOpen.value = false
    indexedDbReport.value = null
    indexedDbState.value = 'idle'
    indexedDbError.value = ''
    indexedDbDatabase.value = ''
    indexedDbStore.value = ''
    indexedDbOffset.value = 0
    indexedDbSearch.value = ''
    indexedDbCopied.value = false
    pwaOpen.value = false
    pwaReport.value = null
    pwaState.value = 'idle'
    pwaError.value = ''
    pwaCache.value = ''
    pwaQuery.value = ''
    pwaOffset.value = 0
    pwaCopied.value = false
  }

  async function refresh(): Promise<void> {
    if (state.value === 'saving') return
    const tab = options.activeTab.value
    if (!tab || !activeWebUrl.value) return
    const expectedGeneration = generation
    const sequence = ++listSequence
    state.value = 'loading'
    error.value = ''
    try {
      const next = await options.browser.manageStorage({
        tabId: tab.id,
        kind: kind.value,
        action: 'list',
        includeValues: true
      })
      if (sequence !== listSequence || !isCurrent(tab.id, expectedGeneration)) return
      result.value = next
      state.value = 'idle'
    } catch (cause) {
      if (sequence !== listSequence || !isCurrent(tab.id, expectedGeneration)) return
      result.value = null
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function manageChanges(action: BrowserStorageChangesAction): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || !activeWebUrl.value) return
    const expectedGeneration = generation
    const sequence = ++changesSequence
    changesState.value = 'loading'
    changesError.value = ''
    changesCopied.value = false
    try {
      const report = await options.browser.storageChanges({ tabId: tab.id, action })
      if (sequence !== changesSequence || !isCurrent(tab.id, expectedGeneration)) return
      changesReport.value = report
      changesState.value = 'idle'
    } catch (cause) {
      if (sequence !== changesSequence || !isCurrent(tab.id, expectedGeneration)) return
      changesState.value = 'error'
      changesError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function selectChanges(): Promise<void> {
    usageOpen.value = false
    indexedDbOpen.value = false
    pwaOpen.value = false
    changesOpen.value = true
    error.value = ''
    key.value = ''
    value.value = ''
    await manageChanges('get')
  }

  function inspectChange(change: BrowserStorageChange): void {
    usageOpen.value = false
    changesOpen.value = false
    indexedDbOpen.value = false
    pwaOpen.value = false
    kind.value = change.kind
    search.value = change.key
    void refresh()
  }

  async function loadUsage(): Promise<BrowserStorageUsageReport | null> {
    const tab = options.activeTab.value
    if (!tab || !activeWebUrl.value) return null
    const expectedGeneration = generation
    const sequence = ++usageSequence
    usageState.value = 'loading'
    usageError.value = ''
    usageCopied.value = false
    try {
      const report = await options.browser.inspectStorageUsage(tab.id)
      if (sequence !== usageSequence || !isCurrent(tab.id, expectedGeneration)) return null
      usageReport.value = report
      usageState.value = 'idle'
      return report
    } catch (cause) {
      if (sequence !== usageSequence || !isCurrent(tab.id, expectedGeneration)) return null
      usageReport.value = null
      usageState.value = 'error'
      usageError.value = cause instanceof Error ? cause.message : String(cause)
      return null
    }
  }

  async function selectUsage(): Promise<void> {
    changesOpen.value = false
    indexedDbOpen.value = false
    pwaOpen.value = false
    usageOpen.value = true
    await loadUsage()
  }

  async function copyUsage(): Promise<void> {
    if (!usageReport.value || !await options.copyText(JSON.stringify(usageReport.value, null, 2))) return
    usageCopied.value = true
    scheduleFeedbackReset(usageCopied)
  }

  async function copyChanges(): Promise<void> {
    if (changesReport.value?.status !== 'compared' || !await options.copyText(JSON.stringify(changesReport.value, null, 2))) return
    changesCopied.value = true
    scheduleFeedbackReset(changesCopied)
  }

  async function loadIndexedDb(
    database = indexedDbDatabase.value || undefined,
    objectStore = indexedDbStore.value || undefined,
    offset = indexedDbOffset.value
  ): Promise<BrowserIndexedDbReport | null> {
    const tab = options.activeTab.value
    if (!tab || !activeWebUrl.value) return null
    const expectedGeneration = generation
    const sequence = ++indexedDbSequence
    indexedDbState.value = 'loading'
    indexedDbError.value = ''
    indexedDbCopied.value = false
    try {
      const report = await options.browser.inspectIndexedDb({
        tabId: tab.id,
        database,
        objectStore,
        offset,
        limit: 50,
        includeValues: true
      })
      if (sequence !== indexedDbSequence || !isCurrent(tab.id, expectedGeneration)) return null
      indexedDbReport.value = report
      indexedDbOffset.value = report.offset
      indexedDbState.value = 'idle'
      return report
    } catch (cause) {
      if (sequence !== indexedDbSequence || !isCurrent(tab.id, expectedGeneration)) return null
      indexedDbReport.value = null
      indexedDbState.value = 'error'
      indexedDbError.value = cause instanceof Error ? cause.message : String(cause)
      return null
    }
  }

  async function selectIndexedDb(): Promise<void> {
    usageOpen.value = false
    changesOpen.value = false
    pwaOpen.value = false
    indexedDbOpen.value = true
    error.value = ''
    indexedDbDatabase.value = ''
    indexedDbStore.value = ''
    indexedDbOffset.value = 0
    indexedDbSearch.value = ''
    const databases = await loadIndexedDb(undefined, undefined, 0)
    const firstDatabase = databases?.databases[0]?.name
    if (!firstDatabase) return
    indexedDbDatabase.value = firstDatabase
    const schema = await loadIndexedDb(firstDatabase, undefined, 0)
    const firstStore = schema?.selectedDatabase?.objectStores?.[0]?.name
    if (!firstStore) return
    indexedDbStore.value = firstStore
    await loadIndexedDb(firstDatabase, firstStore, 0)
  }

  async function selectIndexedDbDatabase(): Promise<void> {
    indexedDbStore.value = ''
    indexedDbOffset.value = 0
    indexedDbSearch.value = ''
    if (!indexedDbDatabase.value) {
      await loadIndexedDb(undefined, undefined, 0)
      return
    }
    const report = await loadIndexedDb(indexedDbDatabase.value, undefined, 0)
    const firstStore = report?.selectedDatabase?.objectStores?.[0]?.name
    if (!firstStore) return
    indexedDbStore.value = firstStore
    await loadIndexedDb(indexedDbDatabase.value, firstStore, 0)
  }

  async function selectIndexedDbStore(): Promise<void> {
    indexedDbOffset.value = 0
    indexedDbSearch.value = ''
    await loadIndexedDb()
  }

  async function moveIndexedDbPage(direction: -1 | 1): Promise<void> {
    await loadIndexedDb(undefined, undefined, Math.max(0, indexedDbOffset.value + direction * 50))
  }

  async function copyIndexedDb(): Promise<void> {
    const report = indexedDbReport.value
    if (!report || !await options.copyText(JSON.stringify({ ...report, entries: filteredIndexedDbEntries.value }, null, 2))) return
    indexedDbCopied.value = true
    scheduleFeedbackReset(indexedDbCopied)
  }

  async function loadPwa(
    cacheName = pwaCache.value || undefined,
    offset = pwaOffset.value
  ): Promise<BrowserPwaReport | null> {
    const tab = options.activeTab.value
    if (!tab || !activeWebUrl.value) return null
    const expectedGeneration = generation
    const sequence = ++pwaSequence
    pwaState.value = 'loading'
    pwaError.value = ''
    pwaCopied.value = false
    try {
      const report = await options.browser.inspectPwa({
        tabId: tab.id,
        cacheName,
        query: pwaQuery.value,
        offset,
        limit: 50
      })
      if (sequence !== pwaSequence || !isCurrent(tab.id, expectedGeneration)) return null
      pwaReport.value = report
      pwaOffset.value = report.selectedCache?.offset ?? 0
      pwaState.value = 'idle'
      return report
    } catch (cause) {
      if (sequence !== pwaSequence || !isCurrent(tab.id, expectedGeneration)) return null
      pwaReport.value = null
      pwaState.value = 'error'
      pwaError.value = cause instanceof Error ? cause.message : String(cause)
      return null
    }
  }

  async function selectPwa(): Promise<void> {
    usageOpen.value = false
    changesOpen.value = false
    indexedDbOpen.value = false
    pwaOpen.value = true
    pwaCache.value = ''
    pwaQuery.value = ''
    pwaOffset.value = 0
    const report = await loadPwa(undefined, 0)
    const firstCache = report?.caches[0]?.name
    if (!firstCache || !report.cacheInspectionAvailable) return
    pwaCache.value = firstCache
    await loadPwa(firstCache, 0)
  }

  async function selectPwaCache(): Promise<void> {
    pwaOffset.value = 0
    await loadPwa(undefined, 0)
  }

  async function filterPwa(): Promise<void> {
    pwaOffset.value = 0
    await loadPwa(undefined, 0)
  }

  async function movePwaPage(direction: -1 | 1): Promise<void> {
    await loadPwa(undefined, Math.max(0, pwaOffset.value + direction * 50))
  }

  async function copyPwa(): Promise<void> {
    if (!pwaReport.value || !await options.copyText(JSON.stringify(pwaReport.value, null, 2))) return
    pwaCopied.value = true
    scheduleFeedbackReset(pwaCopied)
  }

  async function refreshActiveView(): Promise<void> {
    if (usageOpen.value) await loadUsage()
    else if (pwaOpen.value) await loadPwa()
    else if (indexedDbOpen.value) await loadIndexedDb()
    else if (changesOpen.value) await manageChanges('get')
    else await refresh()
  }

  async function selectKind(nextKind: BrowserStorageKind): Promise<void> {
    if (state.value === 'saving') return
    usageOpen.value = false
    changesOpen.value = false
    indexedDbOpen.value = false
    pwaOpen.value = false
    changesError.value = ''
    kind.value = nextKind
    key.value = ''
    value.value = ''
    await refresh()
  }

  function editItem(item: BrowserStorageItem): void {
    if (item.protected || state.value === 'saving') return
    key.value = item.key
    value.value = item.value ?? ''
  }

  async function mutateItem(action: 'set' | 'delete' | 'clear', item?: BrowserStorageItem): Promise<void> {
    const tab = options.activeTab.value
    if (
      !tab
      || state.value === 'saving'
      || (action === 'set' && !key.value.trim())
      || (action === 'delete' && (!item || item.protected))
    ) return
    const expectedGeneration = generation
    const sequence = ++listSequence
    state.value = 'saving'
    error.value = ''
    try {
      const next = await options.browser.manageStorage({
        tabId: tab.id,
        kind: kind.value,
        action,
        ...(action === 'set' ? { key: key.value, value: value.value } : {}),
        ...(action === 'delete' ? { key: item!.key } : {}),
        includeValues: true
      })
      if (sequence !== listSequence || !isCurrent(tab.id, expectedGeneration)) return
      result.value = next
      if (action === 'set') {
        key.value = ''
        value.value = ''
      }
      state.value = 'idle'
    } catch (cause) {
      if (sequence !== listSequence || !isCurrent(tab.id, expectedGeneration)) return
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const saveItem = (): Promise<void> => mutateItem('set')
  const deleteItem = (item: BrowserStorageItem): Promise<void> => mutateItem('delete', item)

  async function clearKind(): Promise<void> {
    if (!options.activeTab.value || !result.value?.itemCount) return
    const protectedNote = kind.value === 'cookies' ? options.translate('runtimeDetails.httpOnlyNote') : ''
    const confirmed = options.confirm(options.translate('runtimeDetails.clearStorage', {
      kind: kindLabel.value.toLocaleLowerCase(options.locale.value),
      host: activeHostname.value,
      note: protectedNote
    }))
    if (confirmed) await mutateItem('clear')
  }

  function dispose(): void {
    invalidateRequests()
    for (const timer of feedbackTimers) window.clearTimeout(timer)
    feedbackTimers.clear()
  }

  return {
    kind,
    result,
    state,
    error,
    search,
    key,
    value,
    changesOpen,
    changesReport,
    changesState,
    changesError,
    changesCopied,
    usageOpen,
    usageReport,
    usageState,
    usageError,
    usageCopied,
    indexedDbOpen,
    indexedDbReport,
    indexedDbState,
    indexedDbError,
    indexedDbDatabase,
    indexedDbStore,
    indexedDbOffset,
    indexedDbSearch,
    indexedDbCopied,
    pwaOpen,
    pwaReport,
    pwaState,
    pwaError,
    pwaCache,
    pwaQuery,
    pwaOffset,
    pwaCopied,
    activeHostname,
    filteredItems,
    kindLabel,
    filteredIndexedDbEntries,
    reset,
    refresh,
    refreshActiveView,
    manageChanges,
    selectChanges,
    inspectChange,
    selectUsage,
    copyUsage,
    copyChanges,
    selectIndexedDb,
    selectIndexedDbDatabase,
    selectIndexedDbStore,
    moveIndexedDbPage,
    copyIndexedDb,
    selectPwa,
    selectPwaCache,
    filterPwa,
    movePwaPage,
    copyPwa,
    selectKind,
    editItem,
    saveItem,
    deleteItem,
    clearKind,
    dispose
  }
}
