/**
 * What leasing a page's debugger needs from the tab manager, which keeps the
 * debugger queue, the dialog monitor attachments in flight, the pages whose
 * Developer Tools are opening and whether it is closing private. Each is
 * read again when the lease reaches it.
 */
export interface DebuggerLeaseAccess {
  /** Runs the operation after the debugger operations queued before it for the page, by WebContents id. */
  inDebuggerQueue<T>(webContentsId: number, operation: () => Promise<T>): Promise<T>
  /** The dialog monitor attachment in flight for the page, by WebContents id. */
  dialogMonitorAttach(webContentsId: number): Promise<void> | undefined
  /** Whether the page's Developer Tools are opening, by WebContents id. */
  isDevToolsOpening(webContentsId: number): boolean
  /** Whether the browser is closing. */
  isDestroyed(): boolean
}
