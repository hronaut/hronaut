import { ref, type Ref } from 'vue'
import type { AppSettings, SearchEngineName } from '../../../shared/types.js'

export interface SearchSettingsControllerOptions {
  settings: Readonly<Ref<AppSettings>>
  setSearchEngine: (searchEngine: SearchEngineName) => Promise<AppSettings>
  onError: (error: unknown) => void
}

export function useSearchSettingsController(options: SearchSettingsControllerOptions) {
  const busy = ref(false)
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

  function reset(): Promise<boolean> {
    return select('google')
  }

  function dispose(): void {
    generation += 1
    busy.value = false
  }

  return {
    settings: options.settings,
    busy,
    select,
    reset,
    dispose
  }
}

export type SearchSettingsController = ReturnType<typeof useSearchSettingsController>
