import type { BrowserWindow, WebContents } from 'electron'
import type { BrowserPageLifecycleState } from '../../../shared/types.js'
import type { BrowserVideoRecorder } from '../video-recorder.js'

/**
 * The tab fields recording a tab's video reads: its id, address and
 * workspace, its page, whether it sleeps or is frozen, and its navigation
 * generation.
 */
export interface VideoRecordingTab {
  id: string
  url: string
  mcpGroupId?: string
  webContents: WebContents
  sleeping: boolean
  pageLifecycleState: BrowserPageLifecycleState
  navigationGeneration: number
}

/**
 * What recording, inspecting and previewing a tab's video needs from the tab
 * manager, which keeps the tabs, the window, trusted chrome occlusion, page
 * presentation and the video recorder private. Each is read again at every
 * frame and check.
 */
export interface VideoRecordingAccess<Tab extends VideoRecordingTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Whether the tab manager was destroyed. */
  isDestroyed(): boolean
  /** The browser window. */
  window(): BrowserWindow
  /** Whether trusted chrome covers the page area. */
  browserContentOccluded(): boolean
  /** Runs the operation while the tab's page renders, even when it is hidden. */
  withRenderableTab<T>(tab: Tab, operation: () => Promise<T>): Promise<T>
  /** The video recorder. */
  videoRecorder(): Pick<BrowserVideoRecorder, 'manage' | 'inspect' | 'preview'>
}
