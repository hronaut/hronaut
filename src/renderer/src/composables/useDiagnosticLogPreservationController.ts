import { ref, type Ref } from 'vue'
import type {
  BrowserState,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'

type DiagnosticLogBrowserApi = Pick<HronautApi, 'setDiagnosticLogPreservation'>

export interface DiagnosticLogPreservationControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: DiagnosticLogBrowserApi
  syncState: (operation: Promise<BrowserState>) => Promise<BrowserState>
  onError: (error: unknown) => void
}

export function useDiagnosticLogPreservationController(
  options: DiagnosticLogPreservationControllerOptions
) {
  const busy = ref(false)
  let sequence = 0
  let disposed = false

  async function update(event: Event): Promise<boolean> {
    if (disposed) return false
    const input = event.currentTarget as HTMLInputElement
    const tab = options.activeTab.value
    if (!tab) return false
    const preserve = input.checked
    const operationSequence = ++sequence
    busy.value = true
    try {
      await options.syncState(options.browser.setDiagnosticLogPreservation(tab.id, preserve))
      return !disposed
        && operationSequence === sequence
        && options.activeTab.value?.id === tab.id
    } catch (error) {
      if (
        !disposed
        && operationSequence === sequence
        && options.activeTab.value?.id === tab.id
      ) {
        input.checked = options.activeTab.value.preserveDiagnosticLogs
        options.onError(error)
      }
      return false
    } finally {
      if (!disposed && operationSequence === sequence) busy.value = false
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    sequence += 1
    busy.value = false
  }

  return { busy, update, dispose }
}

export type DiagnosticLogPreservationController = ReturnType<typeof useDiagnosticLogPreservationController>
