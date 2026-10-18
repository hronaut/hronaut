import { ref } from 'vue'
import type { BrowserQualityAudit, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsCopyFeedback, DiagnosticsRequests } from '../diagnostics-request.js'

interface QualityAuditOptions {
  browser: Pick<HronautApi, 'runQualityAudit'>
  closeTransientPanels: () => void
}

/** The quality audit panel and its copyable report. */
export function useQualityAudit(
  options: QualityAuditOptions,
  { begin, current, copyWithFeedback }: DiagnosticsRequests<'quality'> & DiagnosticsCopyFeedback<'quality'>
) {
  const qualityAuditState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const qualityAuditReport = ref<BrowserQualityAudit | null>(null)
  const qualityAuditError = ref('')
  const qualityAuditPanelOpen = ref(false)
  const qualityAuditCopied = ref(false)

  async function runQualityAudit(): Promise<void> {
    const request = begin('quality')
    if (!request) return
    options.closeTransientPanels()
    qualityAuditPanelOpen.value = true
    qualityAuditState.value = 'running'
    qualityAuditError.value = ''
    qualityAuditReport.value = null
    qualityAuditCopied.value = false
    try {
      const report = await options.browser.runQualityAudit(request.tab.id)
      if (!current('quality', request)) return
      qualityAuditReport.value = report
      qualityAuditState.value = 'complete'
    } catch (cause) {
      if (!current('quality', request)) return
      qualityAuditState.value = 'error'
      qualityAuditError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleQualityAudit(): void {
    if (qualityAuditPanelOpen.value) qualityAuditPanelOpen.value = false
    else void runQualityAudit()
  }

  async function copyQualityAudit(): Promise<void> {
    if (!qualityAuditReport.value) return
    await copyWithFeedback('quality', JSON.stringify(qualityAuditReport.value, null, 2), qualityAuditCopied)
  }

  return {
    qualityAuditState,
    qualityAuditReport,
    qualityAuditError,
    qualityAuditPanelOpen,
    qualityAuditCopied,
    runQualityAudit,
    toggleQualityAudit,
    copyQualityAudit
  }
}
