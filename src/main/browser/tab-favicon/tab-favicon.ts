import { nativeImage } from 'electron'
import type { Browser } from '../browser.js'
import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import { decodeWebsiteFavicon } from '../favicon.js'
import { normalizeHistoryUrl } from '../../../shared/visit-history.js'

const MAX_FAVICON_BYTES = 512 * 1024
/** The size, in pixels, of the icon a tab shows. */
const FAVICON_SIZE = 32

/** A page's icon, decoded. */
interface LoadedFavicon {
  /** Its own size, in pixels, on its shorter side. */
  size: number
  /** It as a 32 pixel PNG data URL. */
  dataUrl: string
}

/**
 * Loads the page's first eight icon candidates at once and shows each that is larger than the one shown before it, as a
 * 32 pixel PNG data URL, until one is at least that size; the others then stop loading. A page that lists a small icon
 * beside a large one, as many do, so ends up with the large one, sharp, even when the small one arrives first. It keeps
 * the tab's current icon when none decodes, and shows nothing more once a newer icon list superseded this one.
 */
export async function loadFavicon(browser: Browser, tab: BrowserTab, favicons: string[]): Promise<void> {
  tab.faviconAbortController?.abort()
  const controller = new AbortController()
  tab.faviconAbortController = controller
  const requestId = ++tab.faviconRequestId
  // The document that gave the list, and its page: a list the page a navigation replaces gave as it was leaving is not
  // the new page's, though nothing aborts it when the new page commits.
  const list = { requestId, documentGeneration: tab.documentGeneration, url: tab.url }
  let shownSize = 0
  const show = (icon: LoadedFavicon): void => {
    if (icon.size <= shownSize || controller.signal.aborted) return
    if (browser.destroyed || tab.webContents.isDestroyed() || tab.faviconRequestId !== requestId) return
    if (tab.documentGeneration !== list.documentGeneration) return
    shownSize = icon.size
    tab.faviconDataUrl = icon.dataUrl
    // A favicon can finish well after navigation's debounced state save.
    // Persist this update explicitly so a later crash or forced restart
    // does not replace the restored tab icon with the generic globe.
    publishChange(browser)
    giveSiteIcon(browser, tab, list, icon.dataUrl)
    if (icon.size >= FAVICON_SIZE) controller.abort()
  }
  try {
    // An icon that is invalid or unavailable is left out.
    await Promise.all(favicons.slice(0, 8).map(faviconUrl => (
      loadFaviconCandidate(browser, tab, faviconUrl, controller.signal).then(show).catch(() => undefined)
    )))
  } finally {
    controller.abort()
    if (tab.faviconAbortController === controller) tab.faviconAbortController = undefined
  }
}

/**
 * Gives History and Bookmarks the page's icon from the first icon list its document gave, and each larger icon of that
 * list as it arrives, but not from a list the document gives later, such as for an unread count, a build's status or
 * an animation's frames, which would replace the page's icon there time after time.
 */
function giveSiteIcon(browser: Browser, tab: BrowserTab, list: { requestId: number; documentGeneration: number; url: string },
  icon: string): void {
  if (!browser.options.onSiteIcon || !normalizeHistoryUrl(list.url)) return
  const source = tab.siteIconSource
  if (source?.documentGeneration === list.documentGeneration && source.requestId !== list.requestId) return
  tab.siteIconSource = { documentGeneration: list.documentGeneration, requestId: list.requestId, icon }
  browser.options.onSiteIcon({ url: list.url, icon })
}

/**
 * A route the tab's document went to, such as through `history.pushState`, is a page of its own in the history, and
 * gets the icon the document gave first: the icons a single-page app gives later are its unread counts and statuses.
 */
export function giveRouteSiteIcon(browser: Browser, tab: BrowserTab): void {
  const source = tab.siteIconSource
  if (!source || source.documentGeneration !== tab.documentGeneration || !normalizeHistoryUrl(tab.url)) return
  browser.options.onSiteIcon?.({ url: tab.url, icon: source.icon })
}

/**
 * Fetches one icon, a data URL directly or a web URL through the page's
 * session, within the size limit, and decodes it.
 */
async function loadFaviconCandidate(browser: Browser, tab: BrowserTab, faviconUrl: string, cancellation: AbortSignal): Promise<LoadedFavicon> {
  // eslint-disable-next-line no-useless-assignment -- kept as it was in the tab manager, where this rule is off
  let image = nativeImage.createEmpty()
  if (faviconUrl.startsWith('data:')) {
    if (faviconUrl.length > MAX_FAVICON_BYTES * 2) throw new Error('Favicon exceeds the safe encoded size limit')
    // Node's data-URL decoder does not make a network request. Chromium's
    // session.fetch does not support fetching this scheme.
    const response = await fetch(faviconUrl, { signal: cancellation })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_FAVICON_BYTES) throw new Error('Favicon exceeds the safe size limit')
    image = await decodeWebsiteFavicon(bytes, response.headers.get('content-type') ?? '', browser.faviconDecoder, cancellation)
  } else {
    const parsed = new URL(faviconUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported favicon URL')
    const response = await tab.webContents.session.fetch(parsed.href, {
      credentials: 'include',
      signal: AbortSignal.any([cancellation, AbortSignal.timeout(5_000)])
    })
    if (!response.ok) throw new Error('Favicon request failed')
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_FAVICON_BYTES) {
      await response.body?.cancel()
      throw new Error('Favicon exceeds the safe size limit')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Favicon response body is unavailable')
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_FAVICON_BYTES) {
        await reader.cancel()
        throw new Error('Favicon exceeds the safe size limit')
      }
      chunks.push(Buffer.from(value))
    }
    image = await decodeWebsiteFavicon(Buffer.concat(chunks), response.headers.get('content-type') ?? '', browser.faviconDecoder, cancellation)
  }
  if (image.isEmpty()) throw new Error('Favicon could not be decoded')
  const { width, height } = image.getSize()
  const png = image.resize({ width: FAVICON_SIZE, height: FAVICON_SIZE, quality: 'best' }).toPNG()
  return { size: Math.min(width, height), dataUrl: `data:image/png;base64,${png.toString('base64')}` }
}
