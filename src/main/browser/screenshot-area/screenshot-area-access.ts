import type { WebContents, WebContentsView } from 'electron'
import type { BrowserNativeSelectionSession } from '../native-selection-session.js'

/** The area a person dragged on a page, in its viewport, or that they canceled. */
export interface BrowserScreenshotAreaResult {
  canceled: boolean
  clip?: { x: number; y: number; width: number; height: number }
  pageClip?: { x: number; y: number; width: number; height: number }
  viewport?: { width: number; height: number }
  url?: string
}

/** A screenshot area selection in progress on one page, with the drag the native mouse input has made so far. */
export interface BrowserScreenshotAreaSession extends BrowserNativeSelectionSession<BrowserScreenshotAreaResult> {
  start?: { x: number; y: number }
  current?: { x: number; y: number }
}

/** The tab fields selecting a screenshot area reads and writes: its page, view and address, and the native input generation a selection advances. */
export interface ScreenshotAreaTab {
  id: string
  url: string
  nativeInputEnvironmentGeneration: number
  view: WebContentsView
  webContents: WebContents
}

/**
 * What selecting and capturing a screenshot area needs from the tab manager,
 * which keeps the tabs, the selections in progress, the human input lock and
 * offscreen rendering private. The selections stay a manager field because
 * page input, closing tabs, sleeping and closing the browser read or end
 * them too.
 */
export interface ScreenshotAreaAccess<Tab extends ScreenshotAreaTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): Map<number, BrowserScreenshotAreaSession>
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** Applies the tab's human input lock to its page again, around the selection overlay. */
  syncHumanInteractionInputGuard(tab: Tab): Promise<void>
  /** Runs an operation that needs the tab's page rendered, presenting it offscreen when it is not on screen. */
  withRenderableTab<T>(tab: Tab, operation: () => Promise<T>): Promise<T>
}
