import { nextTick, watch, type Ref } from 'vue'
import type { DetachablePanelId } from '../../../shared/types.js'

// Native panel requests arrive as separate IPC tasks. Leave a short window for
// the newest request to win before mounting a panel and starting its pollers.
const PANEL_PRESENTATION_COALESCE_MS = 50

export interface DetachedPanelRefreshContext {
  tabId: string | null
  url?: string
  loading?: boolean
}

export interface DetachedPanelRefreshControllerOptions {
  detachedWindow: boolean
  activePanelId: Readonly<Ref<DetachablePanelId | null>>
  context: () => DetachedPanelRefreshContext
  activate: (panel: DetachablePanelId) => void
  refresh: (panel: DetachablePanelId) => Promise<void>
  onError: (error: unknown) => void
  waitForPresentationTurn?: () => Promise<void>
}

export function useDetachedPanelRefreshController(options: DetachedPanelRefreshControllerOptions) {
  let disposed = false
  let presentationSequence = 0
  let refreshSequence = 0

  function fail(error: unknown, sequence: number): void {
    if (!disposed && sequence === refreshSequence) options.onError(error)
  }

  function waitForPresentationTurn(): Promise<void> {
    if (options.waitForPresentationTurn) return options.waitForPresentationTurn()
    return new Promise((resolve) => window.setTimeout(resolve, PANEL_PRESENTATION_COALESCE_MS))
  }

  async function show(panel: DetachablePanelId): Promise<void> {
    const presentation = ++presentationSequence
    refreshSequence += 1
    try {
      await waitForPresentationTurn()
    } catch (error) {
      if (!disposed && presentation === presentationSequence) options.onError(error)
      return
    }
    if (disposed || presentation !== presentationSequence) return
    options.activate(panel)
    await nextTick()
    if (disposed || presentation !== presentationSequence || options.activePanelId.value !== panel) return
    const refresh = ++refreshSequence
    try {
      await options.refresh(panel)
    } catch (error) {
      fail(error, refresh)
    }
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
    presentationSequence += 1
    refreshSequence += 1
    stopContextWatch()
  }

  return { show, dispose }
}

export type DetachedPanelRefreshController = ReturnType<typeof useDetachedPanelRefreshController>
