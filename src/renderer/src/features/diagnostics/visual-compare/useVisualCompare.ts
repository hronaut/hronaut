import { ref } from 'vue'
import type { BrowserVisualCompareView, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsRequests } from '../diagnostics-request.js'

interface VisualCompareOptions {
  browser: Pick<HronautApi, 'visualCompare' | 'copyVisualDiff'>
  closeTransientPanels: () => void
}

/** The copied-diff feedback timer, shared with the controller's other copy feedback. */
interface VisualCompareFeedback {
  feedbackTimers: Pick<Map<'visual', number>, 'get' | 'delete'>
  scheduleFeedbackReset: (key: 'visual', callback: () => void) => void
}

/** The visual comparison panel and its copyable diff image. */
export function useVisualCompare(
  options: VisualCompareOptions,
  { begin, current, feedbackTimers, scheduleFeedbackReset }: DiagnosticsRequests<'visual'> & VisualCompareFeedback
) {
  const visualComparePanelOpen = ref(false)
  const visualCompareReport = ref<BrowserVisualCompareView | null>(null)
  const visualCompareState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const visualCompareError = ref('')
  const visualCompareCopied = ref(false)

  async function manageVisualCompare(action: 'get' | 'set-baseline' | 'compare' | 'clear'): Promise<void> {
    const request = begin('visual')
    if (!request) return
    visualCompareState.value = 'loading'
    visualCompareError.value = ''
    visualCompareCopied.value = false
    try {
      const report = await options.browser.visualCompare({ tabId: request.tab.id, action, settleMs: 200 })
      if (!current('visual', request)) return
      visualCompareReport.value = report
      visualCompareState.value = 'ready'
    } catch (cause) {
      if (!current('visual', request)) return
      visualCompareState.value = 'error'
      visualCompareError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleVisualCompare(): void {
    if (visualComparePanelOpen.value) visualComparePanelOpen.value = false
    else {
      options.closeTransientPanels()
      visualComparePanelOpen.value = true
      void manageVisualCompare('get')
    }
  }

  async function copyVisualDiff(): Promise<void> {
    const request = begin('visual')
    if (!request || visualCompareReport.value?.status !== 'compared') return
    const previous = feedbackTimers.get('visual')
    if (previous !== undefined) window.clearTimeout(previous)
    feedbackTimers.delete('visual')
    visualCompareCopied.value = false
    visualCompareError.value = ''
    try {
      await options.browser.copyVisualDiff(request.tab.id)
      if (!current('visual', request)) return
      visualCompareCopied.value = true
      scheduleFeedbackReset('visual', () => (visualCompareCopied.value = false))
    } catch (cause) {
      if (!current('visual', request)) return
      visualCompareState.value = 'error'
      visualCompareError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  return {
    visualComparePanelOpen,
    visualCompareReport,
    visualCompareState,
    visualCompareError,
    visualCompareCopied,
    manageVisualCompare,
    toggleVisualCompare,
    copyVisualDiff
  }
}
