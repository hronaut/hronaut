import { ref, watch, type Ref } from 'vue'
import type { BrowserDomChangesReport, BrowserTabState, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsCopyFeedback, DiagnosticsRecorderRequests } from '../diagnostics-request.js'
import { friendlyUiError } from '../../../composables/useAppToastController.js'

interface DomChangesOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<HronautApi, 'manageDomChanges'>
  closeTransientPanels: () => void
  translate: (key: string) => string
}

/** The DOM changes panel, which refreshes itself while a recording is active. */
export function useDomChanges(
  options: DomChangesOptions,
  { beginRecorderRequest, finishRecorderRequest, current, copyWithFeedback }: DiagnosticsRecorderRequests<'dom'>
    & DiagnosticsCopyFeedback<'dom'>
) {
  const domChangesPanelOpen = ref(false)
  const domChangesReport = ref<BrowserDomChangesReport | null>(null)
  const domChangesState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const domChangesError = ref('')
  const domChangesCopied = ref(false)
  let domRefreshTimer: number | undefined
  let domChangesReadRequest: {
    tabId: string
    url: string
    navigationGeneration: number
    promise: Promise<BrowserDomChangesReport>
  } | undefined

  async function manageDomChanges(action: 'start' | 'get' | 'stop' | 'clear', quiet = false): Promise<void> {
    const request = beginRecorderRequest('dom', action)
    if (!request) return
    if (!quiet) domChangesState.value = 'loading'
    domChangesError.value = ''
    if (!quiet) domChangesCopied.value = false
    try {
      if (action !== 'get') domChangesReadRequest = undefined
      let operation = domChangesReadRequest
      if (action !== 'get' || operation?.tabId !== request.tab.id || operation.url !== request.tab.url
        || operation.navigationGeneration !== request.tab.navigationGeneration) {
        const promise = options.browser.manageDomChanges(action, request.tab.id)
        operation = { tabId: request.tab.id, url: request.tab.url, navigationGeneration: request.tab.navigationGeneration, promise }
        if (action === 'get') {
          domChangesReadRequest = operation
          void promise.then(
            () => {
              if (domChangesReadRequest === operation) domChangesReadRequest = undefined
            },
            () => {
              if (domChangesReadRequest === operation) domChangesReadRequest = undefined
            }
          )
        }
      }
      const report = await operation.promise
      if (!current('dom', request)) return
      domChangesReport.value = report
      domChangesState.value = 'ready'
    } catch (cause) {
      if (!current('dom', request)) return
      domChangesState.value = 'error'
      domChangesError.value = friendlyUiError(cause, options.translate('runtime.toast.actionFailed'))
    } finally {
      finishRecorderRequest('dom', request)
    }
  }

  function toggleDomChanges(): void {
    if (domChangesPanelOpen.value) domChangesPanelOpen.value = false
    else {
      options.closeTransientPanels()
      domChangesPanelOpen.value = true
    }
  }

  async function copyDomChanges(): Promise<void> {
    if (!domChangesReport.value) return
    await copyWithFeedback('dom', JSON.stringify(domChangesReport.value, null, 2), domChangesCopied)
  }

  /**
   * The controller registers these after its page-context watcher, so a
   * context reset runs first. The returned stop also ends the refresh timer.
   */
  function watchDomChanges(): () => void {
    const stopDomTabWatcher = watch(
      () => [options.activeTab.value?.id, options.activeTab.value?.domChangesRecording?.active, options.activeTab.value?.domChangesRecording?.changeCount] as const,
      ([tabId]) => {
        if (tabId && domChangesPanelOpen.value) void manageDomChanges('get', true)
      }
    )
    const stopDomOpenWatcher = watch(domChangesPanelOpen, (open) => {
      if (domRefreshTimer !== undefined) {
        window.clearInterval(domRefreshTimer)
        domRefreshTimer = undefined
      }
      if (!open) return
      void manageDomChanges('get')
      domRefreshTimer = window.setInterval(() => {
        if (domChangesPanelOpen.value && domChangesReport.value?.active) void manageDomChanges('get', true)
      }, 1_000)
    }, { immediate: true })
    return () => {
      stopDomTabWatcher()
      stopDomOpenWatcher()
      if (domRefreshTimer !== undefined) window.clearInterval(domRefreshTimer)
    }
  }

  return {
    domChangesPanelOpen,
    domChangesReport,
    domChangesState,
    domChangesError,
    domChangesCopied,
    manageDomChanges,
    toggleDomChanges,
    copyDomChanges,
    watchDomChanges
  }
}
