import type { WebContents, WebContentsView } from 'electron'
import type { ScreenshotAnnotationReport } from '../../../shared/screenshot-annotations.js'
import type { BrowserScreenshotOptions } from '../../../shared/types.js'
import type { BrowserNativeSelectionSession } from '../native-selection-session.js'

/** What the element picker's page script resolves: the element's raw inspection, or that the person canceled. */
export interface BrowserElementPickerScriptResult {
  canceled: boolean
  inspection?: unknown
}

/** An element picker in progress on one page, with whether the person's native mouse button is down. */
export interface BrowserElementPickerSession extends BrowserNativeSelectionSession<BrowserElementPickerScriptResult> {
  pointerDown: boolean
}

/** The element the person picked, formatted for an agent, or that they canceled. */
export interface BrowserElementPickerResult {
  canceled: boolean
  content?: string
}

/** The tab fields the element picker reads and writes: its page, view, title and address, and the native input generation a pick advances. */
export interface ElementPickerTab {
  id: string
  title: string
  url: string
  nativeInputEnvironmentGeneration: number
  view: WebContentsView
  webContents: WebContents
}

/**
 * What picking an element on a page needs from the tab manager, which keeps
 * the tabs, the pickers in progress, the human input lock and screenshots
 * private. The pickers stay a manager field because page input, closing
 * tabs, sleeping and closing the browser read or end them too.
 */
export interface ElementPickerAccess<Tab extends ElementPickerTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): Map<number, BrowserElementPickerSession>
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** Applies the tab's human input lock to its page again, around the picker overlay. */
  syncHumanInteractionInputGuard(tab: Tab): Promise<void>
  /** Captures a screenshot of the page or of one element. */
  screenshot(options: BrowserScreenshotOptions): Promise<{ annotations?: ScreenshotAnnotationReport; data: Buffer; mimeType: 'image/png' | 'image/jpeg' }>
}
