import type { BrowserElementPickerSession } from '../element-picker/element-picker-access.js'
import type { BrowserScreenshotAreaSession } from '../screenshot-area/screenshot-area-access.js'

/** The tab fields the person's pointer input reads and writes: its id and workspace, and when a person last used it. */
export interface PagePointerEventsTab {
  id: string
  mcpGroupId?: string
  humanInteractionGeneration: number
  lastHumanInteractionAt: number
  lastActiveAt: number
}

/** The tab manager options the person's pointer input reports to. */
export interface PagePointerEventsOptions {
  onUserInteraction?: (touched?: { tabId: string; workspaceId: string | undefined }) => void
}

/**
 * What following the person's mouse, wheel and touch input on a page needs
 * from the tab manager, which keeps trusted chrome occlusion, in-flight agent
 * input, agent wheel scrolling, the native selection sessions, the human
 * input lock, repro recording, tab overview previews, the MCP activity
 * follower, the split view, the active tab and its selection generation,
 * agent following, workspace activation, state publication and its options
 * private. The active tab, its selection generation and the followed agent
 * stay manager fields because selection, layout, closing and following read
 * and write them too; they are written back through their setters and read
 * again at every use.
 */
export interface PagePointerEventsAccess<Tab extends PagePointerEventsTab> {
  /** Whether trusted chrome covers the pages, which then stay on screen only for their snapshot. */
  browserContentOccluded(): boolean
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
  /** Whether an agent's wheel scrolling is still under way on the page. */
  agentWheelUnderWay(webContentsId: number): boolean
  /** The agent wheel scrolling in flight on each page, by WebContents id, which a destroyed page leaves. */
  agentWheel(): Map<number, { pending: number; until: number }>
  /** The screenshot area selections in progress, by WebContents id. */
  screenshotAreaSessions(): ReadonlyMap<number, BrowserScreenshotAreaSession>
  /** Forwards one native mouse event to the page's screenshot area selection. */
  queueScreenshotAreaMouseInput(tab: Tab, session: BrowserScreenshotAreaSession, type: 'down' | 'move' | 'up', mouse: Electron.MouseInputEvent): void
  /** The element pickers in progress, by WebContents id. */
  elementPickerSessions(): ReadonlyMap<number, BrowserElementPickerSession>
  /** Forwards one native mouse event to the page's element picker. */
  queueElementPickerMouseInput(tab: Tab, session: BrowserElementPickerSession, type: 'down' | 'move' | 'up', mouse: Electron.MouseInputEvent): void
  /** Whether the tab's human input lock holds this mouse event back from the page. */
  shouldBlockHumanMouseInput(tab: Tab, mouse: Electron.MouseInputEvent): boolean
  /** The repro recorder, which notes the person's mouse input while it records. */
  reproRecorder(): { observeReproMouse(tab: Tab, mouse: Electron.MouseInputEvent): void }
  /** Captures the tab's overview preview once the page settles for this long. */
  scheduleTabOverviewPreview(tab: Tab, settleMs?: number): void
  /** The follower of MCP activity, which waits while a person uses a page. */
  mcpActivityFollower(): { noteHumanInput(): void }
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** The active tab's id. */
  activeTabId(): string | null
  /** Records the active tab's id. */
  writeActiveTabId(tabId: string): void
  /** Counts tab selections, so a later selection tells an earlier one it was overtaken. */
  tabSelectionGeneration(): number
  /** Records the selection generation. */
  writeTabSelectionGeneration(generation: number): void
  /** Stops following an agent, when the person picks the other split pane. */
  setAgentFollow(follow: undefined): void
  /** Records the tab as its workspace's active tab. */
  markTabActiveInGroup(tab: Tab): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** The tab manager's options. */
  options(): PagePointerEventsOptions
}
