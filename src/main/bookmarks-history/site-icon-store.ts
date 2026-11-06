import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeTextFileAtomically } from '../atomic-file.js'
import { isSiteIcon, setChange, type SiteIconChanges, type SiteIcons } from '../../shared/site-icons.js'
import { normalizeHistoryUrl } from '../../shared/visit-history.js'

const SITE_ICONS_VERSION = 1
/** The most pages whose icons are kept: the history holds at most 2,000 pages, and the rest are for bookmarks. */
export const MAX_SITE_ICON_PAGES = 5_000
/** The most icons kept, in memory only, for pages the history and bookmarks do not hold; see `unlisted`. */
export const MAX_UNLISTED_SITE_ICONS = 200
// Icons change far less often than visits, and losing the last few to a crash costs only a globe until the next visit.
const SAVE_DELAY_MS = 5_000

interface PersistedSiteIcons {
  version: typeof SITE_ICONS_VERSION
  /** Each icon once. */
  icons: string[]
  /** Each page's address and the index of its icon in icons, the page whose icon changed longest ago first. */
  pages: [url: string, icon: number][]
}

/** How a sync with the pages the history and bookmarks hold treats the icons of pages they no longer hold. */
export interface SiteIconSyncOptions {
  /** Keep them in memory a while, so Undo of a bookmark removed brings its icon back too; otherwise they go. */
  keepLetGo?: boolean
  /** Let go too of the icons of pages that wait to be listed, such as after the history was cleared. */
  forgetUnlisted?: boolean
}

/** An icon's id: a hash of it, so the pages of a website, which mostly show the same icon, keep it once. */
function siteIconId(icon: string): string {
  return createHash('sha256').update(icon).digest('base64url').slice(0, 22)
}

function noChanges(): SiteIconChanges {
  return { pages: {}, icons: {} }
}

function hasChanges(changes: SiteIconChanges): boolean {
  return Object.keys(changes.pages).length > 0 || Object.keys(changes.icons).length > 0
}

/**
 * The icons tabs showed for pages, so History and Bookmarks show each page by its icon, as Chrome does. Each is the 32
 * pixel PNG data URL a tab showed for the page, kept once however many pages show it. The store keeps the icons of
 * pages the history or the bookmarks hold, saving them a few seconds after a change, and lets go of a page's icon,
 * saving at once, when neither holds the page any more.
 */
export class SiteIconStore {
  /** Each page's icon id, by the page's address as the history keeps it; the page whose icon changed longest ago first. */
  private readonly pages = new Map<string, string>()
  /** The icons by id, with how many pages show each. */
  private readonly icons = new Map<string, { icon: string; pages: number }>()
  /**
   * Icons of pages the history and bookmarks do not hold, in memory only and never shown: a page whose visit is still
   * being recorded, a tab's page that is no visit, such as one restored after the history was cleared, or a page let go
   * with a bookmark the person may bring back with Undo. Each joins the pages once the history or bookmarks hold its page.
   */
  private readonly unlisted = new Map<string, string>()
  private saveQueue: Promise<void> = Promise.resolve()
  private saveTimer: NodeJS.Timeout | undefined
  /** Changes are not saved yet, or their save failed. */
  private unsaved = false
  private disposed = false

  constructor(private readonly path: string) {}

  /** Reads the icons saved; a file that is missing, unreadable or of another version holds none. */
  async load(): Promise<void> {
    this.pages.clear()
    this.icons.clear()
    this.unlisted.clear()
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8'))
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const { version, icons, pages } = parsed as Partial<PersistedSiteIcons>
    if (version !== SITE_ICONS_VERSION || !Array.isArray(icons) || !Array.isArray(pages)) return
    // Each icon is hashed once, however many pages show it.
    const ids = (icons as unknown[]).map((icon) => isSiteIcon(icon) ? siteIconId(icon) : null)
    for (const entry of pages as unknown[]) {
      if (!Array.isArray(entry)) continue
      const [url, index] = entry as unknown[]
      const id = Number.isInteger(index) ? ids[index as number] : undefined
      if (typeof url !== 'string' || normalizeHistoryUrl(url) !== url || !id) continue
      this.setPage(url, icons[index as number] as string, noChanges(), id)
    }
    this.unsaved = false
  }

  /** The icons kept and the pages that show them. */
  snapshot(): SiteIcons {
    return {
      pages: Object.fromEntries(this.pages),
      icons: Object.fromEntries([...this.icons].map(([id, { icon }]) => [id, icon]))
    }
  }

  /** Whether icons wait for the history or bookmarks to hold their pages. */
  hasUnlisted(): boolean {
    return this.unlisted.size > 0
  }

