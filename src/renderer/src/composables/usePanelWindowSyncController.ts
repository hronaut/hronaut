import { watch, type Ref } from 'vue'
import type {
  HronautPanelWindowApi,
  DetachablePanelId,
  PanelDock
} from '../../../shared/types.js'

export interface PanelWindowSyncControllerOptions {
  api: Pick<HronautPanelWindowApi, 'open' | 'close' | 'setActive' | 'redock'>
  detachedWindow: boolean
  panelDock: Ref<PanelDock>
  activePanelId: Readonly<Ref<DetachablePanelId | null>>
  syncingMainPanelState: Readonly<Ref<boolean>>
  persistDock: (dock: PanelDock) => void
  onError: (error: unknown) => void
}

export function usePanelWindowSyncController(options: PanelWindowSyncControllerOptions) {
  let disposed = false
  let lastDock = options.panelDock.value
  let dockSequence = 0

  function fail(error: unknown, recover?: () => void): void {
    if (disposed) return
    recover?.()
    options.onError(error)
  }

  function run(operation: () => Promise<void>, recover?: () => void): void {
    if (disposed) return
    try {
      void operation().catch((error: unknown) => fail(error, recover))
    } catch (error) {
      fail(error, recover)
    }
  }

  function restoreDock(dock: PanelDock): void {
    if (!disposed && options.panelDock.value !== dock) options.panelDock.value = dock
  }

  const stopDockWatch = watch(options.panelDock, (dock) => {
    const sequence = ++dockSequence
    const previousDock = lastDock
    lastDock = dock
    const panel = options.activePanelId.value
    const recoverCurrentDock = (): void => {
      if (
        sequence === dockSequence
        && options.panelDock.value === dock
        && options.activePanelId.value === panel
      ) restoreDock(previousDock)
    }
    if (options.detachedWindow) {
      if (dock !== 'window' && panel) {
        run(() => options.api.redock(panel, dock), recoverCurrentDock)
      }
      return
    }
    try {
      options.persistDock(dock)
    } catch (error) {
      fail(error)
    }
    if (dock === 'window' && panel) {
      run(() => options.api.open(panel), recoverCurrentDock)
    }
  })

  const stopActivePanelWatch = watch(options.activePanelId, (panel) => {
    if (options.detachedWindow) {
      run(() => panel ? options.api.setActive(panel) : options.api.close())
      return
    }
    if (options.syncingMainPanelState.value || options.panelDock.value !== 'window') return
    run(() => panel ? options.api.open(panel) : options.api.close())
  })

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopDockWatch()
    stopActivePanelWatch()
  }

  return { dispose }
}

export type PanelWindowSyncController = ReturnType<typeof usePanelWindowSyncController>
