import { ref } from 'vue'
import type { BrowserInspectorIssuesReport, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsCopyFeedback, DiagnosticsRequests } from '../diagnostics-request.js'
import { friendlyUiError } from '../../../composables/useAppToastController.js'

interface InspectorIssuesOptions {
  browser: Pick<HronautApi, 'listInspectorIssues'>
  closeTransientPanels: () => void
  translate: (key: string) => string
}

/** The inspector issues panel and its copyable report. */
export function useInspectorIssues(
  options: InspectorIssuesOptions,
  { begin, current, copyWithFeedback }: DiagnosticsRequests<'issues'> & DiagnosticsCopyFeedback<'issues'>
) {
  const inspectorIssuesOpen = ref(false)
  const inspectorIssuesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const inspectorIssuesReport = ref<BrowserInspectorIssuesReport | null>(null)
  const inspectorIssuesError = ref('')
  const inspectorIssuesCopied = ref(false)

  async function refreshInspectorIssues(clear = false): Promise<void> {
    const request = begin('issues')
    if (!request) return
    inspectorIssuesState.value = 'loading'
    inspectorIssuesError.value = ''
    inspectorIssuesCopied.value = false
    try {
      const report = await options.browser.listInspectorIssues(request.tab.id, clear)
      if (!current('issues', request)) return
      inspectorIssuesReport.value = report
      inspectorIssuesState.value = 'ready'
    } catch (cause) {
      if (!current('issues', request)) return
      inspectorIssuesState.value = 'error'
      inspectorIssuesError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  function toggleInspectorIssues(): void {
    if (inspectorIssuesOpen.value) inspectorIssuesOpen.value = false
    else {
      options.closeTransientPanels()
      inspectorIssuesOpen.value = true
      void refreshInspectorIssues()
    }
  }

  const clearInspectorIssues = (): Promise<void> => refreshInspectorIssues(true)

  async function copyInspectorIssues(): Promise<void> {
    if (!inspectorIssuesReport.value) return
    await copyWithFeedback('issues', JSON.stringify(inspectorIssuesReport.value, null, 2), inspectorIssuesCopied)
  }

  return {
    inspectorIssuesOpen,
    inspectorIssuesState,
    inspectorIssuesReport,
    inspectorIssuesError,
    inspectorIssuesCopied,
    refreshInspectorIssues,
    toggleInspectorIssues,
    clearInspectorIssues,
    copyInspectorIssues
  }
}
