import type { WebContents } from 'electron'
import type { BrowserSnapshotDeltaContext } from '../../../shared/snapshot-delta.js'

/** The tab fields a file upload reads. */
export interface FileUploadTab {
  id: string
  mcpGroupId?: string
  webContents: WebContents
}

/**
 * What a file upload needs from the tab manager, which keeps the tabs,
 * workspaces, inspection permissions, observation context, target validation,
 * agent input admission and the debugger lease private. A workspace is opaque
 * here: the upload only compares it by identity and reads its inspection
 * permission generation.
 */
export interface FileUploadAccess<Tab extends FileUploadTab> {
  validateTarget(target: { ref?: string; selector?: string }): void
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  findWorkspace(workspaceId: string): object | undefined
  inspectionPermission(workspace: object): number | undefined
  isDestroyed(): boolean
  snapshotDeltaContext(tab: Tab): BrowserSnapshotDeltaContext
  withAgentInput<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  releaseDebuggerEvaluationObjects(webContents: WebContents, response: {
    result?: { objectId?: string }
    exceptionDetails?: { exception?: { objectId?: string } }
  }): Promise<void>
}
