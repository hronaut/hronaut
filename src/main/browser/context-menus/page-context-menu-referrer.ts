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
 * The Referer a link or image saved from the page menu sends, so a site that serves its images and files only to its
 * own pages lets them be saved, as Chrome's Save Link As and Save Image As do. The frame's referrer policy applies, with
 * two limits, because Electron's downloadURL cannot carry a policy and applies no-referrer-when-downgrade to the request
 * and to every redirect after it:
 * - Nothing goes from an HTTPS page to an address that is not HTTPS, whatever the policy: Chromium cancels such a
 *   request rather than strip its referrer.
 * - Only the page's origin goes out, unless the policy sends the full address to every site (unsafe-url and
 *   no-referrer-when-downgrade). A same-origin link that redirects to another site therefore never hands it the
 *   page's path, which the page's own request would not either.
 * Undefined when nothing is sent.
 */
export function savedResourceReferrer(frameUrl: string, target: string, policy: string): string | undefined {
  const source = webUrl(frameUrl)
  const destination = webUrl(target)
  if (!source || !destination) return undefined
  // As in Chromium, only HTTPS counts as secure here, so a page on this computer over HTTP is no exception.
  if (source.protocol === 'https:' && destination.protocol !== 'https:') return undefined
  source.hash = ''
  source.username = ''
  source.password = ''
  const origin = `${source.origin}/`
  switch (policy) {
    case 'no-referrer':
      return undefined
    case 'unsafe-url':
    case 'no-referrer-when-downgrade':
      return source.href.length > MAX_REFERRER_LENGTH ? origin : source.href
    case 'same-origin':
      return source.origin === destination.origin ? origin : undefined
    default:
      // origin, strict-origin, strict-origin-when-cross-origin (Chromium's default), and any policy Electron reports
      // that this list lacks. Electron reports origin-when-cross-origin as no-referrer, so such a page sends nothing.
      return origin
  }
}
