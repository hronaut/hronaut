import type { BrowserState } from '../../../shared/types.js'

/**
 * The shortest time between two publications of a burst of changes. Pages loading together change the browser state
 * many times a second, and each publication sends every tab to the shell.
 */
export const STATE_PUBLISH_MS = 33

export interface StatePublicationOptions {
  /** Whether the state may be published now: not while the browser closes or restores its layout. */
  canPublish(): boolean
  /** The browser state as it is now. */
  read(): BrowserState
  /** The tabs whose pages are loading now, without reading the whole state. */
  loadingTabIds(): Iterable<string>
  /** Sends a state to the shell and the state hooks. */
  send(state: BrowserState): void
}

/**
 * Publishes the browser state to the shell. A change after a quiet moment goes out at once, and the changes of a burst
 * go out together, from the state as it is then, once STATE_PUBLISH_MS passed since the last publication. A page that
 * starts loading goes out at once too: the shell learns a load began from its tab's loading flag, which a fast reload
 * would otherwise clear within the same publication. A state equal to the last one sent is not sent again until the
 * state is read, since the reader may show the shell that state as an action's reply.
 */
export class StatePublication {
  private timer: NodeJS.Timeout | null = null
  private lastPublishAt = Number.NEGATIVE_INFINITY
  private lastSent: string | undefined
  /** The tabs the last state sent showed loading. */
  private sentLoading = new Set<string>()

  constructor(private readonly options: StatePublicationOptions) {}

  /** Something in the state changed. */
  changed(): void {
    if (!this.options.canPublish()) return
    if (this.loadStarted()) {
      this.publishNow()
      return
    }
    if (this.timer) return
    const wait = this.lastPublishAt + STATE_PUBLISH_MS - performance.now()
    if (wait <= 0) {
      this.publishNow()
      return
    }
    this.timer = setTimeout(() => this.publishNow(), wait)
  }

  /**
   * The state is about to be read, perhaps for an action's reply, which the shell drops for a publication that arrived
   * meanwhile. A change still waiting goes out first, so the publication the shell keeps is never older than the reply.
   */
  beforeRead(): void {
    if (this.timer) this.publishNow()
    this.lastSent = undefined
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private loadStarted(): boolean {
    for (const tabId of this.options.loadingTabIds()) {
      if (!this.sentLoading.has(tabId)) return true
    }
    return false
  }

  private publishNow(): void {
    this.dispose()
    if (!this.options.canPublish()) return
    this.lastPublishAt = performance.now()
    const state = this.options.read()
    const serialized = JSON.stringify(state)
    if (serialized === this.lastSent) return
    const loading = new Set(this.options.loadingTabIds())
    try {
      this.options.send(state)
    } catch (error) {
      // A hook that fails does not fail the change or read that published; the next change sends the state again.
      console.error('[browser] Could not publish the browser state:', error)
      return
    }
    this.lastSent = serialized
    this.sentLoading = loading
  }
}
