import type { Rectangle } from 'electron'
import type { PanelDock } from './types.js'

/**
 * The page sits in the shell as a rounded card. Lengths are shell CSS pixels;
 * the main process scales them by the shell zoom like the other shell metrics.
 */
export const PAGE_CARD_GUTTER = 10
export const PAGE_CARD_RADIUS = 12

export interface PageCardInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PageCardInsetOptions {
  /** The vertical tab rail's width, or 0 when the tabs sit above the page. */
  railWidth: number
  dock: PanelDock
  /** The docked panel's size, or 0 when no docked panel is open. */
  dockSize: number
  /** How far a side panel reaches in from the right edge of the window. */
  sidePanelInset: number
}

/**
 * The page's insets from the window below the toolbar. A gutter separates the
 * card from the window edges and from a docked or side panel. The toolbar's own
 * bottom padding spaces it from the top, and the rail's padding from the left.
 */
export function pageCardInsets(options: PageCardInsetOptions): PageCardInsets {
  const docked = (side: PanelDock): number => options.dock === side ? options.dockSize : 0
  const top = docked('top')
  const left = docked('left')
  return {
    top: top > 0 ? top + PAGE_CARD_GUTTER : 0,
    right: Math.max(docked('right'), options.sidePanelInset) + PAGE_CARD_GUTTER,
    bottom: docked('bottom') + PAGE_CARD_GUTTER,
    left: options.railWidth + (left > 0 ? left + PAGE_CARD_GUTTER : options.railWidth > 0 ? 0 : PAGE_CARD_GUTTER)
  }
}

/** Where a page in view sits, in shell CSS pixels, and which tab it shows. */
export interface PageCardGeometry extends Rectangle {
  tabId: string
}

/** The page cards, one per pane, which the main process publishes as it places the pages. */
export interface HronautPageCardApi {
  get(): Promise<PageCardGeometry[]>
  onChanged(listener: (cards: PageCardGeometry[]) => void): () => void
}
