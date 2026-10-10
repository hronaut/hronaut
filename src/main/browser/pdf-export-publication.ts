// Retained only until the MCP response has finished its post-export awaits.
// The file has committed; discarding this guard never removes that file.
export interface PendingPdfExport {
  assertCurrent(): void
  discard(): void
}
