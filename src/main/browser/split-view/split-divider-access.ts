import type { BrowserSplitViewState, SplitDividerGeometry } from '../../../shared/split-view.js'

/**
 * What dragging the split view's divider needs from the tab manager, which
 * keeps the split view and its generation, the divider's geometry, layout
 * and state publication private. The split view and its generation stay
 * manager fields because opening, closing, layout and restoring tabs read and
 * write them too; they are read again at every use.
 */
export interface SplitDividerAccess {
  /** The divider's geometry as the shell should show it now, or null without a split view. */
  getSplitDivider(): SplitDividerGeometry | null
  /** The split view, or null. */
  splitView(): BrowserSplitViewState | null
  /** The split view's generation, which a committed ratio advances. */
  splitViewGeneration(): number
  /** Records the split view's generation. */
  writeSplitViewGeneration(generation: number): void
  /** Lays out the visible tabs. */
  layout(): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
}
