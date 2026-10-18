import { ref } from 'vue'
import type { BrowserSecurityReport, HronautApi } from '../../../../shared/types.js'
import type { DiagnosticsRequests } from './diagnostics-request.js'

interface SecurityReportOptions {
  browser: Pick<HronautApi, 'inspectSecurity'>
  closeTransientPanels: () => void
}

/** The security report panel. */
export function useSecurityReport(
  options: SecurityReportOptions,
  { begin, current }: DiagnosticsRequests<'security'>
) {
  const securityPanelOpen = ref(false)
  const securityReport = ref<BrowserSecurityReport | null>(null)
  const securityReportState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const securityReportError = ref('')

  async function runSecurityReport(): Promise<void> {
    const request = begin('security')
    if (!request) return
    options.closeTransientPanels()
    securityPanelOpen.value = true
    securityReportState.value = 'loading'
    securityReportError.value = ''
    try {
      const report = await options.browser.inspectSecurity(request.tab.id)
      if (!current('security', request)) return
      securityReport.value = report
      securityReportState.value = 'ready'
    } catch (cause) {
      if (!current('security', request)) return
      securityReportState.value = 'error'
      securityReportError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleSecurityReport(): void {
    if (securityPanelOpen.value) securityPanelOpen.value = false
    else void runSecurityReport()
  }

  return {
    securityPanelOpen,
    securityReport,
    securityReportState,
    securityReportError,
    runSecurityReport,
    toggleSecurityReport
  }
}
