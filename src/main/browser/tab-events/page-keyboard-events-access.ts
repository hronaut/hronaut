import type { BrowserShortcutAction } from '../../../shared/browser-shortcuts.js'
import type { BrowserElementPickerSession } from '../element-picker/element-picker.js'
import type { BrowserScreenshotAreaSession } from '../screenshot-area/screenshot-area.js'

/** The tab fields the person's keyboard input reads and writes: its id and workspace, and when a person last used it. */
export interface PageKeyboardEventsTab {
  id: string
  mcpGroupId?: string
  humanInteractionGeneration: number
  lastHumanInteractionAt: number
  lastActiveAt: number
}

/** The tab manager options the person's keyboard input reports to and asks about shortcuts. */
export interface PageKeyboardEventsOptions {
  onUserInteraction?: (touched?: { tabId: string; workspaceId: string | undefined }) => void
  onShortcutRequested?: (action: BrowserShortcutAction, page?: { tabId: string; workspaceId: string | undefined }) => void
  shortcutAvailable?: (action: BrowserShortcutAction, workspaceId: string | undefined, tabId: string) => boolean
}

/**
 * What following the person's keyboard input on a page needs from the tab
 * manager, which keeps trusted chrome occlusion, in-flight and expected agent
 * input, the native selection sessions, the human input lock, the keys held
 * in the shell, repro recording, tab overview previews, the MCP activity
 * follower and its options
 * private. Choosing which shortcuts a page keeps is take-over.ts's function,
 * passed through so that module still loads where the manager's own import
 * loads it.
 */
export interface PageKeyboardEventsAccess<Tab extends PageKeyboardEventsTab> {
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): ReadonlyMap<number, BrowserScreenshotAreaSession>
  /** Ends the tab's screenshot area selection, as canceled. */
  cancelScreenshotArea(tabId?: string): Promise<boolean>
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): ReadonlyMap<number, BrowserElementPickerSession>
  /** Ends the tab's element picker, as canceled. */
  cancelElementPicker(tabId?: string): Promise<boolean>
  /** Whether this key event is one an agent's input was expected to send, consuming that expectation. */
  consumeExpectedAgentKeyboardInput(webContentsId: number, input: Electron.Input): boolean
  /** The shortcut the browser takes from the page, or null when the page keeps the key: take-over.ts's function. */
  pageShortcut(requested: BrowserShortcutAction | null, input: { available: boolean; expectedAgentInput: boolean }): BrowserShortcutAction | null
  /** Whether the person's input to the tab's page is locked. */
  isHumanInteractionLocked(tab: Tab): boolean
  /** The physical keys held down in the shell, which a page forgets once it sees a key pressed or released. */
  shellHeldKeys(): Set<string>
  /** The repro recorder, which notes the person's keys while it records. */
  reproRecorder(): { observeReproKeyboard(tab: Tab, input: Electron.Input): void }
  /** Captures the tab's overview preview once the page settles for this long. */
  scheduleTabOverviewPreview(tab: Tab, settleMs?: number): void
  /** The follower of MCP activity, which waits while a person uses a page. */
  mcpActivityFollower(): { noteHumanInput(): void }
  /** The tab manager's options. */
  options(): PageKeyboardEventsOptions
}
