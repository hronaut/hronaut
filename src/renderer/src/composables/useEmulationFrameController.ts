import { ref } from 'vue'
import type { BrowserState, BrowserViewportEmulation } from '../../../shared/types.js'
import type { EmulationFrameGeometry, HronautEmulationFrameApi } from '../../../shared/emulation-frame.js'

/** The viewport sizes Responsive preview accepts. */
const VIEWPORT_MIN = 200
const VIEWPORT_MAX = 3840

export type EmulationFrameAction = 'rotate' | 'fit' | 'reset'

export interface EmulationFrameControllerOptions {
  api: HronautEmulationFrameApi
  setTabViewport: (tabId: string, viewport: BrowserViewportEmulation | null) => Promise<BrowserState>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  beginMutation: () => number
  /** Whether no newer viewport or emulation change, here or elsewhere in the shell, has started. */
  isMutationCurrent: (sequence: number) => boolean
  /** A frame action changed the tab's viewport and nothing newer started since. */
  onApplied: (tabId: string) => void
}

export function rotatedViewport(viewport: BrowserViewportEmulation): BrowserViewportEmulation {
  return {
    ...viewport,
    width: viewport.height,
    height: viewport.width,
    orientation: viewport.orientation === 'portrait' ? 'landscape' : 'portrait'
  }
}

/** The same device conditions at the size of the space the tab has. */
export function fittedViewport(viewport: BrowserViewportEmulation, available: { width: number; height: number }): BrowserViewportEmulation {
  const size = (value: number): number => Math.min(VIEWPORT_MAX, Math.max(VIEWPORT_MIN, Math.floor(value)))
  const width = size(available.width)
  const height = size(available.height)
  return { ...viewport, width, height, orientation: width > height ? 'landscape' : 'portrait' }
}

export function useEmulationFrameController(options: EmulationFrameControllerOptions) {
  const frames = ref<EmulationFrameGeometry[]>([])
  const pending = ref<Record<string, EmulationFrameAction>>({})
  const failed = ref<Record<string, true>>({})
  let changedBeforeRead = false
  let disposed = false

  function without<T>(record: Record<string, T>, tabId: string): Record<string, T> {
    const { [tabId]: _removed, ...rest } = record
    return rest
  }

  const viewportKey = (frame: EmulationFrameGeometry | undefined): string => JSON.stringify(frame?.viewport ?? null)

  const unsubscribe = options.api.onChanged((next) => {
    if (disposed) return
    changedBeforeRead = true
    const previous = frames.value
    frames.value = next
    // An error belongs to the viewport it was shown on: a tab no longer framed,
    // or one whose viewport changed since, such as from Responsive preview or an agent, starts clean.
    failed.value = Object.fromEntries(Object.entries(failed.value).filter(([tabId]) => {
      const frame = next.find((candidate) => candidate.tabId === tabId)
      return frame !== undefined && viewportKey(frame) === viewportKey(previous.find((candidate) => candidate.tabId === tabId))
    }))
  })
  // A change published while the first read is in flight is newer than that read.
  void options.api.get().then((current) => {
    if (!disposed && !changedBeforeRead) frames.value = current
  }, () => undefined)

  async function run(frame: EmulationFrameGeometry, action: EmulationFrameAction): Promise<void> {
    if (disposed || pending.value[frame.tabId]) return
    const viewport = action === 'rotate'
      ? rotatedViewport(frame.viewport)
      : action === 'fit' ? fittedViewport(frame.viewport, frame.available) : null
    const mutation = options.beginMutation()
    pending.value = { ...pending.value, [frame.tabId]: action }
    failed.value = without(failed.value, frame.tabId)
    // A newer viewport change, here or in Responsive preview, supersedes this one's outcome.
    const current = (): boolean => !disposed && options.isMutationCurrent(mutation)
    try {
      await options.syncState(options.setTabViewport(frame.tabId, viewport))
      // Fit and Use window size usually remove the frame before this point.
      if (current()) options.onApplied(frame.tabId)
    } catch {
      // Without its frame, the address bar shows the tab's unconfirmed emulation instead.
      if (current() && frames.value.some((candidate) => candidate.tabId === frame.tabId)) failed.value = { ...failed.value, [frame.tabId]: true }
    } finally {
      if (!disposed) pending.value = without(pending.value, frame.tabId)
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    unsubscribe()
  }

  return { frames, pending, failed, run, dispose }
}
