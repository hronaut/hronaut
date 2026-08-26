import { networkRoutePatternMatches } from './network-routes.js'

export function normalizePageUrlWaitPattern(input: string): string {
  const pattern = input.trim()
  if (!pattern || pattern.length > 2_048) {
    throw new TypeError('Page URL pattern must contain between 1 and 2,048 characters')
  }
  if (/[\u0000-\u001f\u007f]/.test(pattern)) {
    throw new TypeError('Page URL pattern cannot contain control characters')
  }
  return pattern
}

export function pageUrlMatchesWait(pattern: string, url: string): boolean {
  return networkRoutePatternMatches(pattern, url)
}
