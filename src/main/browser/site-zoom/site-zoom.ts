import { lstat, readFile, rm } from 'node:fs/promises'
import type { WebContents } from 'electron'
import { writeTextFileAtomically } from '../../atomic-file.js'
import { canonicalStorageId } from '../workspace-storage-deletion.js'
import type { SiteZoomAccess, SiteZoomLevels, SiteZoomTab } from './site-zoom-access.js'

const SITE_ZOOM_VERSION = 1
/** As many sites as one workspace keeps a zoom for; the one zoomed longest ago goes first. */
const MAX_SITES_PER_WORKSPACE = 1_000
/** A saved file larger than all those sites can be is not read. */
const MAX_SITE_ZOOM_FILE_BYTES = 4 * 1024 * 1024
/** As Hronaut zooms a page: 50% to 400%. */
const MIN_ZOOM_PERCENT = 50
const MAX_ZOOM_PERCENT = 400

/** The host a website's zoom goes by, as Chromium keeps it, or undefined for a page that is not a website. */
export function siteZoomHost(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname ? parsed.hostname : undefined
  } catch {
    return undefined
  }
}

function isZoomPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_ZOOM_PERCENT && value <= MAX_ZOOM_PERCENT
}

/**
 * Keeps the zoom a page of the tab's site now has for its workspace, as Chrome keeps each site's zoom for its
 * profile: 100% forgets it. A tab with its own zoom, and a page that is not a website, keep none. Returns whether
 * what is kept changed.
 */
export function rememberSiteZoom<Tab extends SiteZoomTab>(access: SiteZoomAccess<Tab>, tab: Tab, percent: number): boolean {
  if (tab.zoomIsolated || tab.webContents.isDestroyed()) return false
  const storageId = access.storageId(tab)
  const host = siteZoomHost(tab.webContents.getURL())
  if (!storageId || !host || !isZoomPercent(percent)) return false
  const levels = access.levels()
  const sites = levels.get(storageId)
  if (percent === 100) {
    if (!sites?.delete(host)) return false
    if (!sites.size) levels.delete(storageId)
    return true
  }
  if (sites?.get(host) === percent) return false
  const kept = sites ?? new Map<string, number>()
  // Last is the site zoomed most recently, so a full workspace forgets the one zoomed longest ago.
  kept.delete(host)
  kept.set(host, percent)
  while (kept.size > MAX_SITES_PER_WORKSPACE) kept.delete(kept.keys().next().value!)
  levels.set(storageId, kept)
  return true
}

/**
 * Gives a page the zoom kept for its site in its workspace as each of its documents commits, as Chrome does after a
 * restart: Chromium shares it with the workspace's other tabs of the site, so it reaches them too. A tab with its own
 * zoom keeps it.
 */
export function attachSiteZoom<Tab extends SiteZoomTab>(access: SiteZoomAccess<Tab>, tab: Tab, webContents: WebContents): void {
  webContents.on('did-navigate', (_event, url) => {
    if (webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || tab.zoomIsolated || tab.sleeping) return
    const storageId = access.storageId(tab)
    const host = siteZoomHost(url)
    const percent = storageId && host ? access.levels().get(storageId)?.get(host) : undefined
    if (percent === undefined || Math.round(webContents.getZoomFactor() * 100) === percent) return
    webContents.setZoomFactor(percent / 100)
    tab.nativeInputEnvironmentGeneration += 1
    access.changed(false)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A host name as a website address has it, so a hand-edited file cannot name anything else. */
function isHost(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 253 && siteZoomHost(`http://${value}/`) === value
}

/**
 * Each workspace's zoom for each site, kept for the next start in the profile, as Chrome keeps it. A file that is
 * missing or cannot be read only loses it, and the next save replaces it.
 */
export class SiteZoomStore {
  private saveQueue: Promise<void> = Promise.resolve()
  private written: string | undefined

  constructor(private readonly path: string) {}

  async load(): Promise<SiteZoomLevels> {
    let contents: string
    try {
      // lstat refuses a link, which the profile never holds here.
      const entry = await lstat(this.path)
      if (!entry.isFile() || entry.size > MAX_SITE_ZOOM_FILE_BYTES) throw new Error('Not a saved site zoom')
      contents = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[browser] The saved site zoom could not be read; sites start at 100%.')
      return new Map()
    }
    try {
      const data = JSON.parse(contents) as unknown
      if (!isRecord(data) || data.version !== SITE_ZOOM_VERSION || !Array.isArray(data.workspaces)) throw new Error('Not a saved site zoom')
      const levels: SiteZoomLevels = new Map()
      for (const workspace of data.workspaces) {
        if (!isRecord(workspace) || !Array.isArray(workspace.sites)) continue
        const storageId = canonicalStorageId(workspace.storageId)
        if (!storageId || levels.has(storageId)) continue
        const sites = new Map<string, number>()
        for (const site of workspace.sites.slice(-MAX_SITES_PER_WORKSPACE)) {
          if (isRecord(site) && isHost(site.host) && isZoomPercent(site.percent) && site.percent !== 100) sites.set(site.host, site.percent)
        }
        if (sites.size) levels.set(storageId, sites)
      }
      this.written = contents
      return levels
    } catch {
      console.warn('[browser] The saved site zoom could not be read; sites start at 100%.')
      return new Map()
    }
  }

  /**
   * Saves the zoom kept for each site of the workspaces given, taken when the save's turn comes, unless the file holds
   * it already. Nothing is saved when none are given, as once the browser closes. A write that fails removes the file,
   * so a zoom reset since does not come back at the next start.
   */
  save(levels: () => SiteZoomLevels | undefined): Promise<void> {
    const operation = this.saveQueue.then(async () => {
      const current = levels()
      if (!current) return
      const workspaces = [...current].filter(([, sites]) => sites.size)
        .map(([storageId, sites]) => ({ storageId, sites: [...sites].map(([host, percent]) => ({ host, percent })) }))
      const contents = `${JSON.stringify({ version: SITE_ZOOM_VERSION, workspaces })}\n`
      if (contents === this.written) return
      try {
        await writeTextFileAtomically(this.path, contents, 0o600)
      } catch (error) {
        this.written = undefined
        await rm(this.path, { force: true }).catch(() => undefined)
        throw error
      }
      this.written = contents
    })
    this.saveQueue = operation.catch(() => undefined)
    return operation
  }
}
