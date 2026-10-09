import { isHronautHomeUrl } from '../../../shared/home-url.js'
import { computed, ref, watch, type Ref } from 'vue'
import type {
  BrowserConsoleMessage,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'
import {
  countConsoleEvents,
  countConsoleMessages,
  filterConsoleMessages,
  type BrowserConsoleLevelFilter
} from '../../../shared/console-messages.js'
import { createFeedbackTimerRegistry } from './feedback-timer-registry.js'

type ConsoleBrowserApi = Pick<
  HronautApi,
  'listConsoleMessages'
>

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface ConsoleControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  open: Ref<boolean>
  browser: ConsoleBrowserApi
  translate: Translate
  copyText: (text: string) => Promise<boolean>
  keepsSeparatePanelOpen: () => boolean
}

export function useConsoleController(options: ConsoleControllerOptions) {
  const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const messages = ref<BrowserConsoleMessage[]>([])
  const error = ref('')
  const search = ref('')
  const excludeText = ref('')
  const level = ref<BrowserConsoleLevelFilter>('all')
  const liveUpdatesPaused = ref(false)
  const copied = ref<'filtered' | 'all' | null>(null)
  const copiedEntryKey = ref<string | null>(null)
  let generation = 0
  let requestSequence = 0
  let pendingRefresh: { tabId: string; generation: number } | null = null
  let copySequence = 0
  let filterRevision = 0
  let refreshTimer: number | undefined
  const feedbackTimers = createFeedbackTimerRegistry<'entry' | 'filtered' | 'all'>()

  const filteredMessages = computed(() => filterConsoleMessages(messages.value, search.value, level.value, excludeText.value))
  const messageCounts = computed(() => countConsoleMessages(messages.value))
  const eventCount = computed(() => countConsoleEvents(messages.value))
  const filteredEventCount = computed(() => countConsoleEvents(filteredMessages.value))

  function isCurrent(tabId: string, expectedGeneration: number): boolean {
    return generation === expectedGeneration && options.activeTab.value?.id === tabId
  }

  function reset(closePanel = false): void {
    liveUpdatesPaused.value = false
    generation += 1
    requestSequence += 1
    copySequence += 1
    feedbackTimers.clearAll()
    if (closePanel && !options.keepsSeparatePanelOpen()) options.open.value = false
    messages.value = []
    state.value = 'idle'
    error.value = ''
    copied.value = null
    copiedEntryKey.value = null
  }

  function clearCopyFeedback(): void {
    copySequence += 1
    feedbackTimers.clearAll()
    copied.value = null
    copiedEntryKey.value = null
  }

  async function refresh(clear = false, silent = false): Promise<void> {
    if (silent && liveUpdatesPaused.value) return
    const tab = options.activeTab.value
    if (!tab || isHronautHomeUrl(tab.url)) return
    if (silent && pendingRefresh && isCurrent(pendingRefresh.tabId, pendingRefresh.generation)) return
    const expectedGeneration = generation
    const sequence = ++requestSequence
    const pending = { tabId: tab.id, generation: expectedGeneration }
    pendingRefresh = pending
    if (!silent) state.value = 'loading'
    error.value = ''
    if (clear) clearCopyFeedback()
    try {
      const nextMessages = await options.browser.listConsoleMessages(tab.id, clear)
      if (sequence !== requestSequence || !isCurrent(tab.id, expectedGeneration)) return
      if (clear) clearCopyFeedback()
      // Clearing returns the removed records; they are no longer retained.
      messages.value = clear ? [] : nextMessages
      state.value = 'ready'
    } catch (cause) {
      if (sequence !== requestSequence || !isCurrent(tab.id, expectedGeneration)) return
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (pendingRefresh === pending) pendingRefresh = null
    }
  }

  function toggleLiveUpdates(): void {
    if (!options.open.value || state.value === 'loading') return
    liveUpdatesPaused.value = !liveUpdatesPaused.value
    if (liveUpdatesPaused.value) {
      // A poll already in flight must not replace the displayed snapshot.
      requestSequence += 1
    } else void refresh()
  }

  function entryKey(message: BrowserConsoleMessage): string {
    return `${message.timestamp}\n${message.sourceId}\n${message.lineNumber}\n${message.message}`
  }

  async function copyMessages(
    nextMessages: BrowserConsoleMessage[],
    scope: 'entry' | 'filtered' | 'all',
    selectedEntryKey?: string
  ): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || !nextMessages.length) return
    const expectedGeneration = generation
    const sequence = ++copySequence
    const copiedFilterRevision = filterRevision
    const payload = {
      generatedAt: new Date().toISOString(),
      tabId: tab.id,
      scope,
      ...(liveUpdatesPaused.value ? { displayUpdatesPaused: true, pendingMessages: 'unknown', missedMessages: 'unknown' } : {}),
      ...(scope === 'filtered' ? {
        filter: { query: search.value.trim() || undefined, level: level.value, excludeText: excludeText.value.trim() || undefined }
      } : {}),
      messages: nextMessages,
      caveat: options.translate('debugReport.caveats.console')
    }
    if (!await options.copyText(JSON.stringify(payload, null, 2))) return
    if (
      sequence !== copySequence
      || (scope === 'filtered' && copiedFilterRevision !== filterRevision)
      || !isCurrent(tab.id, expectedGeneration)
      || options.activeTab.value?.url !== tab.url
    ) return
    if (scope === 'entry') {
      const key = selectedEntryKey ?? entryKey(nextMessages[0])
      copiedEntryKey.value = key
      feedbackTimers.schedule('entry', () => {
        if (copiedEntryKey.value === key) copiedEntryKey.value = null
      })
    } else {
      copied.value = scope
      feedbackTimers.schedule(scope, () => {
        if (copied.value === scope) copied.value = null
      })
    }
  }

  const copyEntry = (message: BrowserConsoleMessage): Promise<void> => (
    copyMessages([message], 'entry', entryKey(message))
  )
  const copyAll = (): Promise<void> => copyMessages(messages.value.slice().reverse(), 'all')
  const copyFiltered = (): Promise<void> => copyMessages(filteredMessages.value, 'filtered')

  const stopFilterWatcher = watch([search, level, excludeText], () => {
    filterRevision += 1
    if (copied.value === 'filtered') copied.value = null
    feedbackTimers.clear('filtered')
  }, { flush: 'sync' })

  const stopOpenWatcher = watch(options.open, (open) => {
    if (refreshTimer !== undefined) {
      window.clearInterval(refreshTimer)
      refreshTimer = undefined
    }
    if (!open) {
      if (liveUpdatesPaused.value) {
        requestSequence += 1
        pendingRefresh = null
        if (state.value === 'loading') state.value = 'idle'
      }
      liveUpdatesPaused.value = false
      return
    }
    if (state.value === 'idle') void refresh()
    refreshTimer = window.setInterval(() => {
      if (options.open.value) void refresh(false, true)
    }, 1_000)
  }, { immediate: true, flush: 'sync' })

  function dispose(): void {
    stopOpenWatcher()
    stopFilterWatcher()
    generation += 1
    requestSequence += 1
    copySequence += 1
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
    feedbackTimers.clearAll()
  }

  return {
    state,
    messages,
    error,
    search,
    excludeText,
    level,
    liveUpdatesPaused,
    toggleLiveUpdates,
    copied,
    copiedEntryKey,
    filteredMessages,
    messageCounts,
    eventCount,
    filteredEventCount,
    reset,
    refresh,
    copyEntry,
    copyAll,
    copyFiltered,
    dispose
  }
}
