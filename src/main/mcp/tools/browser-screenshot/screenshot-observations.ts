import { randomUUID } from 'node:crypto'
import type { TrackedScreenshot, TrackedScreenshotUntrackedReason } from '../../../browser/screenshot-observations/tracked-screenshot.js'

/** How many tracked screenshots one MCP session keeps, and for how long after their last use. */
export const SCREENSHOT_OBSERVATION_LIMITS = { retained: 16, idleMs: 10 * 60_000 } as const

/** How a tracked screenshot compares with the observation the caller named, if any. */
export type ScreenshotObservationReport =
  | { status: 'NEW'; observationId: string; baseline?: 'unavailable'; reason?: 'unknown-or-expired' | 'not-comparable' }
  | { status: 'CHANGED'; observationId: string; comparedWith: string }
  | { status: 'UNCHANGED'; observationId: string }
  | { status: 'NOT_TRACKED'; reason: TrackedScreenshotUntrackedReason }

/** A comparison and the change to the session's observations it makes once its result is published. */
export interface ScreenshotObservation {
  report: ScreenshotObservationReport
  /** Keeps the new observation, or marks the matched one used. Call it only when the result reached the caller. */
  commit(): void
}

interface ScreenshotObservationRecord {
  workspaceId: string
  digest: string
  comparable: string
  usedAt: number
}

/**
 * The tracked screenshots of one MCP session: the pixel fingerprint of each and
 * what it can be compared with, never the image. Records are kept in memory
 * only, at most 16 and each for 10 minutes after its last use, and an id from
 * another session, another workspace or an expired capture is unknown alike.
 * Comparing never changes an existing record, so concurrent calls cannot move
 * each other's baseline, and nothing is kept for a result that was withheld.
 */
export class ScreenshotObservations {
  private readonly records = new Map<string, ScreenshotObservationRecord>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Compares the capture with the named observation, if any. A capture that did not match becomes a new observation once committed. */
  observe(workspaceId: string, capture: TrackedScreenshot, ifChangedSince?: string): ScreenshotObservation {
    this.prune()
    const previous = ifChangedSince === undefined ? undefined : this.records.get(ifChangedSince)
    const known = previous?.workspaceId === workspaceId ? previous : undefined
    const { comparable } = capture
    if (comparable === undefined) return { report: { status: 'NOT_TRACKED', reason: capture.untracked ?? 'changed-during-capture' }, commit: () => undefined }
    if (known && ifChangedSince !== undefined && known.comparable === comparable && known.digest === capture.pixels.digest) {
      return { report: { status: 'UNCHANGED', observationId: ifChangedSince }, commit: () => this.touch(ifChangedSince, known) }
    }
    const observationId = randomUUID()
    const commit = (): void => {
      if (known && ifChangedSince !== undefined && known.comparable === comparable) this.touch(ifChangedSince, known)
      this.keep(observationId, { workspaceId, digest: capture.pixels.digest, comparable, usedAt: this.now() })
    }
    if (ifChangedSince === undefined) return { report: { status: 'NEW', observationId }, commit }
    if (!known) return { report: { status: 'NEW', observationId, baseline: 'unavailable', reason: 'unknown-or-expired' }, commit }
    if (known.comparable !== comparable) return { report: { status: 'NEW', observationId, baseline: 'unavailable', reason: 'not-comparable' }, commit }
    return { report: { status: 'CHANGED', observationId, comparedWith: ifChangedSince }, commit }
  }

  private keep(observationId: string, record: ScreenshotObservationRecord): void {
    this.records.set(observationId, record)
    while (this.records.size > SCREENSHOT_OBSERVATION_LIMITS.retained) {
      const oldest = this.records.keys().next().value as string
      this.records.delete(oldest)
    }
  }

  /** Marks a record used and moves it to the newest end, so eviction takes the least recently used first. */
  private touch(observationId: string, record: ScreenshotObservationRecord): void {
    // A record that expired or was evicted since the comparison stays gone.
    if (this.records.get(observationId) !== record) return
    record.usedAt = this.now()
    this.records.delete(observationId)
    this.records.set(observationId, record)
  }

  private prune(): void {
    const oldest = this.now() - SCREENSHOT_OBSERVATION_LIMITS.idleMs
    for (const [observationId, record] of this.records) if (record.usedAt < oldest) this.records.delete(observationId)
  }
}
