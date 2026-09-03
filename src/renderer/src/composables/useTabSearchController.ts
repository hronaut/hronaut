import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import type {
  BrowserClosedTabState,
  BrowserTabOverviewPreview,
  BrowserSavedTabGroupState,
  BrowserState,
  BrowserTabGroupColor,
  BrowserTabState,
  HronautApi,
  McpTabActivity
} from '../../../shared/types.js'

type TabSearchBrowserApi = Pick<
  HronautApi,
  'closeTab' | 'reopenClosedTab' | 'setTabPinned' | 'restoreSavedTabGroup' | 'deleteSavedTabGroup' | 'getTabOverviewPreviews'
>

type Translate = (
  key: string,
  parameters?: Record<string, string | number>,
  plural?: number
) => string

export type TabSearchResult =
  | { kind: 'open'; tab: BrowserTabState }
  | { kind: 'closed'; tab: BrowserClosedTabState }
  | { kind: 'saved'; tab: BrowserSavedTabGroupState }

export interface TabSearchWorkspaceGroup {
  id: string
  name: string
  color: BrowserTabGroupColor
  tabs: BrowserTabState[]
}

export interface TabSearchControllerOptions {
  state: Readonly<Ref<BrowserState>>
  open: Ref<boolean>
  mcpActivityByTab: Readonly<Ref<Record<string, McpTabActivity>>>
  browser: TabSearchBrowserApi
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  selectTab: (tabId: string) => Promise<unknown>
  expandTabGroup: (tab: BrowserTabState) => void
  translate: Translate
  formatNumber: (value: number) => string
  formatTime: (value: Date | number | string) => string
  describeEmulation: (tab: BrowserTabState) => string
  confirm: (message: string) => boolean
  formatError: (cause: unknown, fallback: string) => string
  showError: (title: string, message: string) => void
}

function resultKey(result: TabSearchResult): string {
  return `${result.kind}:${result.tab.id}`
}

