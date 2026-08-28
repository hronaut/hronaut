import { computed, type Ref } from 'vue'
import type { BrowserState, HronautApi } from '../../../shared/types.js'
import { disposeAll } from './dispose-all.js'
import { useDiagnosticLogPreservationController } from './useDiagnosticLogPreservationController.js'
import { useMcpActivityController } from './useMcpActivityController.js'

type AppTabRuntimeBrowserApi = Pick<
  HronautApi,
  'setDiagnosticLogPreservation' | 'onMcpTabActivity'
>

export interface AppTabRuntimeFeatureControllerOptions {
  state: Readonly<Ref<BrowserState>>
  hydrated: Readonly<Ref<boolean>>
  browser: AppTabRuntimeBrowserApi
  syncState: (operation: Promise<BrowserState>) => Promise<BrowserState>
  onDiagnosticError: (error: unknown) => void
  activityLingerMs?: number
}

export function useAppTabRuntimeFeatureController(
  options: AppTabRuntimeFeatureControllerOptions
) {
  const activeTab = computed(() => options.state.value.tabs.find(
    (tab) => tab.id === options.state.value.activeTabId
  ))
  const diagnosticLogPreservation = useDiagnosticLogPreservationController({
    activeTab,
    browser: options.browser,
    syncState: options.syncState,
    onError: options.onDiagnosticError
  })
  let mcpActivity: ReturnType<typeof useMcpActivityController>
  try {
    mcpActivity = useMcpActivityController({
      api: options.browser,
      tabIds: computed(() => options.state.value.tabs.map((tab) => tab.id)),
      hydrated: options.hydrated,
      lingerMs: options.activityLingerMs
    })
  } catch (error) {
    diagnosticLogPreservation.dispose()
    throw error
  }

  function dispose(): void {
    disposeAll([
      mcpActivity.dispose,
      diagnosticLogPreservation.dispose
    ])
  }

  return {
    activeTab,
    diagnosticLogPreservationBusy: diagnosticLogPreservation.busy,
    updateDiagnosticLogPreservation: diagnosticLogPreservation.update,
    mcpActivityByTab: mcpActivity.activityByTab,
    dispose
  }
}

export type AppTabRuntimeFeatureController = ReturnType<
  typeof useAppTabRuntimeFeatureController
>
