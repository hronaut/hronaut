// A referrer longer than this is sent as its origin, as the Referrer Policy specification and Chromium do.
const MAX_REFERRER_LENGTH = 4096

function webUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * The Referer a link or image saved from the page menu sends: what the page's
 * own request for it would send under the frame's referrer policy, as Chrome's
 * Save Link As and Save Image As do. Without it, a site that only serves its
 * images to its own pages refuses the save. By default (strict origin when
 * cross-origin) that is the page's address without its fragment or sign-in
 * for the same site, only its origin for another site, and nothing from an
 * HTTPS page to a plain HTTP one. Undefined when nothing is sent.
 */
export function savedResourceReferrer(frameUrl: string, target: string, policy: string): string | undefined {
  const source = webUrl(frameUrl)
  const destination = webUrl(target)
  if (!source || !destination) return undefined
  source.hash = ''
  source.username = ''
  source.password = ''
  const origin = `${source.origin}/`
  const full = source.href.length > MAX_REFERRER_LENGTH ? origin : source.href
  const sameOrigin = source.origin === destination.origin
  // As in Chromium, only HTTPS counts as secure here, so a page on this computer over HTTP is no exception.
  const downgrade = source.protocol === 'https:' && destination.protocol !== 'https:'
  switch (policy) {
    case 'no-referrer':
      return undefined
    case 'unsafe-url':
      return full
    case 'origin':
      return origin
    case 'same-origin':
      return sameOrigin ? full : undefined
    case 'origin-when-cross-origin':
      return sameOrigin ? full : origin
    case 'strict-origin':
      return downgrade ? undefined : origin
    case 'no-referrer-when-downgrade':
      return downgrade ? undefined : full
    default:
      // strict-origin-when-cross-origin, Chromium's default, and any policy Electron reports that this list lacks.
      return sameOrigin ? full : downgrade ? undefined : origin
  }
}
