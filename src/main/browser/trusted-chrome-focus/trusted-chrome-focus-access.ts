import type { BrowserWindow, WebContents } from 'electron'

/** The tab field focusing a page reads: its page. */
export interface TrustedChromeFocusTab {
  webContents: WebContents
}

/**
 * A page waiting to take focus once trusted chrome closes, and how to stop waiting; no page while every page is kept from
 * the keyboard until then.
 */
export interface PendingTrustedChromeFocus<Tab extends TrustedChromeFocusTab> {
  tab?: Tab
  cancel: () => void
}

/**
 * What focusing a page around trusted chrome needs from the tab manager,
 * which keeps the window, the human interaction lock, agent input, trusted
 * chrome occlusion and the pending focus private. The pending focus stays a
 * manager field because closing trusted chrome and destroying the manager
 * end it too; it is read again at every use.
 */
export interface TrustedChromeFocusAccess<Tab extends TrustedChromeFocusTab> {
  /** The browser window. */
  window(): BrowserWindow
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** The pages receiving agent input, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** Whether trusted chrome covers the page area. */
  browserContentOccluded(): boolean
  /** The page waiting to take focus once trusted chrome closes. */
  focusAfterTrustedChrome(): PendingTrustedChromeFocus<Tab> | undefined
  setFocusAfterTrustedChrome(pending: PendingTrustedChromeFocus<Tab> | undefined): void
}
