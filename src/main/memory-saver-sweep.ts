export class MemorySaverSweepQueue {
  private pending: Promise<void> = Promise.resolve()

  run(sweep: () => Promise<void>): Promise<void> {
    const operation = this.pending.then(sweep)
    this.pending = operation.catch(() => undefined)
    return operation
  }
}
