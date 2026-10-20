import { extname } from 'node:path'

/** How long a Save Link As name waits for its download to start, as a server can take a while to answer. */
const PENDING_NAME_MS = 5 * 60_000
/** Names waiting per page at most, so links saved from a page whose server never answers cannot pile up. */
const MAX_PENDING_PER_PAGE = 16

interface PendingName {
  url: string
  filename: string
  expiresAt: number
}

function withoutFragment(url: string): string {
  const fragment = url.indexOf('#')
  return fragment < 0 ? url : url.slice(0, fragment)
}

/** Whether every address a download went through, its redirects included, has the origin of the first. */
export function staysOnOrigin(urlChain: readonly string[]): boolean {
  try {
    const origins = new Set(urlChain.map((url) => new URL(url).origin))
    return origins.size === 1 && !origins.has('null')
  } catch {
    return false
  }
}

/**
 * The names pages give links with the `download` attribute, kept from Save Link As until that download starts.
 * Chrome sends the name along with the download, but Electron's `downloadURL` cannot, so the downloads controller
 * takes it back by page and address when the download starts. The first download of that address from that page
 * takes it, which is the saved link's own unless the page fetches the same address as a download at the same time.
 */
export class SavedLinkNames {
  private readonly pending = new Map<number, PendingName[]>()

  constructor(private readonly now: () => number = Date.now) {}

  expect(webContentsId: number, url: string, filename: string): void {
    if (!filename) return
    const now = this.now()
    for (const [id, names] of this.pending) {
      const live = names.filter((name) => name.expiresAt > now)
      if (live.length) this.pending.set(id, live)
      else this.pending.delete(id)
    }
    const names = this.pending.get(webContentsId) ?? []
    names.push({ url: withoutFragment(url), filename, expiresAt: now + PENDING_NAME_MS })
    this.pending.set(webContentsId, names.slice(-MAX_PENDING_PER_PAGE))
  }

  /** The oldest name waiting for this page's download of this address, which then stops waiting. */
  take(webContentsId: number | undefined, url: string): string | undefined {
    if (webContentsId === undefined) return undefined
    const names = this.pending.get(webContentsId)
    if (!names) return undefined
    const now = this.now()
    const address = withoutFragment(url)
    const index = names.findIndex((name) => name.expiresAt > now && name.url === address)
    const filename = names[index]?.filename
    const kept = names.filter((name, position) => position !== index && name.expiresAt > now)
    if (kept.length) this.pending.set(webContentsId, kept)
    else this.pending.delete(webContentsId)
    return filename
  }

  clear(): void {
    this.pending.clear()
  }
}

// Endings Windows runs or follows when it shows the file, which Chromium renames to `.download` (`.url` can send the
// person's Windows credentials to another computer just by being shown in a folder).
const SHELL_INTEGRATED_EXTENSION = /^\.(?:lnk|local|scf|url|\{.*\})$/i

/**
 * The name for a Save Link As download, much as Chromium chooses it: the server's own name when its
 * Content-Disposition names the file, otherwise the link's `download` name, with characters file systems refuse
 * (and `~`, as Chromium does) replaced by `_` and surrounding spaces and dots trimmed, so it cannot be hidden. A name
 * without an extension takes the one the download would otherwise have had, and an extension that Windows runs or
 * follows when it shows the file becomes `.download`. Chromium's name is kept when nothing usable is left.
 */
export function savedLinkFilename(linkName: string, chromiumFilename: string, contentDisposition: string): string {
  if (/(?:^|;)\s*filename\*?\s*=\s*(?:"[^"]|[^\s";])/i.test(contentDisposition)) return chromiumFilename
  const name = linkName
    .replace(/[\p{Cc}\p{Cf}\p{Noncharacter_Code_Point}"~*/:<>?\\|]/gu, '_')
    .replace(/^[\s.]+|[\s.]+$/gu, '')
  if (!/[^_-]/.test(name)) return chromiumFilename
  const named = extname(name) ? name : name + extname(chromiumFilename)
  const extension = extname(named)
  return SHELL_INTEGRATED_EXTENSION.test(extension) ? `${named.slice(0, -extension.length)}.download` : named
}
