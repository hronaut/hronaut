import type { WebContents } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserScreenshotClip, BrowserVisualCompareReport, BrowserVisualSnapshot } from '../../../shared/types.js'

/** One normalized viewport or region capture, as the tab manager's visual capture returns it. */
export interface VisualCompareCapture {
  observationContext: BrowserSnapshotDeltaContext
  navigationGeneration: number
  snapshot: BrowserVisualSnapshot
  png: Buffer
  bitmap: Buffer
}

/**
 * The tab fields visual comparison reads. The baseline and latest diff belong
 * to the tab, so the tab manager's navigation and close handling stay
 * authoritative for discarding them.
 */
export interface VisualCompareTab {
  id: string
  title: string
  url: string
  webContents: WebContents
  visualComparison?: {
    baseline: Pick<VisualCompareCapture, 'snapshot' | 'png' | 'navigationGeneration'>
    lastReport?: BrowserVisualCompareReport
    diffPng?: Buffer
  }
  visualComparisonGeneration: number
}

/**
 * What visual comparison needs from the tab manager, which keeps the tabs,
 * observation context and page capture private. Page capture stays in the
 * manager alongside the screenshot capture that shares its viewport context.
 */
export interface VisualCompareAccess<Tab extends VisualCompareTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  captureVisual(tab: Tab, settleMs: number, clip?: BrowserScreenshotClip): Promise<VisualCompareCapture>
}
