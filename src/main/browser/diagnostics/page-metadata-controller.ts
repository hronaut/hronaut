import type { WebContents } from 'electron'
import { pageMetadataScript } from '../../../shared/page-metadata.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import type { BrowserPageMetadataReport } from '../../../shared/types.js'

const PAGE_METADATA_WORLD_ID = 1004

export interface PageMetadataTab {
  id: string
  url: string
  navigationGeneration: number
  webContents: Pick<WebContents, 'executeJavaScriptInIsolatedWorld' | 'isDestroyed'>
}

interface PageMetadataHost<Tab extends PageMetadataTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
}

/** Read-only diagnostic service. The host owns contents and their lifetime;
 * this service retains no tabs, timers, debugger leases or listeners to dispose. */
export class PageMetadataController<Tab extends PageMetadataTab> {
  constructor(private readonly host: PageMetadataHost<Tab>) {}

  async inspect(tabId?: string): Promise<BrowserPageMetadataReport> {
    const tab = this.host.getTab(tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting page metadata')
    const generation = tab.navigationGeneration
    const url = tab.url
    const result = await tab.webContents.executeJavaScriptInIsolatedWorld(
      PAGE_METADATA_WORLD_ID, [{ code: pageMetadataScript() }], false
    ) as Omit<BrowserPageMetadataReport, 'tabId'>
    if (this.host.findTab(tab.id) !== tab || tab.webContents.isDestroyed()
      || tab.navigationGeneration !== generation || tab.url !== url) {
      throw new Error('The page changed during metadata inspection. Inspect the current document again.')
    }
    const safeUrl = (value: string | null): string | null => {
      if (!value) return null
      try { return redactNetworkUrl(new URL(value, result.url).href) }
      catch { return '[invalid URL]' }
    }
    return {
      ...result,
      tabId: tab.id,
      url: redactNetworkUrl(result.url),
      document: { ...result.document, manifestUrl: safeUrl(result.document.manifestUrl),
        canonicalUrls: result.document.canonicalUrls.map(value => safeUrl(value) ?? value) },
      openGraph: { ...result.openGraph, url: safeUrl(result.openGraph.url),
        images: result.openGraph.images.map(image => ({ ...image, url: safeUrl(image.url) ?? image.url })) },
      twitter: { ...result.twitter,
        images: result.twitter.images.map(image => ({ ...image, url: safeUrl(image.url) ?? image.url })) },
      alternateLinks: result.alternateLinks.map(link => ({ ...link, url: safeUrl(link.url) ?? link.url })),
      icons: result.icons.map(icon => ({ ...icon, url: safeUrl(icon.url) ?? icon.url }))
    }
  }
}
