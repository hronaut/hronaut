/** Main-process lifetime, independent of transport sessions or endpoint moves.
 * Retains only counters; command arguments and results are never stored here.
 */
export class McpActionTracker {
  private active = 0
  private revision = 0

  get activeCount(): number { return this.active }
  get controlRevision(): number { return this.revision }

  invalidatePendingDispatches(): void { this.revision += 1 }

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    this.active += 1
    try { return await operation() } finally { this.active -= 1 }
  }
}
