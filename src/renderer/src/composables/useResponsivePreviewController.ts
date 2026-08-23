import { computed, ref, watch, type Ref } from 'vue'
import type {
  BrowserState,
  BrowserTabState,
  BrowserViewportEmulation,
  BrowserViewportOrientation,
  BrowserViewportPresetId
} from '../../../shared/types.js'
import {
  matchingViewportPreset,
  resolveViewportPreset
} from '../../../shared/viewport-presets.js'

export type ResponsivePreviewState = 'idle' | 'applying' | 'applied' | 'error'
export type ResponsivePreviewAction = 'apply' | 'reset'

export interface ResponsivePreviewControllerOptions {
  open: Ref<boolean>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  setTabViewport: (tabId: string, viewport: BrowserViewportEmulation | null) => Promise<BrowserState>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  beginMutation: () => number
  isMutationCurrent: (sequence: number, tabId: string) => boolean
  closeTransientPanels: () => void
}

export function useResponsivePreviewController(options: ResponsivePreviewControllerOptions) {
  const presetId = ref<BrowserViewportPresetId | 'custom'>('phone')
  const orientation = ref<BrowserViewportOrientation>('portrait')
  const width = ref(390)
  const height = ref(844)
  const deviceScaleFactor = ref(3)
  const mobile = ref(true)
  const touch = ref(true)
  const state = ref<ResponsivePreviewState>('idle')
  const error = ref('')
  const pendingAction = ref<ResponsivePreviewAction | null>(null)
  let presentationGeneration = 0
  let operationGeneration = 0

  const viewport = computed<BrowserViewportEmulation | null>(() => {
    if (presetId.value !== 'custom') return resolveViewportPreset(presetId.value, orientation.value)
    if (!Number.isInteger(width.value)
      || width.value < 200
      || width.value > 3840
      || !Number.isInteger(height.value)
      || height.value < 200
      || height.value > 3840
      || !Number.isFinite(deviceScaleFactor.value)
      || deviceScaleFactor.value < 0.5
      || deviceScaleFactor.value > 5) return null
    return {
      width: width.value,
      height: height.value,
      deviceScaleFactor: deviceScaleFactor.value,
      mobile: mobile.value,
      touch: touch.value,
      orientation: orientation.value
    }
  })

  function resetFeedback(): void {
    presentationGeneration += 1
    state.value = 'idle'
    error.value = ''
  }

  function markDraftChanged(): void {
    resetFeedback()
  }

  function loadDraft(nextViewport: BrowserViewportEmulation | null | undefined = options.activeTab.value?.emulation?.viewport): void {
    resetFeedback()
    if (!nextViewport) {
      presetId.value = 'phone'
      orientation.value = 'portrait'
      const fallback = resolveViewportPreset('phone')
      width.value = fallback.width
      height.value = fallback.height
      deviceScaleFactor.value = fallback.deviceScaleFactor
      mobile.value = fallback.mobile
      touch.value = fallback.touch
      return
    }
    const preset = matchingViewportPreset(nextViewport)
    presetId.value = preset?.id ?? 'custom'
    orientation.value = nextViewport.orientation
    width.value = nextViewport.width
    height.value = nextViewport.height
    deviceScaleFactor.value = nextViewport.deviceScaleFactor
    mobile.value = nextViewport.mobile
    touch.value = nextViewport.touch
  }

  function selectPreset(nextPresetId: BrowserViewportPresetId | 'custom'): void {
    presetId.value = nextPresetId
    markDraftChanged()
    if (nextPresetId === 'custom') return
    const nextViewport = resolveViewportPreset(nextPresetId, orientation.value)
    width.value = nextViewport.width
    height.value = nextViewport.height
    deviceScaleFactor.value = nextViewport.deviceScaleFactor
    mobile.value = nextViewport.mobile
    touch.value = nextViewport.touch
  }

  function setOrientation(nextOrientation: BrowserViewportOrientation): void {
    if (orientation.value === nextOrientation) return
    if (presetId.value === 'custom') {
      const previousWidth = width.value
      width.value = height.value
      height.value = previousWidth
    } else {
      const nextViewport = resolveViewportPreset(presetId.value, nextOrientation)
      width.value = nextViewport.width
      height.value = nextViewport.height
    }
    orientation.value = nextOrientation
    markDraftChanged()
  }

  function toggleOrientation(): void {
    setOrientation(orientation.value === 'portrait' ? 'landscape' : 'portrait')
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

  async function apply(): Promise<void> {
    if (pendingAction.value) return
    const tab = options.activeTab.value
    const nextViewport = viewport.value
    if (!tab || !nextViewport) return
    const mutation = options.beginMutation()
    const operation = ++operationGeneration
    const presentation = presentationGeneration
    pendingAction.value = 'apply'
    state.value = 'applying'
    error.value = ''
    try {
      await options.syncState(options.setTabViewport(tab.id, nextViewport))
      if (!options.isMutationCurrent(mutation, tab.id)) {
        finishSupersededOperation(operation)
        return
      }
      if (operation !== operationGeneration) return
      pendingAction.value = null
      state.value = presentation === presentationGeneration ? 'applied' : 'idle'
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
    const tab = options.activeTab.value
    if (!tab) return
    const mutation = options.beginMutation()
    const operation = ++operationGeneration
    const presentation = presentationGeneration
    pendingAction.value = 'reset'
    state.value = 'applying'
    error.value = ''
    try {
      await options.syncState(options.setTabViewport(tab.id, null))
      if (!options.isMutationCurrent(mutation, tab.id)) {
        finishSupersededOperation(operation)
        return
      }
      if (operation !== operationGeneration) return
      pendingAction.value = null
      if (presentation === presentationGeneration) loadDraft(null)
      else state.value = 'idle'
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
    presetId,
    orientation,
    width,
    height,
    deviceScaleFactor,
    mobile,
    touch,
    state,
    error,
    pendingAction,
    viewport,
    resetFeedback,
    markDraftChanged,
    loadDraft,
    selectPreset,
    setOrientation,
    toggleOrientation,
    toggle,
    apply,
    reset,
    handleEscape,
    dispose
  }
}
