import { LocalizedError } from '../localized-error.js'

/**
 * How long one operation's debugger commands may hold a page's turn. Chromium answers a command in milliseconds, a
 * large page's accessibility tree or screenshot in seconds; a command the page never answers, as on a page stuck in a
 * loop, held the queue and every later debugger call on the tab, for good.
 */
export const DEBUGGER_OPERATION_BUDGET_MS = 60_000

/**
 * The commands' budget while a page's last operation stalled, until one succeeds: an operation that already waited
 * out a full budget there makes the next ones fail in seconds rather than each waiting a minute.
 */
export const STALLED_PAGE_BUDGET_MS = 10_000

/**
 * How long a stalled operation may take to unwind once its page's debugger connection is reset, which fails the
 * commands it waits on. One that still waits, on something other than the page, loses its turn anyway.
 */
export const STALL_RELEASE_GRACE_MS = 2_000

export interface DebuggerOperationOptions {
  /**
   * How long the operation may wait on purpose, beyond its commands: an evaluation's deadline, or the time a heap
   * snapshot of a large page takes. It is added to the commands' budget, which a stalled page shortens.
   */
  waitMs?: number
}

/** How long operations' commands may hold a page's turn: DEBUGGER_OPERATION_BUDGET_MS and STALLED_PAGE_BUDGET_MS. */
export interface DebuggerQueueBudgets {
  operationMs: number
  stalledPageMs: number
}

export interface DebuggerQueueHooks {
  /**
   * Resets the page's debugger connection after an operation outlived its budget, failing the commands it still waits
   * on. Runs while that operation still holds the page's turn.
   */
  stalled(contentsId: number, budgetMs: number): void
}

/**
 * An operation held a page's debugger past its budget: the page did not answer, and Hronaut reset its connection to
 * the page. Whatever the operation sent may have taken effect.
 */
export class DebuggerOperationStalledError extends LocalizedError {
  constructor(readonly budgetMs: number, cause?: unknown) {
    const seconds = Math.ceil(budgetMs / 1000)
    super('appErrors.pageTools.pageNotAnswering', { seconds }, {
      message: `The page did not answer Hronaut's debugger within ${seconds} s, so Hronaut reset its connection to the `
        + 'page. A command already sent may have taken effect.',
      ...(cause === undefined ? {} : { cause })
    })
  }
}

/**
 * Runs each page's native debugger operations one at a time, in the order asked, also when their caller stops
 * waiting. Each operation holds the page's turn for its budget at most, counted from when its turn comes: past it,
 * the hooks reset the page's debugger connection, the operation fails with DebuggerOperationStalledError, and the
 * next one runs.
 */
export class BrowserDebuggerQueue {
  private readonly tails = new Map<number, Promise<void>>()
  /** Pages whose last operation stalled, until one succeeds. */
  private readonly stalledContents = new Set<number>()

  constructor(
    private readonly hooks: DebuggerQueueHooks = { stalled: () => undefined },
    private readonly budgets: DebuggerQueueBudgets = { operationMs: DEBUGGER_OPERATION_BUDGET_MS, stalledPageMs: STALLED_PAGE_BUDGET_MS }
  ) {}

  run<T>(contentsId: number, operation: () => Promise<T>, options: DebuggerOperationOptions = {}): Promise<T> {
    const previous = this.tails.get(contentsId) ?? Promise.resolve()
    const result = previous.then(() => this.supervise(contentsId, operation, Math.max(0, options.waitMs ?? 0)))
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

  /** Whether the page's last operation stalled and none has succeeded since. */
  isStalled(contentsId: number): boolean {
    return this.stalledContents.has(contentsId)
  }

  /** Forgets a page that went away. */
  forget(contentsId: number): void {
    this.stalledContents.delete(contentsId)
  }

  clear(): void {
    this.tails.clear()
    this.stalledContents.clear()
  }

  /** Runs the operation within its budget; settles when it does, or once it stalled and its page was reset. */
  private supervise<T>(contentsId: number, operation: () => Promise<T>, waitMs: number): Promise<T> {
    const budgetMs = waitMs + (this.stalledContents.has(contentsId) ? this.budgets.stalledPageMs : this.budgets.operationMs)
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let stalled = false
      let releaseTimer: ReturnType<typeof setTimeout> | undefined
      const giveUp = (cause?: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(releaseTimer)
        reject(new DebuggerOperationStalledError(budgetMs, cause))
      }
      const budgetTimer = setTimeout(() => {
        if (settled) return
        stalled = true
        this.stalledContents.add(contentsId)
        try {
          this.hooks.stalled(contentsId, budgetMs)
        } catch { /* A reset that failed leaves the release below to free the turn. */ }
        releaseTimer = setTimeout(giveUp, STALL_RELEASE_GRACE_MS)
        releaseTimer.unref?.()
      }, budgetMs)
      budgetTimer.unref?.()
      Promise.resolve().then(operation).then((value) => {
        clearTimeout(budgetTimer)
        // Past its budget, even a late answer is the stall: the reset already took what the operation set up.
        if (stalled) return giveUp()
        settled = true
        this.stalledContents.delete(contentsId)
        resolve(value)
      }, (error: unknown) => {
        clearTimeout(budgetTimer)
        // Past its budget, the operation's own failure, such as a command the reset failed, is the stall.
        if (stalled) return giveUp(error)
        settled = true
        reject(error)
      })
    })
  }
}
