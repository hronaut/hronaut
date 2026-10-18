import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import type { NativePreviewCapture } from '../native-preview-capture.js'

/** The tab fields an agent step thumbnail reads: its page and view, whether it sleeps or loads, and its navigation generation. */
export interface AgentStepThumbnailTab {
  webContents: WebContents
  view: WebContentsView
  sleeping: boolean
  loading: boolean
  navigationGeneration: number
}

/**
 * What picturing a tab after an agent's step needs from the tab manager,
 * which keeps the tabs, workspaces, window, occlusion, active tab, split view
 * and native frame capture private. Each is read again at every check.
 */
export interface AgentStepThumbnailAccess<Tab extends AgentStepThumbnailTab> {
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Whether the tab belongs to the workspace. */
  tabBelongsToMcpGroup(workspaceId: string, tabId: string): boolean
  /** Whether the tab manager was destroyed. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** Whether trusted chrome covers the page area. */
  browserContentOccluded(): boolean
  /** The active tab's id. */
  activeTabId(): string | null
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** The native capture of the frame a page shows. */
  nativePreviewCapture(): NativePreviewCapture
}
