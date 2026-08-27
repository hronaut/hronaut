import { ref } from 'vue'
import type {
  HronautPanelWindowApi,
  DetachablePanelId,
  PanelRedockRequest
} from '../../../shared/types.js'
import { disposeAll, registerDisposers } from './dispose-all.js'

export interface PanelWindowEventsControllerOptions {
  api: Pick<
    HronautPanelWindowApi,
    'onPanelRequested' | 'onActivePanelChanged' | 'onRedockRequested' | 'onClosed'
  >
  detachedWindow: boolean
  showDetachedPanel: (panel: DetachablePanelId) => unknown
  activateMainPanel: (panel: DetachablePanelId) => unknown
  redockMainPanel: (request: PanelRedockRequest) => unknown
  closeMainPanels: () => unknown
  onError: (error: unknown) => void
}

export function usePanelWindowEventsController(options: PanelWindowEventsControllerOptions) {
  const syncingMainPanelState = ref(false)
  let resetTimer: number | undefined
  let disposed = false

  function reportError(error: unknown): void {
    if (!disposed) options.onError(error)
  }

  function invoke(callback: () => unknown): void {
    if (disposed) return
    try {
      void Promise.resolve(callback()).catch(reportError)
    } catch (error) {
      reportError(error)
    }
  }

  function finishDisposal(): void {
    if (resetTimer !== undefined) window.clearTimeout(resetTimer)
    resetTimer = undefined
    syncingMainPanelState.value = false
  }

  const unsubscribers = registerDisposers([
    () => options.api.onPanelRequested((panel) => {
      if (options.detachedWindow) invoke(() => options.showDetachedPanel(panel))
    }),
    () => options.api.onActivePanelChanged((panel) => {
      if (disposed || options.detachedWindow) return
      syncingMainPanelState.value = true
      invoke(() => options.activateMainPanel(panel))
      if (resetTimer !== undefined) window.clearTimeout(resetTimer)
      resetTimer = window.setTimeout(() => {
        resetTimer = undefined
        if (!disposed) syncingMainPanelState.value = false
      }, 0)
    }),
    () => options.api.onRedockRequested((request) => {
      if (!options.detachedWindow) invoke(() => options.redockMainPanel(request))
    }),
    () => options.api.onClosed(() => {
      if (!options.detachedWindow) invoke(options.closeMainPanels)
    })
  ], () => {
    disposed = true
    finishDisposal()
  })

  function dispose(): void {
    if (disposed) return
    disposed = true
    try {
      disposeAll(unsubscribers)
    } finally {
      finishDisposal()
    }
  }

  return { syncingMainPanelState, dispose }
}

export type PanelWindowEventsController = ReturnType<typeof usePanelWindowEventsController>
