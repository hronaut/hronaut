import { randomUUID } from 'node:crypto'
import { UNDO_OFFER_MS, type UndoKind, type UndoOffer } from '../shared/undo.js'

export interface UndoableAction {
  kind: UndoKind
  name: string
  count?: number
  /** Puts things back as they were. */
  undo: () => Promise<unknown>
  /** Completes what the action held back for Undo, once Undo is no longer offered. */
  finalize?: () => Promise<unknown>
}

/** Time past the toast's own, so a click as the toast leaves still lands. */
const UNDO_GRACE_MS = 1_000

/**
 * The one action the person can undo now. A newer action, the toast closing or quitting ends the offer and completes
 * what the action held back; the toast drives it, with a timer of its own in case the toast never answers.
 */
export class UndoOffers {
  private current: { offer: UndoOffer; action: UndoableAction; timer?: ReturnType<typeof setTimeout> } | undefined

  constructor(
    private readonly publish: (offer: UndoOffer) => void,
    private readonly onError: (action: string, error: unknown) => void
  ) {}

  offer(action: UndoableAction): void {
    void this.end()
    const offer: UndoOffer = { token: randomUUID(), kind: action.kind, name: action.name, count: action.count ?? 1 }
    const current: NonNullable<UndoOffers['current']> = { offer, action }
    current.timer = setTimeout(() => {
      if (this.current === current) void this.end()
    }, UNDO_OFFER_MS + UNDO_GRACE_MS)
    this.current = current
    this.publish(offer)
  }

  /** Undoes the action, when this is still the offer shown. False when it is not. */
  async undo(token: string): Promise<boolean> {
    const current = this.current
    if (!current || current.offer.token !== token) return false
    this.clear()
    await current.action.undo()
    return true
  }

  /** The person is on the toast, so it stays until they close it, and the offer stays with it. */
  hold(token: string): void {
    if (this.current?.offer.token !== token) return
    clearTimeout(this.current.timer)
    this.current.timer = undefined
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
    if (!current.action.finalize) return
    try {
      await current.action.finalize()
    } catch (error) {
      this.onError('finish the action after Undo was no longer offered', error)
    }
  }

  private clear(): void {
    clearTimeout(this.current?.timer)
    this.current = undefined
  }
}
