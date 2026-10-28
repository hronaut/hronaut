import type { BrowserState } from '../../../shared/types.js'

/**
 * The shortest time between two publications of a burst of changes. Pages loading together change the browser state
 * many times a second, and each publication sends every tab to the shell.
 */
export const STATE_PUBLISH_MS = 33

/** How long a publication waits for the shell to say it drew the last one, in case it never says so. */
export const STATE_DRAWN_TIMEOUT_MS = 250

/** The tabs on screen: the selected one, and the other half of a split view it is in. */
export function shownTabIds(activeTabId: string | null, splitView: { firstTabId: string; secondTabId: string } | null): string[] {
  if (!activeTabId) return []
  if (splitView && (splitView.firstTabId === activeTabId || splitView.secondTabId === activeTabId)) {
    return [splitView.firstTabId, splitView.secondTabId]
  }
  return [activeTabId]
}

export interface StatePublicationOptions {
  /** Whether the state may be published now: not while the browser closes or restores its layout. */
  canPublish(): boolean
  /** The browser state as it is now. */
  read(): BrowserState
  /** The shown tabs whose pages are loading now, without reading the whole state. */
  shownLoadingTabIds(): Iterable<string>
  /** Sends a state to the shell and the state hooks. */
  send(state: BrowserState): void
}

/**
 * Publishes the browser state to the shell. A change after a quiet moment goes out at once, and the changes of a burst
 * go out together, from the state as it is then, once STATE_PUBLISH_MS passed since the last publication.
 *
 * The shell says when it drew a publication (drawn). Until then, changes wait, and once it did, they wait as long again
 * as the shell took, so a shell slower than the changes draws the newest state instead of falling seconds behind on a
 * queue of older ones, and keeps half its time for the person and its own work. A shown page that starts loading goes
 * out at once: the shell learns a load began from its tab's loading flag, which a fast reload would otherwise clear
 * before the next publication, and detached panels act on it. A state equal to the last one sent is not sent again
 * until the state is read, since the reader may show the shell that state as an action's reply.
 */
export class StatePublication {
  private timer: NodeJS.Timeout | null = null
  private drawnTimer: NodeJS.Timeout | null = null
  private lastPublishAt = Number.NEGATIVE_INFINITY
  private lastSentAt = Number.NEGATIVE_INFINITY
  /** When the shell next has had as much time to itself as it took to draw the last publication. */
  private shellFreeAt = Number.NEGATIVE_INFINITY
  /** Publications sent that the shell has not said it drew. */
  private undrawn = 0
  /** A change came while the shell was still drawing. */
  private waiting = false
  private lastSent: string | undefined
  /** The shown tabs the last state sent showed loading. */
  private sentLoading = new Set<string>()

  constructor(private readonly options: StatePublicationOptions) {}

  /** Something in the state changed. */
  changed(): void {
    if (!this.options.canPublish()) return
    if (this.shownLoadStarted()) {
      this.publishNow()
      return
    }
    this.schedule()
  }

  /** The shell drew a publication it was sent. */
  drawn(): void {
    if (this.undrawn === 0) return
    this.undrawn -= 1
    if (this.undrawn > 0) return
    const now = performance.now()
    this.shellDrew(now + (now - this.lastSentAt))
  }

  /**
   * The state is about to be read, perhaps for an action's reply, which the shell drops for a publication that arrived
   * meanwhile. A change still waiting goes out first, so the publication the shell keeps is never older than the reply.
   * A change waiting for the shell to draw goes out once it did.
   */
  beforeRead(): void {
    if (this.timer) this.publishNow()
    this.lastSent = undefined
  }

  dispose(): void {
    this.clearTimer()
    if (this.drawnTimer) clearTimeout(this.drawnTimer)
    this.drawnTimer = null
  }

  private schedule(): void {
    if (this.timer) return
    if (this.undrawn > 0) {
      this.waiting = true
      return
    }
    const wait = Math.max(this.lastPublishAt + STATE_PUBLISH_MS, this.shellFreeAt) - performance.now()
    if (wait <= 0) {
      this.publishNow()
      return
    }
    this.timer = setTimeout(() => this.publishNow(), wait)
  }

  /** The shell is done drawing, and the next publication waits until freeAt. */
  private shellDrew(freeAt: number): void {
    if (this.drawnTimer) clearTimeout(this.drawnTimer)
    this.drawnTimer = null
    this.undrawn = 0
    this.shellFreeAt = freeAt
    if (!this.waiting) return
    this.waiting = false
    if (this.options.canPublish()) this.schedule()
  }

  private shownLoadStarted(): boolean {
    for (const tabId of this.options.shownLoadingTabIds()) {
      if (!this.sentLoading.has(tabId)) return true
    }
    return false
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private publishNow(): void {
    this.clearTimer()
    if (!this.options.canPublish()) return
    this.lastPublishAt = performance.now()
    const state = this.options.read()
    const serialized = JSON.stringify(state)
    if (serialized === this.lastSent) return
    const loading = new Set(this.options.shownLoadingTabIds())
    try {
      this.options.send(state)
    } catch (error) {
      // A hook that fails does not fail the change or read that published; the next change sends the state again.
      console.error('[browser] Could not publish the browser state:', error)
      return
    }
    this.lastSent = serialized
    this.lastSentAt = this.lastPublishAt
    this.sentLoading = loading
    this.waiting = false
    this.undrawn += 1
    // A shell that is reloading, or never draws, does not hold the browser's state back for long.
    if (this.drawnTimer) clearTimeout(this.drawnTimer)
    this.drawnTimer = setTimeout(() => this.shellDrew(performance.now()), STATE_DRAWN_TIMEOUT_MS)
  }
}
