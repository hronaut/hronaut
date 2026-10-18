import type { WebContents, WebContentsView } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserEmulationState } from '../../../shared/types.js'

/** The tab fields a visual capture reads: its id and address, its view and page, and its emulated viewport. */
export interface VisualCaptureTab {
  id: string
  url: string
  view: WebContentsView
  webContents: WebContents
  emulation: BrowserEmulationState
}

/**
 * What a visual capture needs from the tab manager, which keeps the tabs, the
 * observation context, page presentation, the agent pointer and the emulation
 * confirmation check private.
 */
export interface VisualCaptureAccess<Tab extends VisualCaptureTab> {
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The tab's observation context, which changes when its page does. */
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  /** Runs the operation while the tab's page renders, even when it is hidden. */
  withRenderableTab<T>(tab: Tab, operation: () => Promise<T>): Promise<T>
  /** Takes the agent's cursor off the page. */
  dismissAgentPointer(webContents: WebContents): Promise<void>
  /** Throws unless the tab's emulation is known to be applied. */
  requireEmulationConfirmed(tab: Tab): void
}
