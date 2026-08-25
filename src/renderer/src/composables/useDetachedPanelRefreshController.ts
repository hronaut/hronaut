import { watch, type Ref } from 'vue'
import type { DetachablePanelId } from '../../../shared/types.js'

export interface DetachedPanelRefreshContext {
  tabId: string | null
  url?: string
  loading?: boolean
}

export interface DetachedPanelRefreshControllerOptions {
  detachedWindow: boolean
  activePanelId: Readonly<Ref<DetachablePanelId | null>>
  context: () => DetachedPanelRefreshContext
  refresh: (panel: DetachablePanelId) => Promise<void>
  onError: (error: unknown) => void
}

export function useDetachedPanelRefreshController(options: DetachedPanelRefreshControllerOptions) {
  let disposed = false
  let refreshSequence = 0

  function fail(error: unknown, sequence: number): void {
    if (!disposed && sequence === refreshSequence) options.onError(error)
  }

  const stopContextWatch = watch(
    () => {
      const context = options.context()
      return [context.tabId, context.url, context.loading] as const
    },
    ([tabId, url, loading], [previousTabId, previousUrl, previousLoading]) => {
      const sequence = ++refreshSequence
      if (
        !options.detachedWindow
        || !tabId
        || !url
        || url.startsWith('hronaut://home')
        || loading
      ) return
      if (tabId === previousTabId && url === previousUrl && previousLoading !== true) return
      const panel = options.activePanelId.value
      if (!panel) return
      try {
        void options.refresh(panel).catch((error: unknown) => fail(error, sequence))
      } catch (error) {
        fail(error, sequence)
      }
    }
  )

  function dispose(): void {
    if (disposed) return
    disposed = true
    refreshSequence += 1
    stopContextWatch()
  }

  return { dispose }
}

export type DetachedPanelRefreshController = ReturnType<typeof useDetachedPanelRefreshController>
