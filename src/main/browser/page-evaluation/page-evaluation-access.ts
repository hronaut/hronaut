import type { WebContents } from 'electron'

/** The tab fields page script evaluation reads: the page, its document generation and its main frame. */
export interface PageEvaluationTab {
  id: string
  navigationGeneration: number
  mainFrameId?: string
  webContents: WebContents
}

/**
 * What evaluating a script or a script file in a page needs from the tab
 * manager, which keeps the tabs, the window, DevTools opening, workspaces, the
 * default execution contexts, background focus isolation, the debugger lease
 * and its evaluation helpers private. These stay manager members because
 * clicks, dialogs, file uploads and frame observation use them too.
 */
export interface PageEvaluationAccess<Tab extends PageEvaluationTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  isDestroyed(): boolean
  isWindowFocused(): boolean
  isDevToolsOpening(webContentsId: number): boolean
  tabBelongsToMcpGroup(groupId: string, tabId: string): boolean
  defaultExecutionContexts(webContentsId: number): Map<string, { id: number; uniqueId?: string }> | undefined
  withBackgroundAgentFocusGuard<T>(operation: () => Promise<T>): Promise<T>
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>, validateAdmission?: () => void): Promise<T>
  evaluateWithAttachedDebugger(webContents: WebContents, expression: string, contextId?: number): Promise<unknown>
  mainWorldContextId(webContents: WebContents): Promise<number>
  releaseDebuggerEvaluationObjects(webContents: WebContents, response: {
    result?: { objectId?: string }
    exceptionDetails?: { exception?: { objectId?: string } }
  }): Promise<void>
}
