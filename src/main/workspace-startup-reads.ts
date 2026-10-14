import type { IpcMainInvokeEvent, WebContents } from 'electron'

const unavailable = (): Error => new Error('Workspace read is no longer available.')
const MAX_PENDING_READS = 64
interface PendingRead { finish(error?: unknown): void; cancel(): void }
interface SenderReads { reads: Set<PendingRead>; dispose(): void }

function settleRead<T>(value: T | Promise<T>, success: (value: T) => void, failure: (error: unknown) => void): void {
  void Promise.resolve(value).then(success, failure)
}

/** One initialization subscription and bounded, cancellable ownership of IPC reads. */
export class WorkspaceStartupReads {
  private initialization: Promise<void> | null = null
  private readonly senders = new Map<WebContents, SenderReads>()
  private pendingCount = 0

  run<T>(event: IpcMainInvokeEvent, initialization: Promise<void> | null,
    assertSender: () => void, assertReady: () => void, read: () => T | Promise<T>): Promise<T> {
    assertSender()
    const sender = event.sender
    const frame = event.senderFrame
    if (sender.isDestroyed() || !frame || frame.detached || sender.mainFrame !== frame) throw unavailable()
    const url = frame.url
    const validate = (): void => {
      if (sender.isDestroyed() || frame.detached || event.senderFrame !== frame
        || sender.mainFrame !== frame || frame.url !== url) throw unavailable()
      assertSender()
      assertReady()
    }
    if (this.pendingCount >= MAX_PENDING_READS) throw new Error('Too many pending workspace reads.')
    if (initialization && this.initialization !== initialization) {
      this.cancelAll()
      this.initialization = initialization
      void initialization.then(() => this.settle(initialization), () => this.settle(initialization, unavailable()))
    }
    let group = this.senders.get(sender)
    if (!group) {
      const cancel = (): void => {
        for (const pending of [...group!.reads]) pending.cancel()
      }
      // Sticky invalidation also catches a same-URL reload that reuses frame IDs.
      const navigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
        if (details.isMainFrame) cancel()
      }
      group = { reads: new Set(), dispose: () => {
        sender.removeListener('destroyed', cancel)
        sender.removeListener('render-process-gone', cancel)
        sender.removeListener('did-start-navigation', navigate)
        sender.removeListener('did-navigate', cancel)
      } }
      try {
        sender.on('destroyed', cancel)
        sender.on('render-process-gone', cancel)
        sender.on('did-start-navigation', navigate)
        sender.on('did-navigate', cancel)
      } catch (error) {
        group.dispose()
        throw error
      }
      this.senders.set(sender, group)
    }
    const owned = group
    return new Promise<T>((resolve, reject) => {
      let reading = false
      let cancelled = false
      const detach = (): void => {
        owned.reads.delete(pending)
        if (!owned.reads.size) {
          owned.dispose()
          if (this.senders.get(sender) === owned) this.senders.delete(sender)
        }
      }
      const pending: PendingRead = { cancel: () => {
        if (cancelled) return
        cancelled = true
        detach()
        // An already running asynchronous read keeps its capacity until it
        // settles, so repeated abandoned callers cannot accumulate ownership.
        if (!reading) this.pendingCount -= 1
        reject(unavailable())
      }, finish: error => {
        if (cancelled || reading) return
        reading = true
        try {
          if (error) throw error
          validate()
          settleRead(read(), value => {
            this.pendingCount -= 1
            detach()
            if (cancelled) return
            try { validate(); resolve(value) } catch (failure) { reject(failure) }
          }, failure => { this.pendingCount -= 1; detach(); reject(failure) })
        } catch (failure) {
          this.pendingCount -= 1
          detach()
          reject(failure)
        }
      } }
      owned.reads.add(pending)
      this.pendingCount += 1
      if (!initialization) pending.finish()
    })
  }

  private cancelAll(): void {
    for (const group of [...this.senders.values()]) for (const pending of [...group.reads]) pending.cancel()
  }

  private settle(initialization: Promise<void>, error?: unknown): void {
    if (this.initialization !== initialization) return
    for (const group of [...this.senders.values()]) for (const pending of [...group.reads]) pending.finish(error)
  }
}
