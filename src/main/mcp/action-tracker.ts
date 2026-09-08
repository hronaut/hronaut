/** Main-process lifetime, independent of transport sessions or endpoint moves.
 * Retains only a count; command arguments and results are never stored here.
 */
export class McpActionTracker {
  private active = 0

  get activeCount(): number { return this.active }

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    this.active += 1
    try { return await operation() } finally { this.active -= 1 }
  }
}
