import { ref } from 'vue'
import type { BrowserDesignOverviewReport, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsRequests } from '../diagnostics-request.js'
import { friendlyUiError } from '../../../composables/useAppToastController.js'

interface DesignOverviewOptions {
  browser: Pick<HronautApi, 'inspectDesign'>
  closeTransientPanels: () => void
  translate: (key: string) => string
}

/** The design overview panel. */
export function useDesignOverview(
  options: DesignOverviewOptions,
  { begin, current }: DiagnosticsRequests<'design'>
) {
  const designOverviewPanelOpen = ref(false)
  const designOverviewReport = ref<BrowserDesignOverviewReport | null>(null)
  const designOverviewState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const designOverviewError = ref('')

  async function runDesignOverview(): Promise<void> {
    const request = begin('design')
    if (!request) return
    options.closeTransientPanels()
    designOverviewPanelOpen.value = true
    designOverviewState.value = 'loading'
    designOverviewError.value = ''
    try {
      const report = await options.browser.inspectDesign(request.tab.id)
      if (!current('design', request)) return
      designOverviewReport.value = report
      designOverviewState.value = 'ready'
    } catch (cause) {
      if (!current('design', request)) return
      designOverviewState.value = 'error'
      designOverviewError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  function toggleDesignOverview(): void {
    if (designOverviewPanelOpen.value) designOverviewPanelOpen.value = false
    else void runDesignOverview()
  }

  return {
    designOverviewPanelOpen,
    designOverviewReport,
    designOverviewState,
    designOverviewError,
    runDesignOverview,
    toggleDesignOverview
  }
}
