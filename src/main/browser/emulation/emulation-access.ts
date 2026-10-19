import type { BrowserWindow, Rectangle, WebContents, WebContentsView } from 'electron'
import type {
  BrowserEmulationOptions,
  BrowserEmulationResult,
  BrowserEmulationState,
  BrowserNetworkRouteSummary
} from '../../../shared/types.js'

/**
 * The tab fields emulation reads and writes: the page and its view, the
 * emulation state with its native application, revision, context generation
 * and view size, the request rules and network application emulation must
 * agree with, and the generations that tell a changed document apart.
 */
export interface EmulationTab {
  id: string
  url: string
  navigationGeneration: number
  observationGeneration: number
  nativeInputEnvironmentGeneration: number
  view: WebContentsView
  webContents: WebContents
  emulation: BrowserEmulationState
  emulationApplication: 'confirmed' | 'pending' | 'unknown'
  emulationRevision: number
  emulationContextGeneration: number
  emulationExtraHttpHeaders: Record<string, string>
  emulationViewSize?: { width: number; height: number }
  networkRoutes: BrowserNetworkRouteSummary[]
  networkConditionApplication: 'confirmed' | 'pending' | 'unknown'
  networkConditionEpoch: number
  networkDebuggerEpoch: number
}

/**
 * What emulation and sizing a page for its emulated viewport need from the
 * tab manager, which keeps the tabs, the debugger lease, state publication,
 * the emulation result, the network condition checks, the view sizing, the
 * native network throttling, the window, the tabs presented offscreen for a
 * capture, the active tab, the split view, layout and page geometry private.
 * The emulation result and confirmation check stay manager methods because
 * the published state, input and captures read them; the view sizing stays
 * because renderer and navigation handling reset it; the native network
 * throttling stays because request rules apply it too. Resizing the viewport
 * goes through the manager's emulate, as before.
 */
export interface EmulationAccess<Tab extends EmulationTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  isDestroyed(): boolean
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>, validateAdmission?: () => void): Promise<T>
  emulationResult(tab: Tab): BrowserEmulationResult
  requireEmulationConfirmed(tab: Tab): void
  requireNetworkConditionsKnown(tab: Tab): void
  markNetworkConditionsUnknown(tab: Tab): void
  setEmulationViewSize(tab: Tab, viewport: { width: number; height: number } | undefined): void
  applyNetworkEmulation(
    webContents: WebContents,
    preset: BrowserEmulationState['network'],
    routes?: BrowserNetworkRouteSummary[],
    send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  ): Promise<void>
  changed(persist?: boolean): void
  emulate(options: BrowserEmulationOptions): Promise<BrowserEmulationResult>
  window(): BrowserWindow
  offscreenCaptureTabIds(): Set<string>
  activeTabId(): string | null
  splitViewContains(tabId: string): boolean
  layout(): void
  publishPageGeometry(): void
  tabViewBounds(tab: Tab, space: Rectangle): Rectangle
  /** The page card's space, which a tab the window does not show is sized for, even while a page fills the window. */
  contentAreaBounds(): Rectangle
}
