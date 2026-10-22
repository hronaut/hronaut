import type { Rectangle } from 'electron'
import type { BrowserOcclusionSnapshot } from '../../shared/types.js'
import { RendererExitedError } from './renderer-exit-guard.js'
import { PrintDialogOpenError } from './print-dialog-guard.js'

export const OCCLUSION_SNAPSHOT_TIMEOUT_MS = 250
const OCCLUSION_SNAPSHOT_JPEG_QUALITY = 85

export interface OcclusionSnapshotImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number; quality?: 'good' | 'better' | 'best' }): OcclusionSnapshotImage
  toJPEG(quality: number): Buffer
}

export interface OcclusionSnapshotPane {
  contents: { capturePage(rect: undefined, options: { stayHidden: boolean; stayAwake: boolean }): Promise<OcclusionSnapshotImage> }
  /** The page view's bounds in window coordinates. */
  bounds: Rectangle
  /** Settles when another capture of this page, such as its tab preview, is done; this one waits for it. */
  busy?: Promise<void>
}

export interface OcclusionSnapshotPorts {
  /** Pages on screen that can be captured now. */
  panes(): OcclusionSnapshotPane[]
  /** Identifies the window layout a snapshot belongs to; a different value means it would be misplaced. */
  layout(): string
  /** Shell zoom factor, to convert view bounds to shell CSS pixels. */
  cssScale(): number
  /** Display scale factor, so the image keeps every device pixel of the page. */
  deviceScale(): number
  send(snapshot: BrowserOcclusionSnapshot | null): void
  /** Lay the page views out again, which hides them once nothing holds them on screen. */
  relayout(): void
  /** The page views are off the screen under trusted chrome, with or without a snapshot. */
  pagesHidden(): void
  timeoutMs?: number
}

/**
 * Trusted chrome hides the native page views to draw above them. Hiding them
 * at once leaves the page area blank until the shell paints, so the views stay
 * on screen until the shell confirms it shows a still image of them, or the
 * deadline passes.
 */
export class OcclusionSnapshot {
  private pending: { id: number; layout: string; timer: ReturnType<typeof setTimeout> } | null = null
  private shown: { layout: string } | null = null
  private sequence = 0
  // A page whose capture never settles, such as a hung renderer, is not captured again on every dialog.
  private readonly capturing = new WeakSet<object>()

  constructor(private readonly ports: OcclusionSnapshotPorts) {}

  /** The page views must stay on screen: their snapshot is not shown yet. */
  get holdingPages(): boolean { return this.pending !== null }

  /** A snapshot is on its way or on screen. */
  get active(): boolean { return this.pending !== null || this.shown !== null }

  begin(): void {
    this.end()
    const panes = this.ports.panes().filter((pane) => !this.capturing.has(pane.contents))
    if (!panes.length) {
      // Nothing to capture, such as a sleeping or minimized page: the views leave the screen at once.
      this.ports.pagesHidden()
      return
    }
    const id = ++this.sequence
    const timer = setTimeout(() => this.finish(id), this.ports.timeoutMs ?? OCCLUSION_SNAPSHOT_TIMEOUT_MS)
    this.pending = { id, layout: this.ports.layout(), timer }
    void this.capture(id, panes)
  }

  /** The shell shows the snapshot with this ID, so the pages can leave the screen. */
  present(id: number): void {
    this.finish(id)
  }

  /** Withdraws a shown snapshot that no longer lines up with the window. */
  reconcile(): void {
    if (this.shown && !this.pending && this.shown.layout !== this.ports.layout()) this.end()
  }

  end(): void {
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    if (!this.shown) return
    this.shown = null
    this.ports.send(null)
  }

  dispose(): void {
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    this.shown = null
  }

  private finish(id: number): void {
    if (this.pending?.id !== id) return
    clearTimeout(this.pending.timer)
    this.pending = null
    this.ports.relayout()
    this.ports.pagesHidden()
  }

  private async capture(id: number, panes: OcclusionSnapshotPane[]): Promise<void> {
    try {
      const captured = await Promise.all(panes.map(async (pane) => {
        this.capturing.add(pane.contents)
        try {
          // Two native captures of one page must not overlap; a preview takes a few milliseconds, well within the deadline.
          if (pane.busy) {
            await pane.busy
            if (this.pending?.id !== id) throw new Error('Occlusion snapshot was replaced')
          }
          // Do not wake a hidden page or count as a visible viewer of it. A crashed pane, or one its print dialog
          // holds, has no picture; the other pane's snapshot still shows.
          const image = await pane.contents.capturePage(undefined, { stayHidden: true, stayAwake: false }).catch((error: unknown) => {
            if (error instanceof RendererExitedError || error instanceof PrintDialogOpenError) return undefined
            throw error
          })
          return { pane, image }
        } finally {
          this.capturing.delete(pane.contents)
        }
      }))
      const pending = this.pending
      if (pending?.id !== id) return
      // A resize or tab switch during the capture would put the snapshot in the wrong place.
      if (pending.layout !== this.ports.layout()) {
        this.finish(id)
        return
      }
      const cssScale = this.ports.cssScale()
      const deviceScale = this.ports.deviceScale()
      const snapshotPanes = captured.flatMap(({ pane, image }) => {
        if (!image || image.isEmpty()) return []
        const width = Math.max(1, Math.round(pane.bounds.width * deviceScale))
        const sized = image.getSize().width > width ? image.resize({ width, quality: 'good' }) : image
        return [{
          bounds: { x: pane.bounds.x / cssScale, y: pane.bounds.y / cssScale, width: pane.bounds.width / cssScale, height: pane.bounds.height / cssScale },
          image: `data:image/jpeg;base64,${sized.toJPEG(OCCLUSION_SNAPSHOT_JPEG_QUALITY).toString('base64')}`
        }]
      })
      if (!snapshotPanes.length) {
        this.finish(id)
        return
      }
      this.shown = { layout: pending.layout }
      this.ports.send({ id, panes: snapshotPanes })
    } catch {
      this.finish(id)
    }
  }
}
