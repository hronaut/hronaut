/** The longest site icon kept: a 32 pixel PNG data URL, as a tab shows a page's icon, is far shorter. */
export const MAX_SITE_ICON_LENGTH = 16 * 1024

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

/** The icons History and Bookmarks show beside pages, as tabs showed them. */
export interface SiteIcons {
  /**
   * Each page's icon id, by the page's address as the history keeps it (normalizeHistoryUrl), the page whose icon
   * changed longest ago first.
   */
  pages: Record<string, string>
  /** The icons by id, each a 32 pixel PNG data URL that one or more pages show. */
  icons: Record<string, string>
}

/** Pages and icons that changed since the windows last heard, in the order they changed, null for those let go. */
export interface SiteIconChanges {
  pages: Record<string, string | null>
  icons: Record<string, string | null>
}

/** The website a page belongs to: the origin of its web address, or null for any other address. */
export function siteIconOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

/** Whether this is an icon as Hronaut keeps a page's: a PNG data URL no longer than MAX_SITE_ICON_LENGTH. */
export function isSiteIcon(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SITE_ICON_LENGTH && PNG_DATA_URL.test(value)
}

/** Sets a changed value last in a record of changes, so the record keeps the order things changed in. */
export function setChange<T>(record: Record<string, T>, key: string, value: T): void {
  Reflect.deleteProperty(record, key)
  record[key] = value
}

/** Whether any page's icon or any icon changed. */
export function hasSiteIconChanges(changes: SiteIconChanges): boolean {
  return Object.keys(changes.pages).length > 0 || Object.keys(changes.icons).length > 0
}

/** Puts later changes into these, each page or icon that changed again moving last. */
export function addSiteIconChanges(changes: SiteIconChanges, later: SiteIconChanges | null): void {
  if (!later) return
  for (const [page, id] of Object.entries(later.pages)) setChange(changes.pages, page, id)
  for (const [id, icon] of Object.entries(later.icons)) setChange(changes.icons, id, icon)
}

/** The icons with these changes made to them, in a new record; each page that changed moves last. */
export function withSiteIconChanges(icons: SiteIcons, changes: SiteIconChanges): SiteIcons {
  const pages = { ...icons.pages }
  const kept = { ...icons.icons }
  for (const [page, id] of Object.entries(changes.pages)) {
    Reflect.deleteProperty(pages, page)
    if (id !== null) pages[page] = id
  }
  for (const [id, icon] of Object.entries(changes.icons)) {
    if (icon === null) Reflect.deleteProperty(kept, id)
    else kept[id] = icon
  }
  return { pages, icons: kept }
}

/**
 * Finds the icon History or Bookmarks shows for a page: the one a tab showed for the page itself, as Chrome shows, or
 * else, for a page no tab has shown an icon for since, the icon that changed last among its website's other pages.
 */
export class SiteIconIndex {
  private readonly websites = new Map<string, string>()

  constructor(private readonly icons: SiteIcons) {
    for (const [page, id] of Object.entries(icons.pages)) {
      // A page's address as the history keeps it is its origin and then a path, so its origin needs no parsing, which
      // thousands of pages would take each time an icon changes. Pages come in the order their icons changed, so the
      // last page of each website gives its icon.
      const pathStart = page.indexOf('/', page.indexOf('//') + 2)
      this.websites.set(pathStart < 0 ? page : page.slice(0, pathStart), id)
    }
  }

  /** The icon for the page at this address as the history keeps it, of this website; undefined for none. */
  iconFor(page: string | null, origin: string | null): string | undefined {
    const id = (page !== null && Object.hasOwn(this.icons.pages, page) ? this.icons.pages[page] : undefined)
      ?? (origin !== null ? this.websites.get(origin) : undefined)
    return id !== undefined && Object.hasOwn(this.icons.icons, id) ? this.icons.icons[id] : undefined
  }
}
