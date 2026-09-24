interface HomeContents {
  isDestroyed(): boolean
  isLoadingMainFrame(): boolean
  reload(): void
  once(event: 'did-stop-loading' | 'destroyed', listener: () => void): unknown
  removeListener(event: 'did-stop-loading' | 'destroyed', listener: () => void): unknown
}

export class HomeRefresh {
  private readonly pending = new WeakSet<HomeContents>()

  request(contents: HomeContents, isCurrentHome: () => boolean): void {
    if (contents.isDestroyed() || !isCurrentHome() || this.pending.has(contents)) return
    if (!contents.isLoadingMainFrame()) {
      contents.reload()
      return
    }
    // Do not interrupt initial navigation while native/CDP observers are still
    // discovering the page. The next request will render the latest Home state.
    this.pending.add(contents)
    const cleanup = (): void => {
      this.pending.delete(contents)
      contents.removeListener('did-stop-loading', refresh)
      contents.removeListener('destroyed', cleanup)
    }
    const refresh = (): void => {
      cleanup()
      if (!contents.isDestroyed() && isCurrentHome()) contents.reload()
    }
    contents.once('did-stop-loading', refresh)
    contents.once('destroyed', cleanup)
  }
}
