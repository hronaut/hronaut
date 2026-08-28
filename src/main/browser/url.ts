import { DEFAULT_SEARCH_ENGINE, searchUrl, type SearchEngineName } from '../../shared/search-engine.js'

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const HOST_LIKE_PATTERN = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]|[^\s/]+\.[^\s/]+)(?::\d+)?(?:\/.*)?$/

function isLoopbackAddress(value: string): boolean {
  try {
    const hostname = new URL(`http://${value}`).hostname.toLocaleLowerCase().replace(/\.$/, '')
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '[::1]'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  } catch {
    return false
  }
}

function hasSchemeLessUserInfo(value: string): boolean {
  const authorityEnd = value.search(/[/?#]/)
  const authority = authorityEnd < 0 ? value : value.slice(0, authorityEnd)
  return authority.includes('@')
}

export function normalizeAddress(input: string, searchEngine: SearchEngineName = DEFAULT_SEARCH_ENGINE): string {
  const value = input.trim()
  if (!value) return 'about:blank'
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value) || /^(about|data|file|view-source):/i.test(value)) return value
  if (!hasSchemeLessUserInfo(value) && HOST_LIKE_PATTERN.test(value)) {
    return `${isLoopbackAddress(value) ? 'http' : 'https'}://${value}`
  }
  if (SCHEME_PATTERN.test(value)) return value
  return searchUrl(value, searchEngine)
}
