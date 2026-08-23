import { DEFAULT_SEARCH_ENGINE, searchUrl, type SearchEngineName } from '../../shared/search-engine.js'

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const HOST_LIKE_PATTERN = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]|[^\s/]+\.[^\s/]+)(?::\d+)?(?:\/.*)?$/

export function normalizeAddress(input: string, searchEngine: SearchEngineName = DEFAULT_SEARCH_ENGINE): string {
  const value = input.trim()
  if (!value) return 'about:blank'
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value) || /^(about|data|file|view-source):/i.test(value)) return value
  if (HOST_LIKE_PATTERN.test(value)) return `https://${value}`
  if (SCHEME_PATTERN.test(value)) return value
  return searchUrl(value, searchEngine)
}
