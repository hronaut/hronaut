/**
 * How many tabs opened together behind the one shown, such as by Open all, load at the same time. More pages loading
 * together only take the processor from Hronaut's window and from each other, which is why Chrome loads the tabs it
 * restores a few at a time.
 */
export const BACKGROUND_LOADS = 3

export interface BackgroundLoadsAccess {
  /** Whether the tab is still open and asleep, waiting for its turn. */
  waiting(tabId: string): boolean
  /** Wakes the tab, which loads its page; it settles once the page loaded, or showed while it goes on loading. */
  wake(tabId: string): Promise<unknown>
}

/**
 * Loads the tabs created asleep to load in their turn, in the order they were opened, BACKGROUND_LOADS at a time. A tab
 * shown or used before its turn has already woken, and a closed one is gone: both are skipped.
 */
export class BackgroundLoads {
  private readonly queue: string[] = []
  private loading = 0

  constructor(private readonly access: BackgroundLoadsAccess) {}

  /** Loads the tab once the tabs before it in the queue loaded, or at once while fewer are loading. */
  add(tabId: string): void {
    this.queue.push(tabId)
    this.next()
  }

  private next(): void {
    while (this.loading < BACKGROUND_LOADS) {
      const tabId = this.queue.shift()
      if (tabId === undefined) return
      if (!this.access.waiting(tabId)) continue
      this.loading += 1
      void this.access.wake(tabId)
        // A site that cannot be reached shows its error page; only a load that showed nothing fails here.
        .catch((error: unknown) => { console.warn('[browser] Could not load a background tab:', error) })
        .finally(() => {
          this.loading -= 1
          this.next()
        })
    }
  }
}
