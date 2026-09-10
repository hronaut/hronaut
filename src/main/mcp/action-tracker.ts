import { McpActivityHistory } from './activity-history.js'
import { randomUUID } from 'node:crypto'

/** Main-process lifetime, independent of transport sessions or endpoint moves.
 * Retains counters and bounded activity metadata, never arguments or results.
 */
export class McpActionTracker {
  readonly activityHistory = new McpActivityHistory()
  readonly runtimeId = randomUUID()
  private active = 0
  private revision = 0

  constructor(private readonly onActiveCountChanged?: (count: number) => void) {}

  get activeCount(): number { return this.active }
  get controlRevision(): number { return this.revision }

  invalidatePendingDispatches(): void { this.revision += 1 }

  private publishCount(): void {
    try { this.onActiveCountChanged?.(this.active) } catch {
      // Progress delivery must never prevent or replace a browser operation.
      console.error('[mcp] Could not publish command progress.')
    }
  }

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    this.active += 1
    this.publishCount()
    try { return await operation() } finally {
      this.active -= 1
      this.publishCount()
    }
  }
}
