import { ref } from 'vue'
import type { BrowserDebugReport, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsCopyFeedback, DiagnosticsRequests } from '../diagnostics-request.js'
import { friendlyUiError } from '../../../composables/useAppToastController.js'

interface DebugReportOptions {
  browser: Pick<HronautApi, 'createDebugReport'>
  closeTransientPanels: () => void
  translate: (key: string) => string
}

/** The debug report panel and its copyable report. */
export function useDebugReport(
  options: DebugReportOptions,
  { begin, current, copyWithFeedback }: DiagnosticsRequests<'debug'> & DiagnosticsCopyFeedback<'debug'>
) {
  const debugReportState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const debugReport = ref<BrowserDebugReport | null>(null)
  const debugReportError = ref('')
  const debugReportPanelOpen = ref(false)
  const debugReportCopied = ref(false)

  async function runDebugReport(): Promise<void> {
    const request = begin('debug')
    if (!request) return
    options.closeTransientPanels()
    debugReportPanelOpen.value = true
    debugReportState.value = 'running'
    debugReportError.value = ''
    debugReportCopied.value = false
    try {
      const report = await options.browser.createDebugReport({
        tabId: request.tab.id,
        maxConsoleMessages: 30,
        maxNetworkRequests: 30,
        includeSuccessfulRequests: false
      })
      if (!current('debug', request)) return
      debugReport.value = report
      debugReportState.value = 'complete'
    } catch (cause) {
      if (!current('debug', request)) return
      debugReportState.value = 'error'
      debugReportError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  function toggleDebugReport(): void {
    if (debugReportPanelOpen.value) debugReportPanelOpen.value = false
    else void runDebugReport()
  }

  async function copyDebugReport(): Promise<void> {
    if (!debugReport.value) return
    await copyWithFeedback('debug', JSON.stringify(debugReport.value, null, 2), debugReportCopied)
  }

  return {
    debugReportState,
    debugReport,
    debugReportError,
    debugReportPanelOpen,
    debugReportCopied,
    runDebugReport,
    toggleDebugReport,
    copyDebugReport
  }
}
