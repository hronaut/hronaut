import { ref, watch, type Ref } from 'vue'
import type { BrowserCpuProfileResult, BrowserTabState, HronautApi } from '../../../../shared/types.js'
import type { DiagnosticsRecorderRequests } from './diagnostics-request.js'

interface CpuProfileOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<HronautApi, 'manageCpuProfile'>
  closeTransientPanels: () => void
}

/** The CPU profile panel, which records a profile of the active page. */
export function useCpuProfile(
  options: CpuProfileOptions,
  { beginRecorderRequest, finishRecorderRequest, current }: DiagnosticsRecorderRequests<'cpu'>
) {
  const cpuProfilePanelOpen = ref(false)
  const cpuProfileResult = ref<BrowserCpuProfileResult | null>(null)
  const cpuProfileState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const cpuProfileError = ref('')

  async function manageCpuProfile(action: 'get' | 'start' | 'stop' | 'clear'): Promise<void> {
    const request = beginRecorderRequest('cpu', action)
    if (!request) return
    cpuProfileState.value = 'loading'
    cpuProfileError.value = ''
    try {
      const result = await options.browser.manageCpuProfile({ tabId: request.tab.id, action })
      if (!current('cpu', request)) return
      cpuProfileResult.value = result
      cpuProfileState.value = 'ready'
    } catch (cause) {
      if (!current('cpu', request)) return
      cpuProfileState.value = 'error'
      cpuProfileError.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      finishRecorderRequest('cpu', request)
    }
  }

  function toggleCpuProfile(): void {
    if (cpuProfilePanelOpen.value) {
      cpuProfilePanelOpen.value = false
      return
    }
    options.closeTransientPanels()
    cpuProfilePanelOpen.value = true
    void manageCpuProfile('get')
  }

  /** The controller registers this after its page-context watcher, so a context reset runs first. */
  function watchCpuProfileRecording(): () => void {
    return watch(() => options.activeTab.value?.cpuProfileRecording?.startedAt, (currentValue, previous) => {
      if (!currentValue && previous && cpuProfilePanelOpen.value && cpuProfileResult.value?.status === 'recording') void manageCpuProfile('get')
    })
  }

  return {
    cpuProfilePanelOpen,
    cpuProfileResult,
    cpuProfileState,
    cpuProfileError,
    manageCpuProfile,
    toggleCpuProfile,
    watchCpuProfileRecording
  }
}
