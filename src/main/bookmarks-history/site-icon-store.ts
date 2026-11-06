import { readFile } from 'node:fs/promises'
import { writeTextFileAtomically } from '../atomic-file.js'
import { isSiteIcon, siteIconOrigin } from '../../shared/site-icons.js'

const SITE_ICONS_VERSION = 1
/** The most websites whose icons are kept, far more than a history of 2,000 pages usually visits. */
export const MAX_SITE_ICONS = 500
// Icons change far less often than visits, and losing the last few to a crash costs only a globe until the next visit.
const SAVE_DELAY_MS = 5_000

interface PersistedSiteIcons {
  version: typeof SITE_ICONS_VERSION
  /** The icons, the one changed longest ago first. */
  icons: { origin: string; icon: string }[]
}

/**
 * The icons websites showed in tabs, by origin, so History and Bookmarks show each page by its website's icon, as
 * Chrome does. Each is the 32 pixel PNG data URL a tab showed last for a page of the website. It keeps the icons of the
 * MAX_SITE_ICONS websites whose icons changed last, saves them a few seconds after a change, and lets go of a
 * website's icon, saving at once, when the history and bookmarks no longer hold a page of it.
 */
export class SiteIconStore {
  /** Icons by origin, the one changed or shown longest ago first. */
  private readonly icons = new Map<string, string>()
  private saveQueue: Promise<void> = Promise.resolve()
  private saveTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(private readonly path: string) {}

  /** Reads the icons saved; a file that is missing, unreadable or of another version holds none. */
  async load(): Promise<void> {
    this.icons.clear()
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8'))
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object' || (parsed as PersistedSiteIcons).version !== SITE_ICONS_VERSION) return
    const icons = (parsed as PersistedSiteIcons).icons
    if (!Array.isArray(icons)) return
    for (const entry of icons as unknown[]) {
      const { origin, icon } = (entry ?? {}) as Partial<PersistedSiteIcons['icons'][number]>
      if (typeof origin !== 'string' || siteIconOrigin(origin) !== origin || !isSiteIcon(icon)) continue
      this.icons.delete(origin)
      this.icons.set(origin, icon)
    }
    this.evictOldest()
  }

  /** Every icon kept, by origin. */
  all(): Record<string, string> {
    return Object.fromEntries(this.icons)
  }

  /**
   * Keeps the icon a tab showed for a page at this web address as its website's. Answers the website's origin when its
   * icon changed, or null when it is the one kept already or not a website's icon.
   */
  remember(url: string, icon: string): string | null {
    const origin = siteIconOrigin(url)
    if (this.disposed || !origin || !isSiteIcon(icon)) return null
    const unchanged = this.icons.get(origin) === icon
    // A website shown again is the last to be let go, whether or not its icon changed; only a change is saved for it.
    this.icons.delete(origin)
    this.icons.set(origin, icon)
    if (unchanged) return null
    this.evictOldest()
    this.scheduleSave()
    return origin
  }

  /** Lets go of the icons of every website but these, saving at once; answers the origins let go. */
  keepOnly(origins: ReadonlySet<string>): string[] {
    const removed = [...this.icons.keys()].filter((origin) => !origins.has(origin))
    if (!removed.length) return []
    for (const origin of removed) this.icons.delete(origin)
    this.saveNow()
    return removed
  }

  /** Saves the icons a change is waiting to save. */
  async flush(): Promise<void> {
    if (this.saveTimer) this.saveNow()
    await this.saveQueue
  }

  dispose(): void {
    this.disposed = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
  }

  private evictOldest(): void {
    for (const origin of this.icons.keys()) {
      if (this.icons.size <= MAX_SITE_ICONS) break
      this.icons.delete(origin)
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer || this.disposed) return
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS)
    this.saveTimer.unref()
  }

  /** Saves the icons as they are now, after any save under way. A save that fails is tried with the next change. */
  private saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    const value: PersistedSiteIcons = { version: SITE_ICONS_VERSION, icons: [...this.icons].map(([origin, icon]) => ({ origin, icon })) }
    this.saveQueue = this.saveQueue
      .then(() => writeTextFileAtomically(this.path, `${JSON.stringify(value)}\n`, 0o600))
      .catch((error: unknown) => { console.error('[site icons] Failed to save site icons:', error) })
  }
}
