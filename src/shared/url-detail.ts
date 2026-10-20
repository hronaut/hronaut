/** Follows an address in a snapshot's URL line when its detail was left out. */
export const URL_DETAIL_OMITTED_NOTE = '(query and fragment omitted)'

/**
 * An address without its detail, as agents see it when the person chose to keep URL query strings and fragments out
 * of their transcripts: an HTTP(S) URL's origin and path, without credentials, query or fragment; `about:blank` as
 * it is; another URL's scheme alone, such as `file:` or `data:`; and nothing for a value that is not a URL, so a
 * malformed address is never passed through.
 */
export function urlWithoutDetail(value: string): string {
  try {
    const url = new URL(value)
    // A Java server's session in the path, as `/cart;jsessionid=…`, is detail too. The page snapshot scripts embed this
    // function's source, so the pattern stays inline.
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname.replace(/;(jsessionid)=[^;/]*/giu, ';$1=[REDACTED]')
    return url.href === 'about:blank' ? url.href : url.protocol
  } catch {
    return ''
  }
}

/** The value with each well-formed run of percent escapes decoded, as Chromium decodes some of them for display. */
function decoded(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/giu, run => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run
    }
  })
}

/**
 * Whether a tab's title shows its address rather than a title the page set: the address or its start, with or
 * without the scheme and with or without its escapes decoded, as Chromium shows a page with no title, or a title
 * that repeats the address's query or fragment. Such a title would carry the detail `urlWithoutDetail` leaves out.
 */
export function titleShowsUrlDetail(title: string, value: string): boolean {
  const shown = title.trim()
  if (!shown) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Nothing to compare with: only a title that is the whole value is known to be it.
    return shown === value.trim()
  }
  const withoutScheme = url.href.slice(url.protocol.length).replace(/^\/\//u, '')
  // The start of the address counts only once it reaches past the host, so a short title that happens to begin
  // the same way stays. The host is never escaped, so decoding leaves everything before its end in place.
  const hostEnd = url.host ? withoutScheme.indexOf(url.host) + url.host.length : 0
  const schemeEnd = url.href.length - withoutScheme.length
  for (const [title, href, address] of [[shown, url.href, withoutScheme], [decoded(shown), decoded(url.href), decoded(withoutScheme)]] as const) {
    if (href.startsWith(title) && title.length >= schemeEnd + hostEnd) return true
    if (address.startsWith(title) && title.length >= hostEnd) return true
  }
  // A repeated query or fragment of a few characters counts with its ? or #, and alone only when it cannot be
  // ordinary words: long, or a query's name=value pairs. So a title such as "All about cats" keeps #about.
  return [url.search, url.hash].some((part) => {
    const bare = part.slice(1)
    if (bare.length < 4) return false
    const echoes = bare.length >= 16 || (part.startsWith('?') && bare.includes('=')) ? [part, bare] : [part]
    return echoes.some(echo => shown.includes(echo) || decoded(shown).includes(decoded(echo)))
  })
}

/** A title that is itself a whole address with a query, fragment or sign-in details, such as a page named by its URL. */
function urlShapedTitle(title: string): boolean {
  if (/\s/u.test(title.trim())) return false
  try {
    const url = new URL(title.trim())
    return url.search.length > 1 || url.hash.length > 1 || url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}

/**
 * A tab's title as agents read it when the person chose to omit URL detail: a title that shows the tab's address
 * becomes that address as `urlWithoutDetail` shows it, a title that is itself an address with detail is shortened
 * the same way, and any other title stays as the page set it.
 */
export function titleWithoutUrlDetail(title: string, value: string): string {
  if (titleShowsUrlDetail(title, value)) return urlWithoutDetail(value)
  return urlShapedTitle(title) ? urlWithoutDetail(title.trim()) : title
}
