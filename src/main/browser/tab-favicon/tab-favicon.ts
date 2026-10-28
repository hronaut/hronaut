import { nativeImage } from 'electron'
import { decodeWebsiteFavicon } from '../favicon.js'
import type { TabFaviconAccess, TabFaviconTab } from './tab-favicon-access.js'

const MAX_FAVICON_BYTES = 512 * 1024

/**
 * Loads the first of the page's first eight icon candidates that decodes, as
 * a 32 pixel PNG data URL, and keeps the tab's current icon when none does or
 * a newer icon list superseded this one.
 */
export async function loadFavicon<Tab extends TabFaviconTab>(access: TabFaviconAccess, tab: Tab, favicons: string[]): Promise<void> {
  tab.faviconAbortController?.abort()
  const controller = new AbortController()
  tab.faviconAbortController = controller
  const requestId = ++tab.faviconRequestId
  try {
    const dataUrl = await Promise.any(favicons.slice(0, 8).map(faviconUrl => (
      loadFaviconCandidate(access, tab, faviconUrl, controller.signal)
    )))
    if (access.isDestroyed() || tab.webContents.isDestroyed() || tab.faviconRequestId !== requestId) return
    tab.faviconDataUrl = dataUrl
    // A favicon can finish well after navigation's debounced state save.
    // Persist this update explicitly so a later crash or forced restart
    // does not replace the restored tab icon with the generic globe.
    access.changed()
  } catch {
    // Keep the existing icon when every candidate is invalid or unavailable.
  } finally {
    controller.abort()
    if (tab.faviconAbortController === controller) tab.faviconAbortController = undefined
  }
}

/**
 * Fetches one icon, a data URL directly or a web URL through the page's
 * session, within the size limit, and decodes it.
 */
async function loadFaviconCandidate<Tab extends TabFaviconTab>(access: TabFaviconAccess, tab: Tab, faviconUrl: string, cancellation: AbortSignal): Promise<string> {
  // eslint-disable-next-line no-useless-assignment -- kept as it was in the tab manager, where this rule is off
  let image = nativeImage.createEmpty()
  if (faviconUrl.startsWith('data:')) {
    if (faviconUrl.length > MAX_FAVICON_BYTES * 2) throw new Error('Favicon exceeds the safe encoded size limit')
    // Node's data-URL decoder does not make a network request. Chromium's
    // session.fetch does not support fetching this scheme.
    const response = await fetch(faviconUrl, { signal: cancellation })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_FAVICON_BYTES) throw new Error('Favicon exceeds the safe size limit')
    image = await decodeWebsiteFavicon(bytes, response.headers.get('content-type') ?? '', access.faviconDecoder())
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
    image = await decodeWebsiteFavicon(Buffer.concat(chunks), response.headers.get('content-type') ?? '', access.faviconDecoder())
  }
  if (image.isEmpty()) throw new Error('Favicon could not be decoded')
  return `data:image/png;base64,${image.resize({ width: 32, height: 32, quality: 'best' }).toPNG().toString('base64')}`
}
