import { ref } from 'vue'
import type { BrowsingDataSiteSummary } from '../../../../shared/types.js'
import { friendlyUiError } from '../../composables/useAppToastController.js'

export interface SiteDataSummaryContext {
  tabId: string
  url: string
}

export function useSiteDataSummaryController(options: {
  current: () => SiteDataSummaryContext | null
  load: (context: SiteDataSummaryContext) => Promise<BrowsingDataSiteSummary>
  /** Clears the website's cookies, storage and cache for the tab, answering with what it keeps after. */
  clear: (context: SiteDataSummaryContext) => Promise<BrowsingDataSiteSummary>
  /** Words for a failure that carries none of its own. */
  translate: (key: string) => string
}) {
  const summary = ref<BrowsingDataSiteSummary | null>(null)
  const state = ref<'idle' | 'loading' | 'error'>('idle')
  const message = ref('')
  let generation = 0

  function isCurrent(expectedGeneration: number, context: SiteDataSummaryContext): boolean {
    const current = options.current()
    return expectedGeneration === generation
      && current?.tabId === context.tabId
      && current.url === context.url
  }

  function reset(): void {
    generation += 1
    summary.value = null
    state.value = 'idle'
    message.value = ''
  }

  async function refresh(): Promise<void> {
    await read(options.load)
  }

  /** Site controls' Clear data for this website, once the person confirmed it: the counts show what is left. */
  async function clearData(): Promise<void> {
    await read(options.clear)
  }

  async function read(operation: (context: SiteDataSummaryContext) => Promise<BrowsingDataSiteSummary>): Promise<void> {
    const context = options.current()
    if (!context) {
      reset()
      return
    }
    const expectedGeneration = ++generation
    state.value = 'loading'
    message.value = ''
    try {
      const result = await operation(context)
      if (!isCurrent(expectedGeneration, context)) return
      summary.value = result
      state.value = 'idle'
    } catch (error) {
      if (!isCurrent(expectedGeneration, context)) return
      summary.value = null
      state.value = 'error'
      message.value = friendlyUiError(error, options.translate('runtime.toast.actionFailed'))
    }
  }

  return { summary, state, message, refresh, clearData, reset }
}

export type SiteDataSummaryController = ReturnType<typeof useSiteDataSummaryController>
