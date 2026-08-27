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
  const level = ref<BrowserConsoleLevelFilter>('all')
  const copied = ref<'filtered' | 'all' | null>(null)
  const copiedEntryKey = ref<string | null>(null)
  let generation = 0
  let requestSequence = 0
  let copySequence = 0
  let refreshTimer: number | undefined
  const feedbackTimers = createFeedbackTimerRegistry<'entry' | 'filtered' | 'all'>()

  const filteredMessages = computed(() => filterConsoleMessages(messages.value, search.value, level.value))
  const messageCounts = computed(() => countConsoleMessages(messages.value))
  const eventCount = computed(() => countConsoleEvents(messages.value))
  const filteredEventCount = computed(() => countConsoleEvents(filteredMessages.value))

  function isCurrent(tabId: string, expectedGeneration: number): boolean {
    return generation === expectedGeneration && options.activeTab.value?.id === tabId
  }

  function reset(closePanel = false): void {
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

  async function refresh(clear = false, silent = false): Promise<void> {
    const tab = options.activeTab.value
    if (!tab || tab.url.startsWith('hronaut://home')) return
    const expectedGeneration = generation
    const sequence = ++requestSequence
    if (!silent) state.value = 'loading'
    error.value = ''
    if (clear) {
      copied.value = null
      copiedEntryKey.value = null
    }
    try {
      const nextMessages = await options.browser.listConsoleMessages(tab.id, clear)
      if (sequence !== requestSequence || !isCurrent(tab.id, expectedGeneration)) return
      messages.value = nextMessages
      state.value = 'ready'
    } catch (cause) {
      if (sequence !== requestSequence || !isCurrent(tab.id, expectedGeneration)) return
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
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
    const payload = {
      generatedAt: new Date().toISOString(),
      tabId: tab.id,
      scope,
      ...(scope === 'filtered' ? {
        filter: { query: search.value.trim() || undefined, level: level.value }
      } : {}),
      messages: nextMessages,
      caveat: options.translate('debugReport.caveats.console')
    }
    if (!await options.copyText(JSON.stringify(payload, null, 2))) return
    if (
      sequence !== copySequence
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

  const stopOpenWatcher = watch(options.open, (open) => {
    if (refreshTimer !== undefined) {
      window.clearInterval(refreshTimer)
      refreshTimer = undefined
    }
    if (!open) return
    if (state.value === 'idle') void refresh()
    refreshTimer = window.setInterval(() => {
      if (options.open.value) void refresh(false, true)
    }, 1_000)
  }, { immediate: true })

  function dispose(): void {
    stopOpenWatcher()
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
    level,
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
