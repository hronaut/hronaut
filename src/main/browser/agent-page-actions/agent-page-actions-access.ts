import type { WebContents } from 'electron'
import type { BrowserDialogHandlingOptions } from '../../../shared/types.js'
import type { OpenedTabObservation, TabsOpenedDuringClick } from '../click-opened-tabs.js'
import type { NativeClickProgress } from '../native-click-admission.js'
import type { NativeInputDispatchObserver } from '../native-key-hold.js'
import type { KeyboardDebugger } from '../native-keyboard.js'
import type { PointerDebugger } from '../native-pointer.js'
import type { AgentPointerIdentity } from '../page-scripts.js'

/** What an agent's click names: a tab, a control by ref or selector or a point, and how to click it. */
export type BrowserClickTarget = {
  tabId?: string
  ref?: string
  selector?: string
  x?: number
  y?: number
  doubleClick?: boolean
  native?: boolean
  button?: 'left' | 'right'
} & BrowserDialogHandlingOptions

/** The tab field an agent's page action reads: its page. */
export interface AgentPageActionsTab {
  webContents: WebContents
}

/**
 * What an agent's click, typing, selecting, form filling, hovering, dragging
 * and scrolling need from the tab manager, which keeps the tabs, the pages
 * whose last semantic click was not confirmed, the tabs opened during a
 * click, the target and viewport checks, native input authority, the
 * right-click environment, the agent's cursor, the agent input scope,
 * background focus isolation, website dialog handling, the debugger lease and
 * evaluation, native clicks and authorized agent input private. Two members
 * are plain functions of modules the manager's own imports load, so those
 * modules still load where they did.
 */
export interface AgentPageActionsAccess<Tab extends AgentPageActionsTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The pages whose last semantic click was not confirmed, which take no further semantic click. */
  unconfirmedSemanticClicks(): WeakSet<WebContents>
  /** Starts recording the tabs the tab's page opens. */
  observeOpenedTabs(tab: Tab): OpenedTabObservation
  /** Stops recording the tabs the tab's page opens, reporting those still open in its workspace. */
  stopObservingOpenedTabs(tab: Tab, observation: OpenedTabObservation): TabsOpenedDuringClick | undefined
  /** Throws unless the target names exactly one ref or selector. */
  validateTarget(target: { ref?: string; selector?: string }): void
  /** The point a coordinate action names, or undefined after checking the ref or selector it names instead. */
  coordinatePointOrValidateTarget(
    target: { ref?: string; selector?: string; x?: number; y?: number },
    action: 'click' | 'hover'
  ): { x: number; y: number } | undefined
  /** The points a coordinate drag names, or undefined after checking the refs or selectors it names instead. */
  coordinateDragPointsOrValidateTargets(
    options: {
      sourceRef?: string
      sourceSelector?: string
      targetRef?: string
      targetSelector?: string
      startX?: number
      startY?: number
      endX?: number
      endY?: number
    },
    source: { ref?: string; selector?: string },
    target: { ref?: string; selector?: string }
  ): { from: { x: number; y: number }; to: { x: number; y: number } } | undefined
  /** Throws unless the point is inside the page's visible viewport. */
  assertPointInsideVisibleViewport(webContents: WebContents, point: { x: number; y: number }, action: 'click' | 'hover' | 'drag'): Promise<void>
  /** Throws unless native right-clicks are supported on this platform: owned-right-click.ts's check. */
  assertRightClickPlatform(platform: string): void
  /** Throws unless the right-click point is inside the page's viewport and the click is still current. */
  assertRightClickViewport(webContents: WebContents, x: number, y: number, validate: () => void): Promise<void>
  /** Throws when the page reported the click target disabled. */
  assertClickTargetEnabled(result: unknown): void
  /** Throws when the page reported the form control not editable. */
  assertNativeEditability(result: unknown): void
  /** The agent's authority to give the tab's page native input, checked and released by the caller. */
  nativeInputAuthority(tab: Tab, validateInput?: (validateContext: () => void) => void): { validate: () => void; dispose: () => void }
  /** The environment a native right-click needs, checked and released by the caller. */
  rightClickEnvironment(tab: Tab): { validate(): void; dispose(): void }
  /** Admits a native click on the target with the page's attached debugger: native-click-admission.ts's function. */
  acquireNativeClickAdmission(pageDebugger: WebContents['debugger'], target: { ref?: string; selector?: string },
    validate: () => void, progress: NativeClickProgress, publish: () => void): Promise<{ sample(x: number, y: number): Promise<void>; dispose(): Promise<void> }>
  /** Draws the agent's cursor at the point, unless agent cursors are off. */
  showAgentPointer(
    webContents: WebContents,
    point: { x: number; y: number },
    effect: 'move' | 'click' | 'drag-start' | 'drag-end',
    options?: { origin?: { x: number; y: number }; agent?: AgentPointerIdentity }
  ): Promise<void>
  /** Runs the operation as agent input to the page. */
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>, options?: { deferRendererFlag?: boolean; onCleanupFailure?: () => void }): Promise<T>
  /** Runs the operation keeping the window's focus where it was. */
  withBackgroundAgentFocusGuard<T>(operation: () => Promise<T>): Promise<T>
  /** Runs the operation answering a website dialog it opens as the options say. */
  withOptionalDialogHandling<T>(webContents: WebContents, options: BrowserDialogHandlingOptions, operation: () => Promise<T>): Promise<T>
  /** The page's main world execution context id. */
  mainWorldContextId(webContents: WebContents): Promise<number>
  /** Evaluates the expression with the page's attached debugger. */
  evaluateWithAttachedDebugger(webContents: WebContents, expression: string, contextId?: number): Promise<unknown>
  /** Runs a debugger operation on the page in its turn, checking validateAdmission at each step when given. */
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>, validateAdmission?: () => void): Promise<T>
  /** Dispatches a native click at the point under the agent's input authorization. */
  dispatchNativeClick(
    webContents: WebContents,
    point: { x: number; y: number },
    doubleClick: boolean,
    validateClick: () => void,
    sample?: (x: number, y: number) => Promise<void>,
    observer?: NativeInputDispatchObserver,
    rightClick?: boolean
  ): Promise<void>
  /** The page's debugger for authorized agent input, checking validateInput before each command when given. */
  agentInputDebugger(webContents: WebContents, validateInput?: () => void): PointerDebugger & KeyboardDebugger
}
