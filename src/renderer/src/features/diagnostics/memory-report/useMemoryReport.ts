import { ref, watch, type Ref } from 'vue'
import type { BrowserMemoryReport, BrowserTabState, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsRequests } from '../diagnostics-request.js'
import { friendlyUiError } from '../../../composables/useAppToastController.js'

interface MemoryReportOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<HronautApi, 'measureMemory'>
  closeTransientPanels: () => void
  translate: (key: string) => string
}

/** The memory panel: measurements, the baseline and allocation sampling. */
export function useMemoryReport(
  options: MemoryReportOptions,
  { begin, current }: DiagnosticsRequests<'memory'>
) {
  const memoryState = ref<'idle' | 'running' | 'complete' | 'error'>('idle')
  const memoryReport = ref<BrowserMemoryReport | null>(null)
  const memoryError = ref('')
  const memoryPanelOpen = ref(false)

  async function runMemoryReport(action: 'measure' | 'set-baseline' = 'measure', collectGarbage = false): Promise<void> {
    const request = begin('memory')
    if (!request) return
    options.closeTransientPanels()
    memoryPanelOpen.value = true
    memoryState.value = 'running'
    memoryError.value = ''
    try {
      const report = await options.browser.measureMemory({ tabId: request.tab.id, action, collectGarbage })
      if (!current('memory', request)) return
      memoryReport.value = report
      memoryState.value = 'complete'
    } catch (cause) {
      if (!current('memory', request)) return
      memoryState.value = 'error'
      memoryError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  async function clearMemoryBaseline(): Promise<void> {
    const request = begin('memory')
    if (!request) return
    memoryState.value = 'running'
    memoryError.value = ''
    try {
      const previous = memoryReport.value
      const cleared = await options.browser.measureMemory({ tabId: request.tab.id, action: 'clear-baseline' })
      if (!current('memory', request)) return
      const preserveCurrent = previous?.tabId === cleared.tabId && previous.url === cleared.url && previous.current
      memoryReport.value = {
        ...cleared,
        ...(preserveCurrent ? { current: previous.current, forcedGarbageCollection: previous.forcedGarbageCollection } : {})
      }
      memoryState.value = 'complete'
    } catch (cause) {
      if (!current('memory', request)) return
      memoryState.value = 'error'
      memoryError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  async function manageMemoryAllocation(action: 'start' | 'stop' | 'clear'): Promise<void> {
    const request = begin('memory')
    if (!request) return
    options.closeTransientPanels()
    memoryPanelOpen.value = true
    memoryState.value = 'running'
    memoryError.value = ''
    try {
      const memoryAction = action === 'start'
        ? 'start-allocation-sampling'
        : action === 'stop' ? 'stop-allocation-sampling' : 'clear-allocation-sampling'
      let report = await options.browser.measureMemory({ tabId: request.tab.id, action: memoryAction })
      if (!current('memory', request)) return
      if (action === 'clear') report = await options.browser.measureMemory({ tabId: request.tab.id, action: 'measure' })
      if (!current('memory', request)) return
      memoryReport.value = report
      memoryState.value = 'complete'
    } catch (cause) {
      if (!current('memory', request)) return
      memoryState.value = 'error'
      memoryError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    }
  }

  function toggleMemoryReport(): void {
    if (memoryPanelOpen.value) memoryPanelOpen.value = false
    else void runMemoryReport()
  }

  /** The controller registers this after its page-context watcher, so a context reset runs first. */
  function watchMemoryAllocationRecording(): () => void {
    return watch(() => options.activeTab.value?.memoryAllocationRecording?.startedAt, (currentValue, previous) => {
      if (!currentValue && previous && memoryPanelOpen.value && memoryReport.value?.allocationStatus === 'recording') {
        memoryReport.value = {
          ...memoryReport.value,
          allocationStatus: 'idle',
          allocationRecording: undefined,
          allocationProfile: undefined
        }
      }
    })
  }

  return {
    memoryState,
    memoryReport,
    memoryError,
    memoryPanelOpen,
    runMemoryReport,
    clearMemoryBaseline,
    manageMemoryAllocation,
    toggleMemoryReport,
    watchMemoryAllocationRecording
  }
}
