import { computed, ref, watch, type Ref } from 'vue'
import type { BrowserHistoryEntry } from '../../../shared/types.js'
import { historyDateBounds, type HistoryDateRange } from './history-date-range.js'

type Translate = (
  key: string,
  parameters?: Record<string, string | number>,
  plural?: number
) => string

export interface HistoryPanelControllerOptions {
  open: Ref<boolean>
  entries: Ref<BrowserHistoryEntry[]>
  translate: Translate
  formatDateTime: (value: Date | number | string) => string
  formatNumber: (value: number) => string
  listHistory: () => Promise<BrowserHistoryEntry[]>
  removeHistoryEntry: (id: string) => Promise<BrowserHistoryEntry[]>
  clearHistory: () => Promise<BrowserHistoryEntry[]>
  openHistoryEntry: (entry: BrowserHistoryEntry) => Promise<void>
  openHistoryEntryInBackground: (entry: BrowserHistoryEntry) => Promise<void>
  saveHistoryBookmark: (url: string, title: string) => Promise<void>
  copyHistoryAddress: (entry: BrowserHistoryEntry) => Promise<void>
  confirmClear: () => boolean
}

export function useHistoryPanelController(options: HistoryPanelControllerOptions) {
  const query = ref('')
  const dateRange = ref<HistoryDateRange>('all')
  const origin = ref('')
  const now = ref(Date.now())
  const error = ref('')
  const copyFeedback = ref<'success' | 'error' | ''>('')
  const copyEntry = ref<{ id: string; url: string } | null>(null)
  let copyGeneration = 0
  const pendingAction = ref<string | null>(null)
  let actionGeneration = 0

  const filteredEntries = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    const bounds = historyDateBounds(dateRange.value, now.value)
    if (!normalized && !bounds && !origin.value) return options.entries.value
    return options.entries.value.filter((entry) => {
      const visited = Date.parse(entry.visitedAt)
      return (!origin.value || entryOrigin(entry) === origin.value)
        && (!bounds || (visited >= bounds[0] && visited < bounds[1]))
        && (!normalized || entry.title.toLocaleLowerCase().includes(normalized)
          || entry.url.toLocaleLowerCase().includes(normalized))
    })
  })

  function entryOrigin(entry: BrowserHistoryEntry): string {
    try {
      const url = new URL(entry.url)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''
    } catch { return '' }
  }

  function filterOrigin(entry: BrowserHistoryEntry): void {
    if (!options.open.value || pendingAction.value
      || !filteredEntries.value.some(item => item.id === entry.id && item.url === entry.url)) return
    const next = entryOrigin(entry)
    if (next) origin.value = next
  }

  function resetCopyFeedback(): void {
    copyGeneration += 1
    copyFeedback.value = ''
  }

  const copyEntryVisible = computed(() => !copyEntry.value || filteredEntries.value.some(
    entry => entry.id === copyEntry.value!.id && entry.url === copyEntry.value!.url
  ))
  const stopCopyTracking = watch([query, dateRange, origin, options.open, copyEntryVisible], resetCopyFeedback, { flush: 'sync' })

  let clockTimer: ReturnType<typeof setTimeout> | undefined
  function stopClock(): void {
    clearTimeout(clockTimer)
    clockTimer = undefined
    window.removeEventListener('focus', refreshClock)
    document.removeEventListener('visibilitychange', refreshClock)
  }

  function refreshClock(): void {
    clearTimeout(clockTimer)
    now.value = Date.now()
    if (!options.open.value || dateRange.value === 'all') return
    const tomorrow = new Date(now.value)
    tomorrow.setHours(24, 0, 0, 0)
    // Recompute at midnight and after sleep, clock, or system timezone changes.
    clockTimer = setTimeout(refreshClock, Math.min(60_000, Math.max(1, tomorrow.getTime() - now.value)))
  }

  const stopClockTracking = watch([options.open, dateRange], () => {
    stopClock()
    refreshClock()
    if (options.open.value && dateRange.value !== 'all') {
      window.addEventListener('focus', refreshClock)
      document.addEventListener('visibilitychange', refreshClock)
    }
  }, { flush: 'sync', immediate: true })

  function resetError(): void {
    error.value = ''
  }

  function invalidateActions(): void {
    actionGeneration += 1
    pendingAction.value = null
  }

  async function runAction(
    actionId: string,
    operation: () => Promise<BrowserHistoryEntry[] | void>
  ): Promise<boolean> {
    if (pendingAction.value) return false
    const generation = ++actionGeneration
    resetError()
    resetCopyFeedback()
    pendingAction.value = actionId
    try {
      const nextEntries = await operation()
      if (generation !== actionGeneration) return false
      if (nextEntries) options.entries.value = nextEntries
      return true
    } catch (cause) {
      if (generation !== actionGeneration) return false
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      if (generation === actionGeneration) pendingAction.value = null
    }
  }

  async function toggle(): Promise<void> {
    if (options.open.value) {
      options.open.value = false
      return
    }
    options.open.value = true
    await runAction('load', options.listHistory)
  }

  async function openEntry(entry: BrowserHistoryEntry): Promise<void> {
    const opened = await runAction(`open:${entry.id}`, () => options.openHistoryEntry(entry))
    if (opened) options.open.value = false
  }

  async function openInBackground(entry: BrowserHistoryEntry): Promise<void> {
    await runAction(`background:${entry.id}`, () => options.openHistoryEntryInBackground(entry))
  }

  async function copyAddress(entry: BrowserHistoryEntry): Promise<void> {
    if (pendingAction.value || !options.open.value
      || !filteredEntries.value.some(item => item.id === entry.id && item.url === entry.url)) return
    copyEntry.value = { id: entry.id, url: entry.url }
    await runAction(`copy:${entry.id}`, async () => {
      const generation = copyGeneration
      try {
        await options.copyHistoryAddress(entry)
        if (generation === copyGeneration) copyFeedback.value = 'success'
      } catch {
        if (generation === copyGeneration) copyFeedback.value = 'error'
      }
    })
  }

  function bookmark(entry: BrowserHistoryEntry): Promise<boolean> {
    return runAction(`bookmark:${entry.id}`, () => options.saveHistoryBookmark(entry.url, entry.title))
  }

  function remove(entryId: string): Promise<boolean> {
    return runAction(`remove:${entryId}`, () => options.removeHistoryEntry(entryId))
  }

  async function clear(): Promise<void> {
    if (!options.entries.value.length || pendingAction.value || !options.confirmClear()) return
    await runAction('clear', options.clearHistory)
  }

  function entryMeta(entry: BrowserHistoryEntry): string {
    const visited = options.formatDateTime(entry.visitedAt)
    return entry.visitCount > 1
      ? `${visited} · ${options.translate('history.visits', { count: options.formatNumber(entry.visitCount) }, entry.visitCount)}`
      : visited
  }

  const stopOpenTracking = watch(options.open, (isOpen) => {
    invalidateActions()
    if (!isOpen) resetError()
  }, { flush: 'sync' })

  function dispose(): void {
    invalidateActions()
    resetCopyFeedback()
    stopCopyTracking()
    stopOpenTracking()
    stopClockTracking()
    stopClock()
  }

  return {
    query,
    dateRange,
    origin,
    entryOrigin,
    filterOrigin,
    error,
    pendingAction,
    copyFeedback,
    filteredEntries,
    resetError,
    toggle,
    openEntry,
    openInBackground,
    copyAddress,
    bookmark,
    remove,
    clear,
    entryMeta,
    dispose
  }
}
