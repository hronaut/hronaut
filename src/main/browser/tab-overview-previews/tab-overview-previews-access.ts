import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { BrowserEmulationState, BrowserTabOverviewPreview } from '../../../shared/types.js'
import type { NativePreviewCapture } from '../native-preview-capture.js'
import type { PreviewCaptureQueue } from '../preview-capture-queue.js'

/** How an overview capture reads the page: the frame in view, or a hidden page behind the overview. */
export type TabOverviewPreviewCaptureMode = 'visible' | 'overview'

/** One queued overview capture of a tab, superseded by a newer sequence. */
export interface TabOverviewPreviewCaptureRequest<Tab> {
  tab: Tab
  sequence: number
  mode: TabOverviewPreviewCaptureMode
}

/**
 * The tab fields overview previews read. The preview sequence belongs to the
 * tab, so the tab manager's navigation and renderer handling can supersede a
 * capture that is already under way.
 */
export interface TabOverviewPreviewsTab {
  id: string
  url: string
  loading: boolean
  sleeping: boolean
  wakePromise?: Promise<void>
  navigationGeneration: number
  overviewPreviewSequence: number
  view: WebContentsView
  webContents: WebContents
  emulation: Pick<BrowserEmulationState, 'viewport'>
}

/**
 * What overview previews need from the tab manager, which keeps the tabs, the
 * window, the split view, the debugger lease and every preview cache, timer
 * and queue private. The caches stay manager fields because the tab lifecycle
 * also clears them on sleep, navigation, renderer loss and close.
 */
export interface TabOverviewPreviewsAccess<Tab extends TabOverviewPreviewsTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  tabs(): IterableIterator<Tab>
  isDestroyed(): boolean
  window(): BrowserWindow
  browserContentOccluded(): boolean
  activeTabId(): string | null
  splitViewContains(tabId: string): boolean
  isDevToolsOpening(webContentsId: number): boolean
  screenshotPixelRatio(tab: Tab): number
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  withRenderableTab<T>(tab: Tab, operation: () => Promise<T>, mode: 'surface'): Promise<T>
  scheduleTabOverviewPreview(tab: Tab): void
  tabOverviewPreviews(): Map<string, BrowserTabOverviewPreview>
  tabOverviewSleepPreviews(): Map<string, BrowserTabOverviewPreview>
  tabOverviewPageCaptures(): Map<string, Promise<BrowserTabOverviewPreview>>
  tabOverviewPreviewTimers(): Map<string, NodeJS.Timeout>
  tabOverviewPreviewCaptures(): PreviewCaptureQueue<TabOverviewPreviewCaptureRequest<Tab>>
  tabOverviewPreviewableTabs(): Set<string>
  tabOverviewLiveCaptureCursor(): number
  setTabOverviewLiveCaptureCursor(cursor: number): void
  nativePreviewCapture(): NativePreviewCapture
}
