import { computed, ref, watch, type Ref } from 'vue'
import type {
  BrowserEmulationState,
  BrowserEnvironmentSettings,
  BrowserState,
  BrowserTabState
} from '../../../shared/types.js'
import {
  browserEnvironmentFromEmulation,
  browserEnvironmentOverrideCount,
  isBrowserEnvironmentSettings
} from '../../../shared/browser-environment.js'

export type EnvironmentPanelState = 'idle' | 'applying' | 'applied' | 'error'
export type EnvironmentPanelAction = 'apply' | 'apply-reload' | 'reset'

export interface EnvironmentPanelControllerOptions {
  open: Ref<boolean>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  setTabEnvironment: (tabId: string, environment: BrowserEnvironmentSettings) => Promise<BrowserState>
  reloadIgnoringCache: (tabId: string) => Promise<BrowserState>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  beginMutation: () => number
  isMutationCurrent: (sequence: number, tabId: string) => boolean
  closeTransientPanels: () => void
}

export function useEnvironmentPanelController(options: EnvironmentPanelControllerOptions) {
  const draft = ref<BrowserEnvironmentSettings>(browserEnvironmentFromEmulation())
  const locationEnabled = ref(false)
  const latitude = ref(50.4501)
  const longitude = ref(30.5234)
  const accuracy = ref(100)
  const state = ref<EnvironmentPanelState>('idle')
  const error = ref('')
  const pendingAction = ref<EnvironmentPanelAction | null>(null)
  let presentationGeneration = 0
  let operationGeneration = 0

  const settings = computed<BrowserEnvironmentSettings | null>(() => {
    const candidate: BrowserEnvironmentSettings = {
      ...draft.value,
      renderingDebug: { ...draft.value.renderingDebug },
      geolocation: locationEnabled.value
        ? { latitude: latitude.value, longitude: longitude.value, accuracy: accuracy.value }
        : null
    }
    return isBrowserEnvironmentSettings(candidate) ? candidate : null
  })

  const activeOverrideCount = computed(() => browserEnvironmentOverrideCount(
    browserEnvironmentFromEmulation(options.activeTab.value?.emulation)
  ))

  function resetFeedback(): void {
    presentationGeneration += 1
    state.value = 'idle'
    error.value = ''
  }

  function markDraftChanged(): void {
    resetFeedback()
  }

  function loadDraft(emulation: BrowserEmulationState | undefined = options.activeTab.value?.emulation): void {
    const environment = browserEnvironmentFromEmulation(emulation)
    draft.value = environment
    locationEnabled.value = environment.geolocation !== null
    if (environment.geolocation) {
      latitude.value = environment.geolocation.latitude
      longitude.value = environment.geolocation.longitude
      accuracy.value = environment.geolocation.accuracy
    }
    resetFeedback()
  }

  function toggle(): void {
    if (options.open.value) {
      options.open.value = false
      return
    }
    options.closeTransientPanels()
    loadDraft()
    options.open.value = true
  }

  function finishSupersededOperation(operation: number): void {
    if (operation !== operationGeneration) return
    pendingAction.value = null
    state.value = 'idle'
  }

  async function apply(reload = false, override?: BrowserEnvironmentSettings): Promise<void> {
    if (pendingAction.value) return
    const tab = options.activeTab.value
    const environment = override ?? settings.value
    if (!tab || !environment) return
    const mutation = options.beginMutation()
    const operation = ++operationGeneration
    const presentation = presentationGeneration
    pendingAction.value = override ? 'reset' : reload ? 'apply-reload' : 'apply'
    state.value = 'applying'
    error.value = ''
    try {
      await options.syncState(options.setTabEnvironment(tab.id, environment))
      if (!options.isMutationCurrent(mutation, tab.id)) {
        finishSupersededOperation(operation)
        return
      }
      if (reload) {
        await options.syncState(options.reloadIgnoringCache(tab.id))
        if (!options.isMutationCurrent(mutation, tab.id)) {
          finishSupersededOperation(operation)
          return
        }
      }
      if (operation !== operationGeneration) return
      pendingAction.value = null
      if (presentation !== presentationGeneration) {
        state.value = 'idle'
        return
      }
      loadDraft(options.activeTab.value?.emulation)
      state.value = 'applied'
    } catch (cause) {
      if (!options.isMutationCurrent(mutation, tab.id)) {
        finishSupersededOperation(operation)
        return
      }
      if (operation !== operationGeneration) return
      pendingAction.value = null
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function reset(): Promise<void> {
    if (pendingAction.value) return
    const empty = browserEnvironmentFromEmulation()
    await apply(false, empty)
  }

  function handleEscape(): void {
    options.open.value = false
  }

  const stopOpenTracking = watch(options.open, (isOpen) => {
    if (isOpen) loadDraft()
    else resetFeedback()
  })

  function dispose(): void {
    stopOpenTracking()
  }

  loadDraft()

  return {
    draft,
    locationEnabled,
    latitude,
    longitude,
    accuracy,
    state,
    error,
    pendingAction,
    settings,
    activeOverrideCount,
    resetFeedback,
    markDraftChanged,
    loadDraft,
    toggle,
    apply,
    reset,
    handleEscape,
    dispose
  }
}
