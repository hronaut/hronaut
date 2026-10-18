import { ref } from 'vue'
import type { BrowserAccessibilityAudit, BrowserAccessibilityAuditAction, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsRequests } from '../diagnostics-request.js'

interface AccessibilityAuditOptions {
  browser: Pick<HronautApi, 'runAccessibilityAudit'>
  closeTransientPanels: () => void
}

/** The accessibility audit panel: one WCAG AA audit of the active page at a time. */
export function useAccessibilityAudit(
  options: AccessibilityAuditOptions,
  { begin, current }: DiagnosticsRequests<'accessibility'>
) {
  const accessibilityAuditState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const accessibilityAudit = ref<BrowserAccessibilityAudit | null>(null)
  const accessibilityAuditError = ref('')
  const accessibilityPanelOpen = ref(false)

  async function runAccessibilityAudit(action: BrowserAccessibilityAuditAction = 'measure'): Promise<void> {
    const request = begin('accessibility')
    if (!request) return
    options.closeTransientPanels()
    accessibilityPanelOpen.value = true
    accessibilityAuditState.value = 'running'
    accessibilityAuditError.value = ''
    accessibilityAudit.value = null
    try {
      const audit = await options.browser.runAccessibilityAudit({
        tabId: request.tab.id,
        action,
        standard: 'wcag-aa',
        maxViolations: 50,
        maxNodesPerViolation: 3
      })
      if (!current('accessibility', request)) return
      accessibilityAudit.value = audit
      accessibilityAuditState.value = 'complete'
    } catch (cause) {
      if (!current('accessibility', request)) return
      accessibilityAuditState.value = 'error'
      accessibilityAuditError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function toggleAccessibilityAudit(): void {
    if (accessibilityPanelOpen.value) accessibilityPanelOpen.value = false
    else void runAccessibilityAudit()
  }

  return {
    accessibilityAuditState,
    accessibilityAudit,
    accessibilityAuditError,
    accessibilityPanelOpen,
    runAccessibilityAudit,
    toggleAccessibilityAudit
  }
}
