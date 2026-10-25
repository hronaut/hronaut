import { ref, type Ref } from 'vue'
import type { SiteSearchDraft } from '../../../shared/site-search.js'
import type { AppSettings, SearchEngineName } from '../../../shared/types.js'

export interface SearchSettingsControllerOptions {
  settings: Readonly<Ref<AppSettings>>
  setSearchEngine: (searchEngine: SearchEngineName) => Promise<AppSettings>
  addSiteSearch: (draft: SiteSearchDraft) => Promise<AppSettings>
  updateSiteSearch: (id: string, draft: SiteSearchDraft) => Promise<AppSettings>
  removeSiteSearch: (id: string) => Promise<AppSettings>
  onError: (error: unknown) => void
}

export function useSearchSettingsController(options: SearchSettingsControllerOptions) {
  const busy = ref(false)
  // The Site search list saves one change at a time, apart from the default engine.
  const siteSearchBusy = ref(false)
  let generation = 0

  async function select(searchEngine: SearchEngineName): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    busy.value = true
    try {
      await options.setSearchEngine(searchEngine)
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onError(error)
      return false
    } finally {
      if (operationGeneration === generation) busy.value = false
    }
  }

  async function changeSiteSearches(change: () => Promise<AppSettings>): Promise<boolean> {
    if (siteSearchBusy.value) return false
    const operationGeneration = generation
    siteSearchBusy.value = true
    try {
      await change()
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onError(error)
      return false
    } finally {
      if (operationGeneration === generation) siteSearchBusy.value = false
    }
  }

  /** Adds a site search, or changes the one with the id; true once it is saved. */
  function saveSiteSearch(id: string | null, draft: SiteSearchDraft): Promise<boolean> {
    return changeSiteSearches(() => id === null ? options.addSiteSearch(draft) : options.updateSiteSearch(id, draft))
  }

  function removeSiteSearch(id: string): Promise<boolean> {
    return changeSiteSearches(() => options.removeSiteSearch(id))
  }

  // Reset puts the default engine back. The site searches are the person's own, and stay.
  function reset(): Promise<boolean> {
    return select('google')
  }

  function dispose(): void {
    generation += 1
    busy.value = false
    siteSearchBusy.value = false
  }

  return {
    settings: options.settings,
    busy,
    select,
    siteSearchBusy,
    saveSiteSearch,
    removeSiteSearch,
    reset,
    dispose
  }
}

export type SearchSettingsController = ReturnType<typeof useSearchSettingsController>
