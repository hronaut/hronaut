import { ref, watch, type Ref } from 'vue'
import type { HronautApi, BrowserTabState } from '../../../shared/types.js'

type PageCaptureBrowserApi = Pick<
  HronautApi,
  'pickElement' | 'captureElement' | 'cancelElementPicker' | 'captureArea' | 'cancelAreaCapture' | 'capturePage'
>

export type ElementPickerMode = 'context' | 'screenshot'
export type ElementPickerState = 'idle' | 'picking' | 'copied' | 'error'
export type ScreenshotCaptureMode = 'area' | 'viewport' | 'full-page'
export type ScreenshotCaptureState = 'idle' | 'picking' | 'capturing' | 'copied' | 'error'

export interface PageCaptureControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: PageCaptureBrowserApi
  onElementCopied: (mode: ElementPickerMode) => void
  onElementFailed: (mode: ElementPickerMode, error: unknown) => void
  onCaptureCopied: (mode: ScreenshotCaptureMode) => void
  onCaptureFailed: (mode: ScreenshotCaptureMode, error: unknown) => string
}

interface PageRequest {
  generation: number
  tabId: string
}

export function usePageCaptureController(options: PageCaptureControllerOptions) {
  const elementState = ref<ElementPickerState>('idle')
  const elementMode = ref<ElementPickerMode>('context')
  const captureState = ref<ScreenshotCaptureState>('idle')
  const captureMode = ref<ScreenshotCaptureMode>('area')
  const captureError = ref('')
  let elementGeneration = 0
  let captureGeneration = 0
  let elementTabId: string | undefined
  let captureTabId: string | undefined
  let elementResetTimer: number | undefined
  let captureResetTimer: number | undefined

  function activeWebsite(): BrowserTabState | null {
    const tab = options.activeTab.value
    return tab && !tab.url.startsWith('hronaut://home') ? tab : null
  }

  function clearElementReset(): void {
    if (elementResetTimer !== undefined) window.clearTimeout(elementResetTimer)
    elementResetTimer = undefined
  }

  function clearCaptureReset(): void {
    if (captureResetTimer !== undefined) window.clearTimeout(captureResetTimer)
    captureResetTimer = undefined
  }

  function beginElement(): PageRequest | null {
    const tab = activeWebsite()
    if (!tab) return null
    clearElementReset()
    return { generation: ++elementGeneration, tabId: tab.id }
  }

  function beginCapture(): PageRequest | null {
    const tab = activeWebsite()
    if (!tab) return null
    clearCaptureReset()
    return { generation: ++captureGeneration, tabId: tab.id }
  }

  function elementRequestIsCurrent(request: PageRequest): boolean {
    const tab = options.activeTab.value
    return request.generation === elementGeneration
      && tab?.id === request.tabId
  }

  function captureRequestIsCurrent(request: PageRequest): boolean {
    const tab = options.activeTab.value
    return request.generation === captureGeneration
      && tab?.id === request.tabId
  }

  function resetElementState(): void {
    elementState.value = 'idle'
    elementMode.value = 'context'
  }

  function resetCaptureState(): void {
    captureState.value = 'idle'
    captureMode.value = 'area'
    captureError.value = ''
  }

  function resetElementSoon(request: PageRequest): void {
    clearElementReset()
    elementResetTimer = window.setTimeout(() => {
      if (!elementRequestIsCurrent(request)) return
      resetElementState()
      elementResetTimer = undefined
    }, 1_500)
  }

  function resetCaptureSoon(request: PageRequest): void {
    clearCaptureReset()
    captureResetTimer = window.setTimeout(() => {
      if (!captureRequestIsCurrent(request)) return
      resetCaptureState()
      captureResetTimer = undefined
    }, 2_400)
  }

  async function cancelElementPicker(): Promise<void> {
    const tabId = elementTabId
    elementGeneration += 1
    elementTabId = undefined
    clearElementReset()
    resetElementState()
    if (tabId) await options.browser.cancelElementPicker(tabId).catch(() => false)
  }

  async function cancelAreaCapture(): Promise<void> {
    const tabId = captureTabId
    captureGeneration += 1
    captureTabId = undefined
    clearCaptureReset()
    resetCaptureState()
    if (tabId) await options.browser.cancelAreaCapture(tabId).catch(() => false)
  }

  async function toggleElementPicker(mode: ElementPickerMode = 'context'): Promise<void> {
    if (captureState.value === 'capturing') return
    if (elementState.value === 'picking') {
      const restartInAnotherMode = elementMode.value !== mode
      await cancelElementPicker()
      if (!restartInAnotherMode) return
    }
    if (captureState.value === 'picking') await cancelAreaCapture()
    const request = beginElement()
    if (!request) return
    elementTabId = request.tabId
    elementMode.value = mode
    elementState.value = 'picking'
    try {
      const result = mode === 'screenshot'
        ? await options.browser.captureElement(request.tabId)
        : await options.browser.pickElement(request.tabId)
      if (!elementRequestIsCurrent(request)) return
      elementTabId = undefined
      if (!result.copied) {
        resetElementState()
        return
      }
      elementState.value = 'copied'
      options.onElementCopied(mode)
      resetElementSoon(request)
    } catch (error) {
      if (!elementRequestIsCurrent(request)) return
      elementTabId = undefined
      elementState.value = 'error'
      options.onElementFailed(mode, error)
      resetElementSoon(request)
    }
  }

  async function toggleAreaCapture(): Promise<void> {
    if (captureState.value === 'picking') {
      await cancelAreaCapture()
      return
    }
    if (captureState.value === 'capturing') return
    if (elementState.value === 'picking') await cancelElementPicker()
    const request = beginCapture()
    if (!request) return
    captureTabId = request.tabId
    captureMode.value = 'area'
    captureError.value = ''
    captureState.value = 'picking'
    try {
      const result = await options.browser.captureArea(request.tabId)
      if (!captureRequestIsCurrent(request)) return
      captureTabId = undefined
      if (!result.copied) {
        resetCaptureState()
        return
      }
      captureState.value = 'copied'
      options.onCaptureCopied('area')
      resetCaptureSoon(request)
    } catch (error) {
      if (!captureRequestIsCurrent(request)) return
      captureTabId = undefined
      captureState.value = 'error'
      captureError.value = options.onCaptureFailed('area', error)
      resetCaptureSoon(request)
    }
  }

  async function capturePage(mode: Exclude<ScreenshotCaptureMode, 'area'>): Promise<void> {
    if (elementState.value === 'picking') await cancelElementPicker()
    if (captureState.value === 'picking') await cancelAreaCapture()
    if (captureState.value === 'capturing') return
    const request = beginCapture()
    if (!request) return
    captureTabId = request.tabId
    captureMode.value = mode
    captureError.value = ''
    captureState.value = 'capturing'
    try {
      const result = await options.browser.capturePage({ tabId: request.tabId, fullPage: mode === 'full-page' })
      if (!captureRequestIsCurrent(request)) return
      captureTabId = undefined
      captureState.value = result.copied ? 'copied' : 'idle'
      if (result.copied) {
        options.onCaptureCopied(mode)
        resetCaptureSoon(request)
      }
    } catch (error) {
      if (!captureRequestIsCurrent(request)) return
      captureTabId = undefined
      captureState.value = 'error'
      captureError.value = options.onCaptureFailed(mode, error)
      resetCaptureSoon(request)
    }
  }

  function invalidateContext(): void {
    const elementToCancel = elementState.value === 'picking' ? elementTabId : undefined
    const areaToCancel = captureState.value === 'picking' ? captureTabId : undefined
    elementGeneration += 1
    captureGeneration += 1
    elementTabId = undefined
    captureTabId = undefined
    clearElementReset()
    clearCaptureReset()
    resetElementState()
    resetCaptureState()
    if (elementToCancel) void options.browser.cancelElementPicker(elementToCancel).catch(() => false)
    if (areaToCancel) void options.browser.cancelAreaCapture(areaToCancel).catch(() => false)
  }

  const stopContextWatcher = watch(
    () => options.activeTab.value?.id,
    (tabId, previousTabId) => {
      if (tabId === previousTabId) return
      invalidateContext()
    },
    { immediate: true }
  )

  function dispose(): void {
    stopContextWatcher()
    invalidateContext()
  }

  return {
    elementState,
    elementMode,
    captureState,
    captureMode,
    captureError,
    toggleElementPicker,
    cancelElementPicker,
    toggleAreaCapture,
    capturePage,
    dispose
  }
}

export type PageCaptureController = ReturnType<typeof usePageCaptureController>
