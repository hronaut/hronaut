import type { WebContents, WebContentsView } from 'electron'
import type { BrowserEmulationState } from '../../../shared/types.js'

/**
 * The tab fields describing a tab's performance environment reads: its view
 * and page, its emulation with the extra request headers, and its zoom
 * isolation and default font size.
 */
export interface PerformanceEnvironmentTab {
  view: WebContentsView
  webContents: WebContents
  emulation: BrowserEmulationState
  emulationExtraHttpHeaders: Record<string, string>
  zoomIsolated: boolean
  defaultFontSize?: number
}

/**
 * What describing a tab's performance environment needs from the tab
 * manager: the check that the tab's emulation is confirmed, which stays a
 * manager method because emulation, input and captures use it too.
 */
export interface PerformanceEnvironmentAccess<Tab extends PerformanceEnvironmentTab> {
  /** Throws unless the tab's emulation is known to be applied. */
  requireEmulationConfirmed(tab: Tab): void
}