  /**
   * Keeps the icon a tab showed for the page at this web address. A page the store has no icon for waits, unlisted,
   * for the next sync to find it in the history or bookmarks. Answers what changed, 'unlisted' for an icon that waits,
   * or null for nothing.
   */
  remember(url: string, icon: string): SiteIconChanges | 'unlisted' | null {
    const page = normalizeHistoryUrl(url)
    if (this.disposed || !page || !isSiteIcon(icon)) return null
    if (!this.pages.has(page)) {
      this.unlisted.delete(page)
      this.unlisted.set(page, icon)
      for (const oldest of this.unlisted.keys()) {
        if (this.unlisted.size <= MAX_UNLISTED_SITE_ICONS) break
        this.unlisted.delete(oldest)
      }
      return 'unlisted'
    }
    const changes = noChanges()
    this.setPage(page, icon, changes)
    if (!hasChanges(changes)) return null
    this.scheduleSave()
    return changes
  }

  /** Icons that waited for these pages, which the history or bookmarks now hold, join the pages. */
  listPages(pages: Iterable<string>): SiteIconChanges | null {
    if (this.disposed) return null
    const changes = noChanges()
    for (const page of pages) {
      const icon = this.unlisted.get(page)
      if (icon === undefined) continue
      this.unlisted.delete(page)
      this.setPage(page, icon, changes)
    }
    if (!hasChanges(changes)) return null
    this.scheduleSave()
    return changes
  }

  /**
   * Keeps the icons of only the pages the history and bookmarks hold, by their addresses as the history keeps them:
   * icons that waited for their page to be listed join the pages, and those of pages no longer held go, saved at once.
   * Answers what changed, or null for nothing.
   */
  sync(listed: ReadonlySet<string>, options: SiteIconSyncOptions = {}): SiteIconChanges | null {
    if (this.disposed) return null
    const changes = noChanges()
    for (const [page, icon] of this.unlisted) {
      if (!listed.has(page)) continue
      this.unlisted.delete(page)
      this.setPage(page, icon, changes)
    }
    const letGo = [...this.pages.keys()].filter((page) => !listed.has(page))
    for (const page of letGo) {
      const icon = this.removePage(page, changes)
      if (options.keepLetGo && icon) this.unlisted.set(page, icon)
    }
    if (options.forgetUnlisted) this.unlisted.clear()
    for (const oldest of this.unlisted.keys()) {
      if (this.unlisted.size <= MAX_UNLISTED_SITE_ICONS) break
      this.unlisted.delete(oldest)
    }
    if (!hasChanges(changes)) return null
    // An icon let go leaves the file at once, so clearing the history leaves no trace of a page in it.
    if (letGo.length) this.saveNow()
    else this.scheduleSave()
    return changes
  }

  /** Saves the changes not saved yet, including any whose save failed. */
  async flush(): Promise<void> {
    if (this.unsaved) this.saveNow()
    await this.saveQueue
  }

  /** Stops keeping new icons and the timed save; flush still saves what changed before. */
  dispose(): void {
    this.disposed = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
  }

  /** Gives the page this icon, last in the order, and lets go of the icon it showed before when no other page shows it. */
  private setPage(page: string, icon: string, changes: SiteIconChanges, id = siteIconId(icon)): void {
    const previous = this.pages.get(page)
    if (previous === id) return
    const kept = this.icons.get(id)
    if (kept) kept.pages += 1
    else {
      this.icons.set(id, { icon, pages: 1 })
      setChange(changes.icons, id, icon)
    }
    this.pages.delete(page)
    this.pages.set(page, id)
    setChange(changes.pages, page, id)
    if (previous) this.releaseIcon(previous, changes)
    for (const oldest of this.pages.keys()) {
      if (this.pages.size <= MAX_SITE_ICON_PAGES) break
      this.removePage(oldest, changes)
    }
    this.unsaved = true
  }

  /** Lets go of a page's icon; answers the icon it showed. */
  private removePage(page: string, changes: SiteIconChanges): string | undefined {
    const id = this.pages.get(page)
    if (id === undefined) return undefined
    const icon = this.icons.get(id)?.icon
    this.pages.delete(page)
    setChange(changes.pages, page, null)
    this.releaseIcon(id, changes)
    this.unsaved = true
    return icon
  }

  private releaseIcon(id: string, changes: SiteIconChanges): void {
    const kept = this.icons.get(id)
    if (!kept) return
    kept.pages -= 1
    if (kept.pages > 0) return
    this.icons.delete(id)
    setChange(changes.icons, id, null)
  }

  private scheduleSave(): void {
    if (this.saveTimer || this.disposed) return
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS)
    this.saveTimer.unref()
  }

  /**
   * Saves the icons as they are now, after any save under way. A save that fails leaves them unsaved, for the next
   * change's save or flush to try again.
   */
  private saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    this.unsaved = false
    const ids = [...this.icons.keys()]
    const indexes = new Map(ids.map((id, index) => [id, index]))
    const value: PersistedSiteIcons = {
      version: SITE_ICONS_VERSION,
      icons: ids.map((id) => this.icons.get(id)!.icon),
      pages: [...this.pages].map(([page, id]) => [page, indexes.get(id)!])
    }
    this.saveQueue = this.saveQueue
      .then(() => writeTextFileAtomically(this.path, `${JSON.stringify(value)}\n`, 0o600))
      .catch((error: unknown) => {
        this.unsaved = true
        console.error('[site icons] Failed to save site icons:', error)
      })
  }
}
