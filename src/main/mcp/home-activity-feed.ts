import { randomBytes } from 'node:crypto'
import { HOME_ACTIVITY_FEED_LIMIT, type HomeFeedEntry } from '../../shared/home.js'

/**
 * Agents' finished steps for Home's activity feed: the newest HOME_ACTIVITY_FEED_LIMIT across all workspaces, in memory
 * only. Entries carry what the shell's step history already shows (a step kind, a cleaned target, the outcome and time)
 * and are forgotten with their workspace or when the person clears their history.
 */
export class HomeActivityFeed {
  private entries: HomeFeedEntry[] = []
  private count = 0
  private changes = 0
  /** Each feed's own, so an entry from before an MCP restart never shares an id with a new one. */
  private readonly prefix = `f${randomBytes(4).toString('hex')}`

  add(entry: Omit<HomeFeedEntry, 'id'>): void {
    this.count += 1
    this.changes += 1
    this.entries.push({ ...entry, id: `${this.prefix}-${this.count.toString(36)}` })
    if (this.entries.length > HOME_ACTIVITY_FEED_LIMIT) this.entries.splice(0, this.entries.length - HOME_ACTIVITY_FEED_LIMIT)
  }

  /** Newest first, as copies. */
  list(): HomeFeedEntry[] {
    return this.entries.map((entry) => ({ ...entry })).reverse()
  }

  /** Increases whenever the list changes. */
  get revision(): number {
    return this.changes
  }

  /** Drops a workspace's entries, such as when it is closed, archived or deleted. */
  forgetWorkspace(workspaceId: string): void {
    const kept = this.entries.filter((entry) => entry.workspaceId !== workspaceId)
    if (kept.length === this.entries.length) return
    this.entries = kept
    this.changes += 1
  }

  /** Drops the entries from `since` (epoch milliseconds) on, as history cleared for a time range. */
  forgetSince(since: number): void {
    const kept = this.entries.filter((entry) => entry.at < since)
    if (kept.length === this.entries.length) return
    this.entries = kept
    this.changes += 1
  }

  clear(): void {
    if (!this.entries.length) return
    this.entries = []
    this.changes += 1
  }
}
