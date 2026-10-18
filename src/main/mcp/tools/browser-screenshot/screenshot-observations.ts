import { randomUUID } from 'node:crypto'
import type { TrackedScreenshot } from '../../../browser/screenshot-observations/tracked-screenshot.js'

/** How many tracked screenshots one MCP session keeps, and for how long after their last use. */
export const SCREENSHOT_OBSERVATION_LIMITS = { retained: 16, idleMs: 10 * 60_000 } as const

/** How a tracked screenshot compares with the observation the caller named, if any. */
export type ScreenshotObservationReport =
  | { status: 'NEW'; observationId: string; baseline?: 'unavailable'; reason?: 'unknown-or-expired' | 'not-comparable' }
  | { status: 'CHANGED'; observationId: string; comparedWith: string }
  | { status: 'UNCHANGED'; observationId: string }
  | { status: 'NOT_TRACKED'; reason: 'changed-during-capture' }

interface ScreenshotObservation {
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
 * each other's baseline.
 */
export class ScreenshotObservations {
  private readonly records = new Map<string, ScreenshotObservation>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Compares the capture with the named observation, if any, and keeps it as a new observation unless it matched. */
  observe(workspaceId: string, capture: TrackedScreenshot, ifChangedSince?: string): ScreenshotObservationReport {
    this.prune()
    const previous = ifChangedSince === undefined ? undefined : this.records.get(ifChangedSince)
    const known = previous?.workspaceId === workspaceId ? previous : undefined
    const { comparable } = capture
    if (comparable === undefined) return { status: 'NOT_TRACKED', reason: 'changed-during-capture' }
    const keep = (): string => this.keep(workspaceId, capture.pixels.digest, comparable)
    if (ifChangedSince === undefined) return { status: 'NEW', observationId: keep() }
    if (!known) return { status: 'NEW', observationId: keep(), baseline: 'unavailable', reason: 'unknown-or-expired' }
    if (known.comparable !== comparable) return { status: 'NEW', observationId: keep(), baseline: 'unavailable', reason: 'not-comparable' }
    this.touch(ifChangedSince, known)
    if (known.digest === capture.pixels.digest) return { status: 'UNCHANGED', observationId: ifChangedSince }
    return { status: 'CHANGED', observationId: keep(), comparedWith: ifChangedSince }
  }

  private keep(workspaceId: string, digest: string, comparable: string): string {
    const observationId = randomUUID()
    this.records.set(observationId, { workspaceId, digest, comparable, usedAt: this.now() })
    while (this.records.size > SCREENSHOT_OBSERVATION_LIMITS.retained) {
      const oldest = this.records.keys().next().value as string
      this.records.delete(oldest)
    }
    return observationId
  }

  /** Marks a record used and moves it to the newest end, so eviction takes the least recently used first. */
  private touch(observationId: string, record: ScreenshotObservation): void {
    record.usedAt = this.now()
    this.records.delete(observationId)
    this.records.set(observationId, record)
  }

  private prune(): void {
    const oldest = this.now() - SCREENSHOT_OBSERVATION_LIMITS.idleMs
    for (const [observationId, record] of this.records) if (record.usedAt < oldest) this.records.delete(observationId)
  }
}
