// Chromium names an untitled page by its address as it shows it: `app.example/callback#access_token=…`, without
// `http://` (and sometimes without `https://` or a leading `www.`), with escapes decoded and right-to-left text wrapped
// in U+202A … U+202C. After `history.replaceState` the page keeps that name although its address changed, since the
// replaced entry keeps the old one's display title. These are the prefixes a shown address can have lost.
const SHOWN_ADDRESS_PREFIXES = ['', 'http://', 'https://', 'http://www.', 'https://www.']

/** A web address's site, and the address without its sign-in or fragment with escapes decoded; null for any other. */
function comparableAddress(href: string): { origin: string; address: string } | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
  url.username = ''
  url.password = ''
  url.hash = ''
  const address = url.href.replace(/(?:%[\da-f]{2})+/giu, (escapes) => {
    try {
      return decodeURIComponent(escapes)
    } catch {
      return escapes
    }
  })
  return { origin: url.origin, address }
}

/**
 * Whether Chromium's title for the page is an address on the page's site other than its new one: the name Chromium
 * gave an untitled page before it changed its address within the document. Its old fragment can hold a sign-in token.
 */
export function isStaleAddressTitle(title: string, previousUrl: string, url: string): boolean {
  const site = comparableAddress(previousUrl)?.origin
  const current = comparableAddress(url)?.address
  if (!site || !current) return false
  const shown = title.replace(/^\u202A/u, '').replace(/\u202C$/u, '').trim()
  if (!shown || /\s/u.test(shown.split(/[/?#]/u, 1)[0] ?? '')) return false
  return SHOWN_ADDRESS_PREFIXES.some((prefix) => {
    const named = comparableAddress(`${prefix}${shown}`)
    return named !== null && named.address !== current && named.origin === site
  })
}

/**
 * Whether Chromium's title for the page is an address on the page's site, its own or an earlier one: the name Chromium
 * gives an untitled page, whose fragment can hold a sign-in token.
 */
export function isAddressTitle(title: string, url: string): boolean {
  const site = comparableAddress(url)?.origin
  if (!site) return false
  const shown = title.replace(/^\u202A/u, '').replace(/\u202C$/u, '').trim()
  if (!shown || /\s/u.test(shown.split(/[/?#]/u, 1)[0] ?? '')) return false
  return SHOWN_ADDRESS_PREFIXES.some((prefix) => comparableAddress(`${prefix}${shown}`)?.origin === site)
}

/** The page's new address as Chromium shows an untitled page: without its sign-in, `http://` or a bare trailing slash. */
export function untitledPageTitle(href: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return href
  }
  url.username = ''
  url.password = ''
  const shown = url.protocol === 'http:' ? url.href.slice('http://'.length) : url.href
  return url.pathname === '/' && !url.search && !url.hash ? shown.replace(/\/$/u, '') : shown
}
