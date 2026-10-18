import type { WebContents } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'
import type { BrowserEmulationState, BrowserPageLifecycleState } from '../../../shared/types.js'
import type { ImageInspectionSlots } from '../image-state.js'
import type { BrowserProfilingState } from '../profiling-controller.js'

/** The tab fields element, media and image inspection read. */
export interface ElementInspectionTab extends Pick<BrowserProfilingState, 'codeCoverage' | 'cpuProfile'> {
  id: string
  title: string
  url: string
  mcpGroupId?: string
  webContents: WebContents
  sleeping: boolean
  wakePromise?: Promise<void>
  pageLifecycleState: BrowserPageLifecycleState
  emulation: Pick<BrowserEmulationState, 'renderingDebug'>
}

/**
 * What element, media and image inspection need from the tab manager, which
 * keeps the tabs, workspaces, inspection permissions, inspection slots,
 * DevTools and CSS state preview tracking and the debugger lease private. A
 * workspace is opaque here: inspection only compares it by identity and reads
 * its inspection permission generation.
 */
export interface ElementInspectionAccess<Tab extends ElementInspectionTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  findWorkspace(workspaceId: string): object | undefined
  inspectionPermission(workspace: object): number | undefined
  isDestroyed(): boolean
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  validateTarget(target: { ref?: string; selector?: string }): void
  acquireSizingInspectionSlot(owner: object): ReturnType<ImageInspectionSlots['acquire']>
  acquireImageInspectionSlot(owner: object): ReturnType<ImageInspectionSlots['acquire']>
  isDevToolsOpening(webContentsId: number): boolean
  cssStatePreviewActive(tab: Tab): boolean
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  isUnavailableCdpMethod(error: unknown): boolean
}
