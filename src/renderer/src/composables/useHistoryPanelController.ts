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
  saveHistoryBookmark: (url: string, title: string) => Promise<void>
  confirmClear: () => boolean
}

export function useHistoryPanelController(options: HistoryPanelControllerOptions) {
  const query = ref('')
  const dateRange = ref<HistoryDateRange>('all')
  const now = ref(Date.now())
  const error = ref('')
  const pendingAction = ref<string | null>(null)
  let actionGeneration = 0

  const filteredEntries = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    const bounds = historyDateBounds(dateRange.value, now.value)
    if (!normalized && !bounds) return options.entries.value
    return options.entries.value.filter((entry) => {
      const visited = Date.parse(entry.visitedAt)
      return (!bounds || (visited >= bounds[0] && visited < bounds[1]))
        && (!normalized || entry.title.toLocaleLowerCase().includes(normalized)
          || entry.url.toLocaleLowerCase().includes(normalized))
    })
  })

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
    stopOpenTracking()
    stopClockTracking()
    stopClock()
  }

  return {
    query,
    dateRange,
    error,
    pendingAction,
    filteredEntries,
    resetError,
    toggle,
    openEntry,
    bookmark,
    remove,
    clear,
    entryMeta,
    dispose
  }
}
