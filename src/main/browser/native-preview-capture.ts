/** A caller deadline releases the shared queue, but not a pending native capture. */
export class NativePreviewCapture {
  private readonly pending = new WeakSet<object>()

  constructor(private readonly timeoutMs: number) {}

  async run<T>(
    contents: object,
    capture: () => Promise<T>,
    onTimeout: () => void,
    onLateCompletion: () => void
  ): Promise<T | undefined> {
    if (this.pending.has(contents)) return undefined
    this.pending.add(contents)
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    let native: Promise<T>
    try {
      native = capture()
    } catch (error) {
      this.pending.delete(contents)
      throw error
    }
    const completion = native.then(value => {
      this.pending.delete(contents)
      if (timedOut) onLateCompletion()
      return value
    }, (error: unknown) => {
      this.pending.delete(contents)
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
