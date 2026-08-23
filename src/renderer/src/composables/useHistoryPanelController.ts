import { computed, ref, type Ref } from 'vue'
import type { BrowserHistoryEntry } from '../../../shared/types.js'

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
  confirmClear: () => boolean
}

export function useHistoryPanelController(options: HistoryPanelControllerOptions) {
  const query = ref('')
  const error = ref('')
  const pendingAction = ref<string | null>(null)

  const filteredEntries = computed(() => {
    const normalized = query.value.trim().toLocaleLowerCase()
    if (!normalized) return options.entries.value
    return options.entries.value.filter((entry) => (
      entry.title.toLocaleLowerCase().includes(normalized)
      || entry.url.toLocaleLowerCase().includes(normalized)
    ))
  })

  function resetError(): void {
    error.value = ''
  }

  async function runAction(
    actionId: string,
    operation: () => Promise<BrowserHistoryEntry[] | void>
  ): Promise<boolean> {
    if (pendingAction.value) return false
    resetError()
    pendingAction.value = actionId
    try {
      const nextEntries = await operation()
      if (nextEntries) options.entries.value = nextEntries
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      if (pendingAction.value === actionId) pendingAction.value = null
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

  return {
    query,
    error,
    pendingAction,
    filteredEntries,
    resetError,
    toggle,
    openEntry,
    remove,
    clear,
    entryMeta
  }
}
