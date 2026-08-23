export const SEARCH_ENGINE_OPTIONS = [
  {
    id: 'google',
    label: 'Google',
    hostname: 'google.com',
    description: 'Broad web results and familiar ranking',
    template: 'https://www.google.com/search?q=%s'
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    hostname: 'duckduckgo.com',
    description: 'Search without personalized tracking',
    template: 'https://duckduckgo.com/?q=%s'
  },
  {
    id: 'bing',
    label: 'Bing',
    hostname: 'bing.com',
    description: 'Microsoft web and image search',
    template: 'https://www.bing.com/search?q=%s'
  },
  {
    id: 'brave',
    label: 'Brave Search',
    hostname: 'search.brave.com',
    description: 'Independent privacy-focused search',
    template: 'https://search.brave.com/search?q=%s'
  },
  {
    id: 'startpage',
    label: 'Startpage',
    hostname: 'startpage.com',
    description: 'Private results without profiling',
    template: 'https://www.startpage.com/sp/search?query=%s'
  }
] as const

export type SearchEngineName = (typeof SEARCH_ENGINE_OPTIONS)[number]['id']

export const DEFAULT_SEARCH_ENGINE: SearchEngineName = 'google'

export function isSearchEngineName(value: unknown): value is SearchEngineName {
  return SEARCH_ENGINE_OPTIONS.some((engine) => engine.id === value)
}

export function searchUrl(query: string, engineName: SearchEngineName = DEFAULT_SEARCH_ENGINE): string {
  const engine = SEARCH_ENGINE_OPTIONS.find((candidate) => candidate.id === engineName)
    ?? SEARCH_ENGINE_OPTIONS[0]
  return engine.template.replace('%s', encodeURIComponent(query))
}
