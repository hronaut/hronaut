import { nextTick, onScopeDispose, shallowRef } from 'vue'
import type { BrowserOcclusionSnapshot, HronautShellApi } from '../../../shared/types.js'

type OcclusionSnapshotApi = Pick<HronautShellApi, 'onOcclusionSnapshot' | 'presentOcclusionSnapshot'>

interface OcclusionSnapshotOptions {
  /** Resolves once the image can be painted without a decode delay. */
  decode?: (src: string) => Promise<void>
  /** Resolves after a frame containing the current DOM has been produced. */
  afterPaint?: () => Promise<void>
  /** How long the snapshot stays under the page views after they are shown again. */
  clearDelayMs?: number
}

function decodeImage(src: string): Promise<void> {
  const image = new Image()
  image.src = src
  return image.decode()
}

function afterTwoFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * Shows main's still image of the pages under trusted chrome. Main keeps the
 * page views on screen until this confirms the image has been painted, so the
 * page area never shows the empty window behind them.
 */
export function useOcclusionSnapshotController(api: OcclusionSnapshotApi | undefined, options: OcclusionSnapshotOptions = {}) {
  const decode = options.decode ?? decodeImage
  const afterPaint = options.afterPaint ?? afterTwoFrames
  const clearDelayMs = options.clearDelayMs ?? 150
  const snapshot = shallowRef<BrowserOcclusionSnapshot | null>(null)
  // Every message from main replaces the previous one, including a pending clear.
  let generation = 0
  let clearTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  async function show(next: BrowserOcclusionSnapshot, current: number): Promise<void> {
    try {
      await Promise.all(next.panes.map((pane) => decode(pane.image)))
    } catch {
      // An image that cannot be shown leaves the old behavior: main hides the pages at once.
      if (current === generation && !disposed) api?.presentOcclusionSnapshot(next.id)
      return
    }
    if (current !== generation || disposed) return
    snapshot.value = next
    await nextTick()
    await afterPaint()
    if (current === generation && !disposed) api?.presentOcclusionSnapshot(next.id)
  }

  async function clear(current: number): Promise<void> {
    // The page views are shown again first; keep the image under them until they have painted.
    await afterPaint()
    if (current !== generation || disposed) return
    clearTimer = setTimeout(() => {
      clearTimer = undefined
      if (current === generation && !disposed) snapshot.value = null
    }, clearDelayMs)
  }

  const unsubscribe = api?.onOcclusionSnapshot((next) => {
    const current = ++generation
    if (clearTimer !== undefined) {
      clearTimeout(clearTimer)
      clearTimer = undefined
    }
    if (next) void show(next, current)
    else void clear(current)
  })

  onScopeDispose(() => {
    disposed = true
    if (clearTimer !== undefined) clearTimeout(clearTimer)
    unsubscribe?.()
  })

  return { snapshot }
}
