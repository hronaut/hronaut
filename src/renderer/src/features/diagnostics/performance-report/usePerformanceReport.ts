import { ref } from 'vue'
import type { BrowserPerformanceAction, BrowserPerformanceReport, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsRequests } from '../diagnostics-request.js'

interface PerformanceReportOptions {
  browser: Pick<HronautApi, 'measurePerformance'>
  closeTransientPanels: () => void
}

/** The performance report panel and its baseline actions. */
export function usePerformanceReport(
  options: PerformanceReportOptions,
  { begin, current }: DiagnosticsRequests<'performance'>
) {
  const performanceState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const performanceReport = ref<BrowserPerformanceReport | null>(null)
  const performanceError = ref('')
  const performancePanelOpen = ref(false)

  async function runPerformanceReport(action: BrowserPerformanceAction = 'measure'): Promise<void> {
    const request = begin('performance')
    if (!request) return
    options.closeTransientPanels()
    performancePanelOpen.value = true
    performanceState.value = 'running'
    performanceError.value = ''
    try {
      const report = await options.browser.measurePerformance({ tabId: request.tab.id, settleMs: 800, action })
      if (!current('performance', request)) return
      performanceReport.value = report
      performanceState.value = 'complete'
    } catch (cause) {
      if (!current('performance', request)) return
      performanceState.value = 'error'
      performanceError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function togglePerformanceReport(): void {
    if (performancePanelOpen.value) performancePanelOpen.value = false
    else void runPerformanceReport()
  }

  return {
    performanceState,
    performanceReport,
    performanceError,
    performancePanelOpen,
    runPerformanceReport,
    togglePerformanceReport
  }
}
