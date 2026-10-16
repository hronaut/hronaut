import type { Rectangle } from 'electron'
import type { BrowserViewportEmulation } from './types.js'

/**
 * A tab emulating a viewport smaller than the space it could fill. Bounds are
 * shell CSS pixels, so the renderer can draw a frame around the page.
 */
export interface EmulationFrameGeometry {
  tabId: string
  /** The page itself, sized and centered to the emulated viewport. */
  bounds: Rectangle
  /** The space the page would fill without a viewport emulation. */
  area: Rectangle
  /** The emulated viewport, in the window's device-independent pixels. */
  viewport: BrowserViewportEmulation
  /** The size of the space in the same pixels as `viewport`, for fitting the viewport to it. */
  available: { width: number; height: number }
}

/** CSS pixels above the page for the frame's caption bar, when the space allows it. */
export const EMULATION_FRAME_CAPTION_SPACE = 36

export interface HronautEmulationFrameApi {
  get(): Promise<EmulationFrameGeometry[]>
  onChanged(listener: (frames: EmulationFrameGeometry[]) => void): () => void
}

/**
 * Where a tab's page goes in the space it has. An emulated viewport smaller
 * than that space keeps its exact size, centered, so the space around it can
 * show what is emulated; a dimension the space cannot fit fills it, as before.
 * When the space is a little taller than the page, the page moves down just
 * enough to leave `captionSpace` above it for the caption bar.
 */
export function emulatedViewBounds(
  area: Rectangle,
  viewport?: Pick<BrowserViewportEmulation, 'width' | 'height'>,
  captionSpace = 0
): Rectangle {
  if (!viewport) return area
  const width = Math.max(1, Math.min(area.width, Math.round(viewport.width)))
  const height = Math.max(1, Math.min(area.height, Math.round(viewport.height)))
  const spare = area.height - height
  const top = spare >= captionSpace ? Math.max(Math.floor(spare / 2), captionSpace) : Math.floor(spare / 2)
  return { x: area.x + Math.floor((area.width - width) / 2), y: area.y + top, width, height }
}
