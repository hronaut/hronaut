interface HomeContents {
  isDestroyed(): boolean
  isLoadingMainFrame(): boolean
  reload(): void
  once(event: 'did-stop-loading' | 'destroyed', listener: () => void): unknown
  removeListener(event: 'did-stop-loading' | 'destroyed', listener: () => void): unknown
}

export class HomeRefresh {
  private readonly pending = new WeakMap<HomeContents, Promise<void>>()

  async request(contents: HomeContents, isCurrentHome: () => boolean): Promise<void> {
    if (contents.isDestroyed() || !isCurrentHome()) return
    const pending = this.pending.get(contents)
    if (pending) return pending
    if (!contents.isLoadingMainFrame()) {
      contents.reload()
      return
    }
    // Do not interrupt initial navigation while native/CDP observers are still
    // discovering the page. The next request will render the latest Home state.
    const operation = new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.pending.delete(contents)
        contents.removeListener('did-stop-loading', refresh)
        contents.removeListener('destroyed', cancel)
      }
      const cancel = (): void => {
        cleanup()
        resolve()
      }
      const refresh = (): void => {
        cleanup()
        try {
          if (!contents.isDestroyed() && isCurrentHome()) contents.reload()
          resolve()
        } catch (error) {
          // EventEmitter cannot forward a listener's exception to the caller.
          // Preserve the same error contract as an immediate refresh.
          reject(error)
        }
      }
      contents.once('did-stop-loading', refresh)
      contents.once('destroyed', cancel)
    })
    this.pending.set(contents, operation)
    return operation
  }
}
