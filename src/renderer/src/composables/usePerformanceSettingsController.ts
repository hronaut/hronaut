import { computed, ref, type Ref } from 'vue'
import type {
  AppSettings,
  BrowserState,
  MemorySaverTimeoutMinutes
} from '../../../shared/types.js'

export interface PerformanceSettingsControllerOptions {
  settings: Readonly<Ref<AppSettings>>
  browserState: Readonly<Ref<BrowserState>>
  setEnabled: (enabled: boolean) => Promise<AppSettings>
  setTimeout: (minutes: MemorySaverTimeoutMinutes) => Promise<AppSettings>
  resetSettings: () => Promise<AppSettings>
  sleepInactiveTabs: () => Promise<BrowserState>
  syncBrowserState: (operation: Promise<BrowserState>) => Promise<BrowserState>
  formatError: (error: unknown, operation: Exclude<OperationState, 'idle'>) => string
  onError: (error: unknown, operation: Exclude<OperationState, 'idle'>) => void
}

type OperationState = 'idle' | 'saving' | 'sleeping'

export function usePerformanceSettingsController(options: PerformanceSettingsControllerOptions) {
  const state = ref<OperationState>('idle')
  const errorMessage = ref('')
  let generation = 0

  const regularTabs = computed(() => options.browserState.value.tabs.filter((tab) => !tab.url.startsWith('hronaut://home')))
  const sleepingTabsCount = computed(() => regularTabs.value.filter((tab) => tab.sleeping).length)
  const busy = computed(() => state.value !== 'idle')

  function fail(error: unknown, operation: Exclude<OperationState, 'idle'>): false {
    errorMessage.value = options.formatError(error, operation)
    options.onError(error, operation)
    return false
  }

  async function save(operation: () => Promise<unknown>): Promise<boolean> {
    if (busy.value) return false
    const operationGeneration = generation
    state.value = 'saving'
    errorMessage.value = ''
    try {
      await operation()
      return operationGeneration === generation
    } catch (error) {
      return operationGeneration === generation ? fail(error, 'saving') : false
    } finally {
      if (operationGeneration === generation) state.value = 'idle'
    }
  }

  function setEnabled(enabled: boolean): Promise<boolean> {
    return save(() => options.setEnabled(enabled))
  }

  function setTimeout(minutes: MemorySaverTimeoutMinutes): Promise<boolean> {
    return save(() => options.setTimeout(minutes))
  }

  function reset(): Promise<boolean> {
    return save(options.resetSettings)
  }

  async function sleepNow(): Promise<boolean> {
    if (busy.value || !options.settings.value.memorySaverEnabled) return false
    const operationGeneration = generation
    state.value = 'sleeping'
    errorMessage.value = ''
    try {
      await options.syncBrowserState(options.sleepInactiveTabs())
      return operationGeneration === generation
    } catch (error) {
      return operationGeneration === generation ? fail(error, 'sleeping') : false
    } finally {
      if (operationGeneration === generation) state.value = 'idle'
    }
  }

  function dispose(): void {
    generation += 1
    state.value = 'idle'
  }

  return {
    settings: options.settings,
    state,
    busy,
    errorMessage,
    regularTabsCount: computed(() => regularTabs.value.length),
    sleepingTabsCount,
    setEnabled,
    setTimeout,
    reset,
    sleepNow,
    dispose
  }
}

export type PerformanceSettingsController = ReturnType<typeof usePerformanceSettingsController>
