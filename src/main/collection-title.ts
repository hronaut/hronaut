import { truncateText } from '../shared/text-boundaries.js'

interface CollectionTitlePolicy {
  maxLength: number
  normalizeUrl: (value: string) => string | null
  urlFallbacks: 'all' | 'credentials'
}

function hasEmbeddedHttpCredentials(value: string): boolean {
  try {
    const candidate = new URL(value)
    return (candidate.protocol === 'http:' || candidate.protocol === 'https:') && Boolean(candidate.username || candidate.password)
  } catch {
    return false
  }
}

/** The owning store supplies its URL policy, including fragment handling. */
export function normalizeCollectionTitle(
  value: string,
  url: string,
  sourceUrl: string,
  policy: CollectionTitlePolicy
): string {
  const matchesSource = value === sourceUrl
    || (value.length === policy.maxLength && sourceUrl.startsWith(value))
  // Legacy titles may have been capped before the credential separator, even
  // when the stored address was sanitized by a subsequent write.
  const truncatedUrlAuthority = value.length === policy.maxLength
    && /^https?:\/\/[^/?#\s@]+$/iu.test(value)
  const isUrlFallback = policy.urlFallbacks === 'all'
    ? matchesSource || policy.normalizeUrl(value) === url
    : matchesSource && hasEmbeddedHttpCredentials(sourceUrl)
  let safeValue = value
  if (isUrlFallback || truncatedUrlAuthority) safeValue = policy.normalizeUrl(sourceUrl) ?? value
  else if (hasEmbeddedHttpCredentials(value)) safeValue = policy.normalizeUrl(value) ?? url
  const title = truncateText(safeValue.replace(/\s+/g, ' ').trim(), policy.maxLength)
  return title || new URL(url).hostname
}
