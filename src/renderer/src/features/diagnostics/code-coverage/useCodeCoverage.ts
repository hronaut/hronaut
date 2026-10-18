import { ref, watch, type Ref } from 'vue'
import type {
  BrowserCodeCoverageMode,
  BrowserCodeCoverageResult,
  BrowserTabState,
  HronautApi
} from '../../../../../shared/types.js'
import type { DiagnosticsRecorderRequests } from '../diagnostics-request.js'

interface CodeCoverageOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<HronautApi, 'manageCodeCoverage'>
  closeTransientPanels: () => void
}

/** The code coverage panel, which records coverage on the active page. */
export function useCodeCoverage(
  options: CodeCoverageOptions,
  { beginRecorderRequest, finishRecorderRequest, current }: DiagnosticsRecorderRequests<'coverage'>
) {
  const coveragePanelOpen = ref(false)
  const coverageResult = ref<BrowserCodeCoverageResult | null>(null)
  const coverageState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const coverageError = ref('')
  const coverageMode = ref<BrowserCodeCoverageMode>('function')

  async function manageCodeCoverage(action: 'get' | 'start' | 'stop' | 'clear', reload = true): Promise<void> {
    const request = beginRecorderRequest('coverage', action)
    if (!request) return
    coverageState.value = 'loading'
    coverageError.value = ''
    try {
      const result = await options.browser.manageCodeCoverage({
        tabId: request.tab.id,
        action,
        mode: coverageMode.value,
        reload
      })
      if (!current('coverage', request)) return
      coverageResult.value = result
      coverageState.value = 'ready'
    } catch (cause) {
      if (!current('coverage', request)) return
      coverageState.value = 'error'
      coverageError.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      finishRecorderRequest('coverage', request)
    }
  }

  function toggleCodeCoverage(): void {
    if (coveragePanelOpen.value) {
      coveragePanelOpen.value = false
      return
    }
    options.closeTransientPanels()
    coveragePanelOpen.value = true
    void manageCodeCoverage('get')
  }

  /** The controller registers this after its page-context watcher, so a context reset runs first. */
  function watchCodeCoverageRecording(): () => void {
    return watch(() => options.activeTab.value?.codeCoverageRecording?.startedAt, (currentValue, previous) => {
      if (!currentValue && previous && coveragePanelOpen.value && coverageResult.value?.status === 'recording') void manageCodeCoverage('get')
    })
  }

  return {
    coveragePanelOpen,
    coverageResult,
    coverageState,
    coverageError,
    coverageMode,
    manageCodeCoverage,
    toggleCodeCoverage,
    watchCodeCoverageRecording
  }
}
