/** Keep native commands serialized even when their caller stops waiting. */
export class BrowserDebuggerQueue {
  private readonly tails = new Map<number, Promise<void>>()

  run<T>(contentsId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(contentsId) ?? Promise.resolve()
    const result = previous.then(operation)
    // A failed command must reject its caller without poisoning later commands.
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(contentsId, tail)
    void tail.then(() => {
      if (this.tails.get(contentsId) === tail) this.tails.delete(contentsId)
    })
    return result
  }

  pending(contentsId: number): Promise<void> | undefined {
    return this.tails.get(contentsId)
  }

  clear(): void {
    this.tails.clear()
  }
}
