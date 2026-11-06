import { nativeImage, type NativeImage } from 'electron'
import type { Browser } from '../browser.js'
import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import { decodeWebsiteFavicon } from '../favicon.js'

const MAX_FAVICON_BYTES = 512 * 1024
/** The size, in pixels, of the icon the tab shows. */
const FAVICON_SIZE = 32

/**
 * Loads the page's first eight icon candidates at once and shows the best of them as a 32 pixel PNG data URL: the first
 * in the page's order that is at least that size, or else the largest that decodes. It keeps the tab's current icon
 * when none does or a newer icon list superseded this one.
 */
export async function loadFavicon(browser: Browser, tab: BrowserTab, favicons: string[]): Promise<void> {
  tab.faviconAbortController?.abort()
  const controller = new AbortController()
  tab.faviconAbortController = controller
  const requestId = ++tab.faviconRequestId
  try {
    const dataUrl = await bestFavicon(favicons.slice(0, 8).map(faviconUrl => (
      loadFaviconCandidate(browser, tab, faviconUrl, controller.signal).catch(() => undefined)
    )))
    if (browser.destroyed || tab.webContents.isDestroyed() || tab.faviconRequestId !== requestId) return
    tab.faviconDataUrl = dataUrl
    // A favicon can finish well after navigation's debounced state save.
    // Persist this update explicitly so a later crash or forced restart
    // does not replace the restored tab icon with the generic globe.
    publishChange(browser)
  } catch {
    // Keep the existing icon when every candidate is invalid or unavailable.
  } finally {
    controller.abort()
    if (tab.faviconAbortController === controller) tab.faviconAbortController = undefined
  }
}

/**
 * The icon to show, as a 32 pixel PNG data URL, of candidates loading at once, in the page's order: the first that is at
 * least that size, without waiting for those after it, or else the largest. The tab showed whichever arrived first, so a
 * page listing a small icon beside a large one could get the small one scaled up, blurred. It rejects when none decoded.
 */
async function bestFavicon(candidates: Promise<NativeImage | undefined>[]): Promise<string> {
  let largest: NativeImage | undefined
  for (const candidate of candidates) {
    const image = await candidate
    if (!image) continue
    if (longerSide(image) >= FAVICON_SIZE) return pngDataUrl(image)
    if (!largest || longerSide(image) > longerSide(largest)) largest = image
  }
  if (!largest) throw new Error('No favicon candidate could be decoded')
  return pngDataUrl(largest)
}

function longerSide(image: NativeImage): number {
  const { width, height } = image.getSize()
  return Math.max(width, height)
}

function pngDataUrl(image: NativeImage): string {
  return `data:image/png;base64,${image.resize({ width: FAVICON_SIZE, height: FAVICON_SIZE, quality: 'best' }).toPNG().toString('base64')}`
}

/**
 * Fetches one icon, a data URL directly or a web URL through the page's
 * session, within the size limit, and decodes it.
 */
async function loadFaviconCandidate(browser: Browser, tab: BrowserTab, faviconUrl: string, cancellation: AbortSignal): Promise<NativeImage> {
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
  return image
}
