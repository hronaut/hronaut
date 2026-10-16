/** A caller deadline releases the shared queue, but not a pending native capture. */
export class NativePreviewCapture {
  // Settles when the native capture of these contents does, success or not.
  private readonly pending = new WeakMap<object, Promise<void>>()

  constructor(private readonly timeoutMs: number) {}

  /** Another capture of these contents must not start while a native one is still pending. */
  isPending(contents: object): boolean {
    return this.pending.has(contents)
  }

  /** Resolves once the pending native capture of these contents settles; undefined when none is pending. */
  settled(contents: object): Promise<void> | undefined {
    return this.pending.get(contents)
  }

  async run<T>(
    contents: object,
    capture: () => Promise<T>,
    onTimeout: () => void,
    onLateSettlement: () => void
  ): Promise<T | undefined> {
    if (this.pending.has(contents)) return undefined
    let settle!: () => void
    this.pending.set(contents, new Promise<void>((resolve) => { settle = resolve }))
    const release = (): void => {
      this.pending.delete(contents)
      settle()
    }
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    let native: Promise<T>
    try {
      native = capture()
    } catch (error) {
      release()
      throw error
    }
    const completion = native.then(value => {
      release()
      if (timedOut) onLateSettlement()
      return value
    }, (error: unknown) => {
      release()
      if (timedOut) onLateSettlement()
      throw error
    })
    try {
      return await Promise.race([
        completion,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true
            reject(new Error(`Tab overview capture exceeded ${this.timeoutMs} ms`))
          }, this.timeoutMs)
          timer.unref()
        })
      ])
    } catch (error) {
      if (timedOut) onTimeout()
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
