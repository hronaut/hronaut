import type { WebContents } from 'electron'
import type { BrowserElementPickerSession } from '../element-picker/element-picker-access.js'
import type { BrowserScreenshotAreaSession } from '../screenshot-area/screenshot-area-access.js'

/** The tab field ending a page's native selections reads: its page. */
export interface NativeSelectionsTab {
  webContents: WebContents
}

/**
 * What ending a page's screenshot area selection and element picker needs
 * from the tab manager, which keeps the selections in progress and the human
 * input lock private. The selections stay manager fields because the
 * screenshot area, the element picker, page input, sleeping and closing the
 * browser read or end them too.
 */
export interface NativeSelectionsAccess<Tab extends NativeSelectionsTab> {
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): Map<number, BrowserScreenshotAreaSession>
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): Map<number, BrowserElementPickerSession>
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** Applies the tab's human input lock to its page again, now that no selection overlay is in the way. */
  syncHumanInteractionInputGuard(tab: Tab): Promise<void>
}
