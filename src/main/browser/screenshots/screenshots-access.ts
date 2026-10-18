import type { NativeImage, WebContents } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserVisualCompareContext } from '../../../shared/types.js'

/** The tab fields a screenshot reads. */
export interface ScreenshotsTab {
  id: string
  loading: boolean
  navigationGeneration: number
  webContents: WebContents
}

/**
 * What screenshots need from the tab manager, which keeps the tabs, the
 * active tab and split view, target validation, page presentation, the agent
 * pointer, the debugger lease, display scaling, the CSS state preview, the
 * observation context, the visual viewport reading and the tab overview
 * previews private. Visual comparison and PDF export use most of these too, so
 * they stay manager members.
 */
export interface ScreenshotsAccess<Tab extends ScreenshotsTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  validateTarget(target: { ref?: string; selector?: string }): void
  activeTabId(): string | null
  splitViewContains(tabId: string): boolean
  withRenderableTab<T>(tab: Tab, operation: () => Promise<T>, mode?: 'presented-frame' | 'surface' | 'print'): Promise<T>
  dismissAgentPointer(webContents: WebContents): Promise<void>
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  screenshotPixelRatio(tab: Tab): number
  cssStatePreviewActive(tab: Tab): boolean
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  visualCompareContext(tab: Tab): Promise<BrowserVisualCompareContext>
  storeTabOverviewPreview(tab: Tab, captured: NativeImage, navigationGeneration: number, enlarged: boolean): boolean
}
