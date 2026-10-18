/**
 * What finding a page's main world context needs from the tab manager, which
 * keeps the default execution context of each frame private; its debugger
 * listeners record them as pages create and destroy contexts.
 */
export interface DebuggerEvaluationAccess {
  /** The default execution context of each frame, by WebContents id and frame id. */
  defaultExecutionContexts(): ReadonlyMap<number, ReadonlyMap<string, { id: number; uniqueId?: string }>>
}
