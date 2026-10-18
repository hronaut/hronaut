import type { WebContents } from 'electron'

/** The tab field agent input authorization reads: the page whose input it admits. */
export interface AgentInputAuthorizationTab {
  webContents: WebContents
}

/**
 * The one mouse event an agent's native input command is about to produce, in
 * Electron's terms, so the page's input guard admits exactly that event while
 * the person's input is locked.
 */
export interface AuthorizedAgentMouseInput {
  type: Electron.MouseInputEvent['type']
  x: number
  y: number
  button: Electron.MouseInputEvent['button'] | undefined
  buttons: number
  clickCount: number
  modifiers: number
}

/**
 * The one key event an agent's native input command is about to produce, in
 * Electron's terms, so the page's input guard admits exactly that event.
 */
export interface AuthorizedAgentKeyboardInput {
  type: Electron.Input['type']
  key: string
  code: string
  modifiers: number
  autoRepeat: boolean
}

/**
 * What authorizing an agent's native input needs from the tab manager, which
 * keeps the tabs, the page-to-tab index, the human interaction lock and the
 * authorized input records private. The records stay manager fields because
 * closing the browser clears them; their maps are read and written in place.
 */
export interface AgentInputAuthorizationAccess<Tab extends AgentInputAuthorizationTab> {
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The id of the tab showing the page with this WebContents id. */
  tabIdForWebContents(webContentsId: number): string | undefined
  /** Whether human input to the tab is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** The mouse event each page's guard admits next, by WebContents id. */
  authorizedAgentMouseInput(): Map<number, AuthorizedAgentMouseInput>
  /** The key event each page's guard admits next, by WebContents id. */
  authorizedAgentKeyboardInput(): Map<number, AuthorizedAgentKeyboardInput>
}
