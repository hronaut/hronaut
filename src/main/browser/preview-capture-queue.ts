interface CaptureEntry<Request> {
  completion: Promise<void>
  pending?: Request
}

/** Serialize thumbnails globally while retaining only the newest queued frame per tab. */
export class PreviewCaptureQueue<Request extends { sequence: number }> {
  private readonly active = new Map<string, CaptureEntry<Request>>()
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly capture: (request: Request) => Promise<void>) {}

  has(tabId: string): boolean {
    return this.active.has(tabId)
  }

  run(tabId: string, request: Request): Promise<void> {
    const active = this.active.get(tabId)
    if (active) {
      if (!active.pending || request.sequence >= active.pending.sequence) active.pending = request
      return active.completion
    }
    const entry: CaptureEntry<Request> = { completion: Promise.resolve() }
    entry.completion = this.drain(entry, request).finally(() => {
      if (this.active.get(tabId) === entry) this.active.delete(tabId)
    })
    this.active.set(tabId, entry)
    return entry.completion
  }

  cancelPending(tabId: string): void {
    const active = this.active.get(tabId)
    if (active) active.pending = undefined
  }

  clear(): void {
    for (const entry of this.active.values()) entry.pending = undefined
    this.active.clear()
  }

  private async drain(entry: CaptureEntry<Request>, initial: Request): Promise<void> {
    let request: Request | undefined = initial
    while (request) {
      const current = request
      const queued = this.tail.then(() => this.capture(current))
      this.tail = queued.then(() => undefined, () => undefined)
      let failed = false
      let failure: unknown
      try {
        await queued
      } catch (error) {
        failed = true
        failure = error
      }
      request = entry.pending
      entry.pending = undefined
      if (!request && failed) throw failure
    }
  }
}
