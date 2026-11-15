import type { AddressSuggestion } from '../../shared/address-suggestions.js'

export interface AddressInlineCompletion {
  /** The field's text: what was typed, then the rest of the address, which the field selects. */
  text: string
  /** Where Enter goes with that text: the site or page it completes, with its own scheme and port. */
  url: string
  /** The suggestion it comes from. */
  suggestionId: string
}

/** How many visits the history holds for each site, by its origin, such as https://github.com. */
export type SiteVisits = ReadonlyMap<string, number>

function webUrl(address: string): URL | undefined {
  try {
    const parsed = new URL(address)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password ? parsed : undefined
  } catch {
    return undefined
  }
}

export function siteVisits(history: readonly { url: string; visitCount: number }[]): SiteVisits {
  const visits = new Map<string, number>()
  for (const entry of history) {
    const parsed = webUrl(entry.url)
    if (parsed) visits.set(parsed.origin, (visits.get(parsed.origin) ?? 0) + Math.max(1, entry.visitCount))
  }
  return visits
}

function withoutWww(text: string): string {
  return text.startsWith('www.') ? text.slice('www.'.length) : text
}

// Whether a way of writing a site or page starts with the typed text: its host in either case, as hosts are, and its
// path letter for letter, so the field never shows one page and opens another.
function startsWithTyped(form: string, typed: string, schemeLength: number): boolean {
  if (form.length < typed.length) return false
  const slash = form.indexOf('/', schemeLength)
  const hostEnd = Math.min(slash < 0 ? form.length : slash, typed.length)
  return form.slice(0, hostEnd).toLowerCase() === typed.slice(0, hostEnd).toLowerCase()
    && form.slice(hostEnd, typed.length) === typed.slice(hostEnd)
}

/**
 * What Chrome's address bar fills in after the text typed at its end: the rest of a site's host, or, once the text
 * reaches a path, the rest of a page's address, from the suggestions in their order. An address typed whole opens as
 * typed, with its own scheme and port. Chrome fills in only addresses the person typed before; the history here does
 * not say which visits were typed, so a site needs two visits or a bookmark, and a page two visits of that very page,
 * without a query or fragment, or a bookmark. Text with a space, an @ source or a ? search is a search, and is left as
 * typed, and so is a scheme still being typed.
 */
export function inlineAddressCompletion(
  typed: string,
  suggestions: readonly AddressSuggestion[],
  visits: SiteVisits
): AddressInlineCompletion | undefined {
  if (!typed || /\s/u.test(typed) || typed.startsWith('@') || typed.startsWith('?')) return undefined
  const scheme = /^https?:\/\//iu.exec(typed)?.[0].toLowerCase() ?? ''
  const afterScheme = typed.slice(scheme.length)
  if (!afterScheme) return undefined
  const reachesPath = afterScheme.includes('/')
  let first: AddressInlineCompletion | undefined
  for (const suggestion of suggestions) {
    const parsed = suggestion.kind === 'tab' ? undefined : webUrl(suggestion.url)
    if (!parsed || (scheme && `${parsed.protocol}//` !== scheme)) continue
    const rest = reachesPath ? parsed.href.slice(parsed.protocol.length + 2) : parsed.host
    const form = [withoutWww(rest), rest].map((candidate) => scheme + candidate).find((candidate) => startsWithTyped(candidate, typed, scheme.length))
    if (form === undefined) continue
    const completion = { text: typed + form.slice(typed.length), url: reachesPath ? parsed.href : `${parsed.origin}/`, suggestionId: suggestion.id }
    if (form.length === typed.length) return completion
    const known = suggestion.kind === 'bookmark' || (reachesPath
      ? (suggestion.visitCount ?? 0) >= 2 && !parsed.search && !parsed.hash
      : (visits.get(parsed.origin) ?? 0) >= 2)
    if (known) first ??= completion
  }
  return first
}
