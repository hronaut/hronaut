// Internal guard retained until the MCP response has finished audit/capability awaits.
export interface PendingElementInspection {
  finish(): Promise<void>
  assertCurrent(): void
  discard(): void
}
