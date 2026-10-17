import { randomUUID } from 'node:crypto'
import { UNDO_OFFER_MS, type UndoKind, type UndoOffer } from '../shared/undo.js'

export interface UndoableAction {
  kind: UndoKind
  name: string
  count?: number
  /** Puts things back as they were; false when nothing was left to put back. */
  undo: () => Promise<boolean | void>
  /** Completes what the action held back for Undo, once Undo is no longer offered. */
  finalize?: () => Promise<unknown>
}

/**
 * Time past the toast's own before main ends the offer by itself. The toast ends it when it closes, so this only
 * applies when the toast never answers, and leaves room for a toast drawn late on a busy shell.
 */
const UNDO_GRACE_MS = 4_000
/** The longest the person can keep Undo on offer by staying on its toast. */
export const UNDO_HOLD_MAX_MS = 60_000

/**
 * The one action the person can undo now. A newer action, the toast closing, the shell reloading or quitting ends the
 * offer and completes what the action held back; the toast drives it, with a timer of its own in case the toast never
 * answers. Main tells the shell when an offer ends, so its toast never offers Undo for an offer that is gone.
 */
export class UndoOffers {
  private current: { offer: UndoOffer; action: UndoableAction; timer?: ReturnType<typeof setTimeout> } | undefined
  private closed = false

  constructor(
    private readonly publish: (offer: UndoOffer) => void,
    private readonly publishEnd: (token: string) => void,
    private readonly onError: (action: string, error: unknown) => void
  ) {}

  offer(action: UndoableAction): void {
    void this.end()
    // Quitting already ended the offers: what this action held back is completed now.
    if (this.closed) {
      void this.complete(action)
      return
    }
    const offer: UndoOffer = { token: randomUUID(), kind: action.kind, name: action.name, count: action.count ?? 1 }
    this.current = { offer, action }
    this.expireAfter(UNDO_OFFER_MS + UNDO_GRACE_MS)
    this.publish(offer)
  }

  /** Undoes the action, when this is still the offer shown. False when it is not, or nothing came back. */
  async undo(token: string): Promise<boolean> {
    const current = this.current
    if (!current || current.offer.token !== token) return false
    this.clear()
    return (await current.action.undo()) !== false
  }

  /** The person is on the toast, so the offer stays while it does, up to UNDO_HOLD_MAX_MS. */
  hold(token: string): void {
    if (this.current?.offer.token === token) this.expireAfter(UNDO_HOLD_MAX_MS)
  }

  /** The toast closed without Undo. */
  finish(token: string): void {
    if (this.current?.offer.token === token) void this.end()
  }

  /** Ends the current offer and completes what its action held back. */
  async end(): Promise<void> {
    const current = this.current
    if (!current) return
    this.clear()
    await this.complete(current.action)
  }

  /** Ends the current offer for good: offers made after this complete at once. */
  async close(): Promise<void> {
    this.closed = true
    await this.end()
  }

  private expireAfter(ms: number): void {
    const current = this.current
    if (!current) return
    clearTimeout(current.timer)
    current.timer = setTimeout(() => {
      if (this.current === current) void this.end()
    }, ms)
  }

  private async complete(action: UndoableAction): Promise<void> {
    if (!action.finalize) return
    try {
      await action.finalize()
    } catch (error) {
      this.onError('finish the action after Undo was no longer offered', error)
    }
  }

  private clear(): void {
    const current = this.current
    if (!current) return
    clearTimeout(current.timer)
    this.current = undefined
    this.publishEnd(current.offer.token)
  }
}
