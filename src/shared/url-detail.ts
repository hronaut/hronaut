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
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname
    return url.href === 'about:blank' ? url.href : url.protocol
  } catch {
    return ''
  }
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Whether a tab's title shows its address rather than a title the page set: the address or its start, with or
 * without the scheme, as Chromium shows a page with no title, or any title that repeats the address's query or
 * fragment. Such a title would carry the detail `urlWithoutDetail` leaves out.
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
  // the same way stays.
  const hostEnd = url.host ? withoutScheme.indexOf(url.host) + url.host.length : 0
  if (url.href.startsWith(shown) && shown.length >= url.href.length - withoutScheme.length + hostEnd) return true
  if (withoutScheme.startsWith(shown) && shown.length >= hostEnd) return true
  // A query or fragment of a few characters, such as `#top`, is too common to tell an echo from page text.
  return [url.search.slice(1), url.hash.slice(1)].some(part => part.length >= 4 && (shown.includes(part) || shown.includes(decoded(part))))
}