export function useTabSearchController(options: TabSearchControllerOptions) {
  const input = ref<HTMLInputElement | null>(null)
  const query = ref('')
  const selection = ref(0)
  const actionPending = ref(false)
  const previewLoading = ref(false)
  const previewsByTab = ref<Record<string, BrowserTabOverviewPreview>>({})
  let presentationGeneration = 0
  let previewRequestGeneration = 0
  let actionToken: symbol | null = null

  const regularTabs = computed(() => options.state.value.tabs.filter((tab) => !tab.url.startsWith('hronaut://home')))
  const filteredTabs = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    if (!normalized) return regularTabs.value
    return regularTabs.value.filter((tab) => (
      (tab.title || options.translate('tabSearch.newTabTitle')).toLocaleLowerCase().includes(normalized)
      || tab.url.toLocaleLowerCase().includes(normalized)
      || tab.mcpGroupName?.toLocaleLowerCase().includes(normalized)
    ))
  })
  const filteredClosedTabs = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    if (!normalized) return options.state.value.closedTabs
    return options.state.value.closedTabs.filter((tab) => (
      tab.title.toLocaleLowerCase().includes(normalized) || tab.url.toLocaleLowerCase().includes(normalized)
    ))
  })
  const filteredSavedTabGroups = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    if (!normalized) return options.state.value.savedTabGroups
    return options.state.value.savedTabGroups.filter((group) => (
      group.name.toLocaleLowerCase().includes(normalized)
      || group.tabs.some((tab) => tab.title.toLocaleLowerCase().includes(normalized) || tab.url.toLocaleLowerCase().includes(normalized))
    ))
  })
  const filteredWorkspaceGroups = computed<TabSearchWorkspaceGroup[]>(() => {
    const matchedTabs = new Map(filteredTabs.value.map((tab) => [tab.id, tab]))
    const knownWorkspaceIds = new Set(options.state.value.mcpTabGroups.map((group) => group.id))
    const groups = options.state.value.mcpTabGroups.flatMap((group): TabSearchWorkspaceGroup[] => {
      const tabs = options.state.value.tabs.filter((tab) => (
        tab.mcpGroupId === group.id && matchedTabs.has(tab.id) && !tab.url.startsWith('hronaut://home')
      ))
      return tabs.length ? [{ id: group.id, name: group.name, color: group.color, tabs }] : []
    })
    const ungroupedTabs = filteredTabs.value.filter((tab) => (
      !tab.mcpGroupId || !knownWorkspaceIds.has(tab.mcpGroupId)
    ))
    if (ungroupedTabs.length) {
      groups.push({
        id: 'ungrouped',
        name: options.translate('tabSearch.ungrouped'),
        color: 'gray',
        tabs: ungroupedTabs
      })
    }
    return groups
  })
  const results = computed<TabSearchResult[]>(() => [
    ...filteredWorkspaceGroups.value.flatMap((group) => group.tabs).map((tab): TabSearchResult => ({ kind: 'open', tab })),
    ...filteredSavedTabGroups.value.map((tab): TabSearchResult => ({ kind: 'saved', tab })),
    ...filteredClosedTabs.value.map((tab): TabSearchResult => ({ kind: 'closed', tab }))
  ])
  const resultKeys = computed(() => results.value.map(resultKey))
  const selectedResult = computed(() => results.value[selection.value])

  function resultId(result: TabSearchResult): string {
    return `tab-search-${result.kind}-${result.tab.id}`
  }

  function resultLabel(result: TabSearchResult): string {
    return result.kind === 'saved'
      ? result.tab.name
      : result.tab.title || options.translate('tabSearch.newTabTitle')
  }

  function resultIndex(kind: TabSearchResult['kind'], id: string): number {
    return results.value.findIndex((result) => result.kind === kind && result.tab.id === id)
  }

  function previewForTab(tab: BrowserTabState): BrowserTabOverviewPreview | undefined {
    const preview = previewsByTab.value[tab.id]
    if (!preview || tab.sleeping) return undefined
    if (preview.navigationGeneration !== tab.navigationGeneration) return undefined
    return preview
  }

  function clearPreviews(): void {
    previewRequestGeneration += 1
    previewLoading.value = false
    previewsByTab.value = {}
  }

  async function loadPreviews(presentation = presentationGeneration): Promise<void> {
    const tabs = regularTabs.value.filter((tab) => !tab.sleeping)
    const request = ++previewRequestGeneration
    if (!tabs.length) {
      previewsByTab.value = {}
      previewLoading.value = false
      return
    }
    previewLoading.value = true
    try {
      const previews = await options.browser.getTabOverviewPreviews(tabs.map((tab) => tab.id))
      if (
        request !== previewRequestGeneration
        || !options.open.value
        || !isPresentationCurrent(presentation)
      ) return
      const currentTabs = new Map(regularTabs.value.map((tab) => [tab.id, tab]))
      const current: Record<string, BrowserTabOverviewPreview> = {}
      for (const preview of previews) {
        const tab = currentTabs.get(preview.tabId)
        if (!tab || tab.sleeping) continue
        if (preview.navigationGeneration !== tab.navigationGeneration) continue
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(preview.dataUrl)) continue
        if (!Number.isInteger(preview.width) || preview.width < 1 || !Number.isInteger(preview.height) || preview.height < 1) continue
        current[preview.tabId] = preview
      }
      previewsByTab.value = current
    } catch {
      // Previews are optional presentation data. Keep the overview usable with
      // deterministic placeholders when capture is unavailable.
      if (request === previewRequestGeneration && isPresentationCurrent(presentation)) previewsByTab.value = {}
    } finally {
      if (request === previewRequestGeneration) previewLoading.value = false
    }
  }

  function revealSelectedResult(): void {
    const result = selectedResult.value
    if (!result) return
    document.getElementById(resultId(result))?.scrollIntoView?.({ block: 'nearest' })
  }

  function beginPresentation(): number {
    presentationGeneration += 1
    return presentationGeneration
  }

  function isPresentationCurrent(generation: number): boolean {
    return generation === presentationGeneration
  }

  function beginAction(): { token: symbol; presentation: number } | null {
    if (actionToken) return null
    const token = Symbol('tab-search-action')
    actionToken = token
    actionPending.value = true
    return { token, presentation: presentationGeneration }
  }

  function finishAction(token: symbol): void {
    if (actionToken !== token) return
    actionToken = null
    actionPending.value = false
  }

  function showOpenError(cause: unknown): void {
    options.showError(
      options.translate('runtime.workspace.openFailed'),
      options.formatError(cause, options.translate('runtime.workspace.openDescription'))
    )
  }

  function showActionError(cause: unknown): void {
    options.showError(
      options.translate('runtimeDetails.browserAction'),
      options.formatError(cause, options.translate('runtime.toast.actionFailed'))
    )
  }

  async function focusAndReveal(presentation = presentationGeneration): Promise<void> {
    await nextTick()
    if (!options.open.value || !isPresentationCurrent(presentation)) return
    input.value?.focus()
    revealSelectedResult()
  }

  async function openPanel(): Promise<void> {
    const presentation = beginPresentation()
    query.value = ''
    const activeIndex = results.value.findIndex((result) => result.kind === 'open' && result.tab.active)
    selection.value = Math.max(0, activeIndex)
    options.open.value = true
    void loadPreviews(presentation)
    await focusAndReveal(presentation)
    if (!options.open.value || !isPresentationCurrent(presentation)) return
    input.value?.select()
  }

  function close(): void {
    beginPresentation()
    clearPreviews()
    options.open.value = false
  }

  async function moveSelection(offset: -1 | 1): Promise<void> {
    if (!results.value.length) return
    selection.value = (selection.value + offset + results.value.length) % results.value.length
    await nextTick()
    revealSelectedResult()
  }

  async function selectOpenTab(tab: BrowserTabState): Promise<void> {
    close()
    const presentation = presentationGeneration
    options.expandTabGroup(tab)
    try {
      await options.selectTab(tab.id)
    } catch (cause) {
      if (isPresentationCurrent(presentation)) showOpenError(cause)
    }
  }

  async function restoreClosedTab(tab: BrowserClosedTabState): Promise<void> {
    close()
    const presentation = presentationGeneration
    try {
      await options.syncState(options.browser.reopenClosedTab(tab.id))
    } catch (cause) {
      if (isPresentationCurrent(presentation)) showOpenError(cause)
    }
  }

  async function restoreSavedGroup(group: BrowserSavedTabGroupState): Promise<void> {
    const action = beginAction()
    if (!action) return
    try {
      await options.syncState(options.browser.restoreSavedTabGroup(group.id))
      if (isPresentationCurrent(action.presentation)) close()
    } catch (cause) {
      if (isPresentationCurrent(action.presentation)) options.showError(
        options.translate('runtime.workspace.restoreFailed'),
        options.formatError(cause, options.translate('runtime.workspace.restoreDescription'))
      )
    } finally {
      finishAction(action.token)
    }
  }

  async function runSelectedResult(): Promise<void> {
    const result = selectedResult.value
    if (!result) return
    if (result.kind === 'open') await selectOpenTab(result.tab)
    else if (result.kind === 'closed') await restoreClosedTab(result.tab)
    else await restoreSavedGroup(result.tab)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isImeCompositionEvent(event)) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      void moveSelection(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      void moveSelection(-1)
      return
    }
    if (event.key === 'Enter' && selectedResult.value) {
      event.preventDefault()
      void runSelectedResult()
    }
  }

  async function closeOpenTab(event: MouseEvent, tabId: string): Promise<void> {
    event.stopPropagation()
    if (options.state.value.allHumanInteractionLocked) return
    const action = beginAction()
    if (!action) return
    try {
      await options.syncState(options.browser.closeTab(tabId))
      await focusAndReveal(action.presentation)
    } catch (cause) {
      if (isPresentationCurrent(action.presentation)) showActionError(cause)
    } finally {
      finishAction(action.token)
    }
  }

  async function togglePinnedTab(event: MouseEvent, tab: BrowserTabState): Promise<void> {
    event.stopPropagation()
    const action = beginAction()
    if (!action) return
    try {
      await options.syncState(options.browser.setTabPinned(tab.id, !tab.pinned))
      await focusAndReveal(action.presentation)
    } catch (cause) {
      if (isPresentationCurrent(action.presentation)) showActionError(cause)
    } finally {
      finishAction(action.token)
    }
  }

  async function deleteSavedGroup(event: MouseEvent, group: BrowserSavedTabGroupState): Promise<void> {
    event.stopPropagation()
    if (!options.confirm(options.translate(
      'runtimeActions.workspace.deleteConfirm',
      { name: group.name, count: options.formatNumber(group.tabs.length) },
      group.tabs.length
    ))) return
    const action = beginAction()
    if (!action) return
    try {
      await options.syncState(options.browser.deleteSavedTabGroup(group.id))
      await focusAndReveal(action.presentation)
    } catch (cause) {
      if (isPresentationCurrent(action.presentation)) options.showError(
        options.translate('runtime.workspace.deleteFailed'),
        options.formatError(cause, options.translate('runtime.workspace.deleteDescription'))
      )
    } finally {
      finishAction(action.token)
    }
  }

  function tabMeta(tab: BrowserTabState): string {
    const status: string[] = []
    if (tab.mcpGroupName) status.push(options.translate('tabSearch.meta.group', { name: tab.mcpGroupName }))
    if (tab.pinned) status.push(options.translate('tabSearch.meta.pinned'))
    if (tab.active) status.push(options.translate('tabSearch.meta.current'))
    if (options.state.value.allHumanInteractionLocked || tab.humanInteractionLocked) status.push(options.translate('tabSearch.meta.locked'))
    if (tab.muted) status.push(options.translate('tabSearch.meta.muted'))
    else if (tab.audible) status.push(options.translate('tabSearch.meta.audio'))
    if (options.mcpActivityByTab.value[tab.id]) status.push(options.translate('tabSearch.meta.agent'))
    if (tab.emulation) status.push(options.translate('tabSearch.meta.emulated', { state: options.describeEmulation(tab) }))
    if (tab.networkRouteCount) {
      status.push(options.translate(
        'tabSearch.meta.routes',
        { count: options.formatNumber(tab.networkRouteCount) },
        tab.networkRouteCount
      ))
    }
    return status.join(' · ')
  }

  function closedTabMeta(tab: BrowserClosedTabState): string {
    const elapsed = Math.max(0, Date.now() - Date.parse(tab.closedAt))
    let closed: string
    if (elapsed < 60_000) closed = options.translate('tabSearch.meta.justNow')
    else if (elapsed < 60 * 60_000) {
      const minutes = Math.max(1, Math.floor(elapsed / 60_000))
      closed = options.translate('tabSearch.meta.minutesAgo', { count: options.formatNumber(minutes) })
    } else {
      closed = options.translate('tabSearch.meta.closedAt', { time: options.formatTime(tab.closedAt) })
    }
    return tab.pinned ? `${options.translate('tabSearch.meta.pinned')} · ${closed}` : closed
  }

  const stopResultTracking = watch(
    [query, resultKeys],
    ([nextQuery, nextKeys], [previousQuery, previousKeys]) => {
      if (nextQuery !== previousQuery) {
        selection.value = 0
      } else {
        const previousKey = previousKeys[selection.value]
        const preservedIndex = previousKey ? nextKeys.indexOf(previousKey) : -1
        selection.value = preservedIndex >= 0
          ? preservedIndex
          : Math.min(selection.value, Math.max(0, nextKeys.length - 1))
      }
      void nextTick().then(revealSelectedResult)
    },
    { flush: 'sync' }
  )
  const stopOpenTracking = watch(options.open, (nextOpen, previousOpen) => {
    if (previousOpen && !nextOpen) {
      beginPresentation()
      clearPreviews()
    }
  }, { flush: 'sync' })
  const previewIdentity = computed(() => regularTabs.value.map((tab) => (
    `${tab.id}:${tab.navigationGeneration}:${tab.sleeping ? 'sleeping' : 'awake'}`
  )).join('|'))
  const stopPreviewIdentityTracking = watch(previewIdentity, () => {
    if (options.open.value) void loadPreviews()
  }, { flush: 'post' })

  if (options.open.value) {
    const activeIndex = results.value.findIndex((result) => result.kind === 'open' && result.tab.active)
    selection.value = Math.max(0, activeIndex)
    void loadPreviews()
  }

  function dispose(): void {
    beginPresentation()
    clearPreviews()
    actionToken = null
    actionPending.value = false
    stopResultTracking()
    stopOpenTracking()
    stopPreviewIdentityTracking()
  }

  return {
    input,
    query,
    selection,
    actionPending,
    previewLoading,
    previewsByTab,
    regularTabs,
    filteredTabs,
    filteredWorkspaceGroups,
    filteredClosedTabs,
    filteredSavedTabGroups,
    results,
    selectedResult,
    resultId,
    resultLabel,
    resultIndex,
    previewForTab,
    openPanel,
    close,
    moveSelection,
    handleKeydown,
    selectOpenTab,
    restoreClosedTab,
    restoreSavedGroup,
    closeOpenTab,
    togglePinnedTab,
    deleteSavedGroup,
    tabMeta,
    closedTabMeta,
    dispose
  }
}
