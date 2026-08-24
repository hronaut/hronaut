import { ref } from 'vue'
import type { BrowsingDataSiteSummary } from '../../../shared/types.js'

export interface SiteDataSummaryContext {
  tabId: string
  url: string
}

export function useSiteDataSummaryController(options: {
  current: () => SiteDataSummaryContext | null
  load: (context: SiteDataSummaryContext) => Promise<BrowsingDataSiteSummary>
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
    const context = options.current()
    if (!context) {
      reset()
      return
    }
    const expectedGeneration = ++generation
    state.value = 'loading'
    message.value = ''
    try {
      const result = await options.load(context)
      if (!isCurrent(expectedGeneration, context)) return
      summary.value = result
      state.value = 'idle'
    } catch (error) {
      if (!isCurrent(expectedGeneration, context)) return
      summary.value = null
      state.value = 'error'
      message.value = error instanceof Error ? error.message : String(error)
    }
  }

  return { summary, state, message, refresh, reset }
}

export type SiteDataSummaryController = ReturnType<typeof useSiteDataSummaryController>
