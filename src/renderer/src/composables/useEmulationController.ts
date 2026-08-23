import { computed, ref, type Ref } from 'vue'
import type {
  BrowserEmulationState,
  BrowserState,
  BrowserTabState
} from '../../../shared/types.js'

type Translate = (key: string, parameters?: Record<string, unknown>, plural?: number) => string

export interface EmulationControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  resetTabEmulation: (tabId: string) => Promise<BrowserState>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  responsivePanelOpen: () => boolean
  loadResponsiveDraft: (viewport?: BrowserEmulationState['viewport']) => void
  environmentPanelOpen: () => boolean
  loadEnvironmentDraft: (emulation?: BrowserEmulationState) => void
  translate: Translate
  formatNumber: (value: number) => string
  formatPercent: (value: number) => string
  onResetError: (error: unknown) => void
}

export function useEmulationController(options: EmulationControllerOptions) {
  const activeEmulation = computed(() => options.activeTab.value?.emulation)
  const resetPending = ref(false)
  let mutationSequence = 0
  let resetOperation = 0
  let disposed = false

  function networkLabel(network: BrowserEmulationState['network']): string {
    if (network === 'slow-3g') return options.translate('environment.network.slow3g')
    if (network === 'slow-4g') return options.translate('environment.network.slow4g')
    if (network === 'fast-4g') return options.translate('environment.network.fast4g')
    if (network === 'offline') return options.translate('environment.network.offline')
    return options.translate('runtime.emulation.normal')
  }

  function visionDeficiencyLabel(value: BrowserEmulationState['visionDeficiency']): string {
    if (value === 'blurredVision') return options.translate('environment.rendering.blurred')
    if (value === 'reducedContrast') return options.translate('environment.rendering.reducedContrast')
    if (value === 'protanopia') return options.translate('environment.rendering.protanopia')
    if (value === 'deuteranopia') return options.translate('environment.rendering.deuteranopia')
    if (value === 'tritanopia') return options.translate('environment.rendering.tritanopia')
    if (value === 'achromatopsia') return options.translate('environment.rendering.achromatopsia')
    return options.translate('environment.rendering.noSimulation')
  }

  function label(emulation: BrowserEmulationState): string {
    const animationPlaybackRate = emulation.animationPlaybackRate ?? 1
    if (emulation.network !== 'none') return networkLabel(emulation.network)
    if (emulation.cacheDisabled) return options.translate('runtime.emulation.cacheDisabled')
    if (emulation.bypassServiceWorker) return options.translate('runtime.emulation.workerBypassed')
    if (emulation.dataSaver !== 'auto') return options.translate(emulation.dataSaver === 'enabled' ? 'runtime.emulation.dataSaverOn' : 'runtime.emulation.dataSaverOff')
    if (emulation.javaScriptDisabled) return options.translate('runtime.emulation.jsDisabled')
    if (emulation.viewport) return options.translate('runtimeDetails.emulation.viewport', { size: `${options.formatNumber(emulation.viewport.width)}×${options.formatNumber(emulation.viewport.height)}`, scale: options.formatNumber(emulation.viewport.deviceScaleFactor), mobile: emulation.viewport.mobile ? options.translate('runtimeDetails.emulation.mobile') : '', touch: '', orientation: emulation.viewport.orientation })
    if (emulation.locale) return options.translate('runtimeDetails.emulation.locale', { locale: emulation.locale })
    if (emulation.timezoneId) return emulation.timezoneId
    if (emulation.geolocation) return options.translate('runtime.emulation.location')
    if (emulation.cpuThrottlingRate > 1) return options.translate('runtimeDetails.emulation.cpu', { rate: options.formatNumber(emulation.cpuThrottlingRate) })
    if (animationPlaybackRate !== 1) return animationPlaybackRate === 0 ? options.translate('runtime.emulation.animationsPaused') : options.translate('runtime.emulation.animations', { percent: options.formatPercent(animationPlaybackRate * 100) })
    if (emulation.colorScheme !== 'auto') return options.translate(emulation.colorScheme === 'dark' ? 'runtime.emulation.darkMode' : 'runtime.emulation.lightMode')
    if (emulation.reducedMotion !== 'auto') return options.translate(emulation.reducedMotion === 'reduce' ? 'runtime.emulation.reducedMotion' : 'runtime.emulation.fullMotion')
    if (emulation.mediaType !== 'auto') return options.translate(emulation.mediaType === 'print' ? 'runtime.emulation.printMedia' : 'runtime.emulation.screenMedia')
    if (emulation.forcedColors !== 'auto') return options.translate(emulation.forcedColors === 'active' ? 'runtime.emulation.forcedColors' : 'runtime.emulation.noForcedColors')
    if (emulation.contrast !== 'auto') return options.translate('runtimeDetails.emulation.contrast', { contrast: emulation.contrast })
    if (emulation.reducedTransparency !== 'auto') return options.translate(emulation.reducedTransparency === 'reduce' ? 'runtime.emulation.reducedTransparency' : 'runtime.emulation.fullTransparency')
    if (emulation.visionDeficiency !== 'none') return visionDeficiencyLabel(emulation.visionDeficiency)
    if (emulation.renderingDebug?.paintFlashing) return options.translate('runtime.emulation.paint')
    if (emulation.renderingDebug?.layoutShiftRegions) return options.translate('runtime.emulation.shifts')
    if (emulation.renderingDebug?.layerBorders) return options.translate('runtime.emulation.layers')
    if (emulation.renderingDebug?.fpsCounter) return options.translate('runtime.emulation.frames')
    if (emulation.renderingDebug?.scrollBottlenecks) return options.translate('runtime.emulation.scroll')
    if (emulation.extraHttpHeaderNames?.length) return options.translate('runtimeDetails.headers', { count: options.formatNumber(emulation.extraHttpHeaderNames.length) }, emulation.extraHttpHeaderNames.length)
    return options.translate('runtime.emulation.custom')
  }

  function describe(emulation: BrowserEmulationState): string {
    const conditions: string[] = []
    const animationPlaybackRate = emulation.animationPlaybackRate ?? 1
    if (emulation.network !== 'none') conditions.push(networkLabel(emulation.network))
    if (emulation.cacheDisabled) conditions.push(options.translate('runtimeDetails.emulation.cache'))
    if (emulation.bypassServiceWorker) conditions.push(options.translate('runtimeDetails.emulation.worker'))
    if (emulation.dataSaver !== 'auto') conditions.push(options.translate('runtimeDetails.emulation.dataSaver', { state: options.translate(emulation.dataSaver === 'enabled' ? 'runtimeDetails.emulation.on' : 'runtimeDetails.emulation.off') }))
    if (emulation.javaScriptDisabled) conditions.push(options.translate('runtimeDetails.emulation.js'))
    if (emulation.viewport) {
      conditions.push(options.translate('runtimeDetails.emulation.viewport', { size: `${options.formatNumber(emulation.viewport.width)}×${options.formatNumber(emulation.viewport.height)}`, scale: options.formatNumber(emulation.viewport.deviceScaleFactor), mobile: emulation.viewport.mobile ? options.translate('runtimeDetails.emulation.mobile') : '', touch: emulation.viewport.touch ? options.translate('runtimeDetails.emulation.touch') : '', orientation: emulation.viewport.orientation }))
    }
    if (emulation.geolocation) conditions.push(options.translate('runtimeDetails.emulation.geolocation'))
    if (emulation.locale) conditions.push(options.translate('runtimeDetails.emulation.locale', { locale: emulation.locale }))
    if (emulation.timezoneId) conditions.push(options.translate('runtimeDetails.emulation.timezone', { timezone: emulation.timezoneId }))
    if (emulation.cpuThrottlingRate > 1) conditions.push(options.translate('runtimeDetails.emulation.cpu', { rate: options.formatNumber(emulation.cpuThrottlingRate) }))
    if (animationPlaybackRate !== 1) conditions.push(animationPlaybackRate === 0 ? options.translate('runtimeDetails.emulation.animationsPaused') : options.translate('runtimeDetails.emulation.animations', { percent: options.formatPercent(animationPlaybackRate * 100) }))
    if (emulation.colorScheme !== 'auto') conditions.push(options.translate('runtimeDetails.emulation.color', { scheme: emulation.colorScheme }))
    if (emulation.reducedMotion !== 'auto') conditions.push(options.translate(emulation.reducedMotion === 'reduce' ? 'runtimeDetails.emulation.reducedMotion' : 'runtimeDetails.emulation.fullMotion'))
    if (emulation.mediaType !== 'auto') conditions.push(options.translate('runtimeDetails.emulation.media', { media: emulation.mediaType }))
    if (emulation.forcedColors !== 'auto') conditions.push(options.translate('runtimeDetails.emulation.forced', { state: emulation.forcedColors }))
    if (emulation.contrast !== 'auto') conditions.push(options.translate('runtimeDetails.emulation.contrast', { contrast: emulation.contrast }))
    if (emulation.reducedTransparency !== 'auto') conditions.push(options.translate(emulation.reducedTransparency === 'reduce' ? 'runtimeDetails.emulation.reducedTransparency' : 'runtimeDetails.emulation.fullTransparency'))
    if (emulation.visionDeficiency !== 'none') conditions.push(options.translate('runtimeDetails.emulation.vision', { vision: visionDeficiencyLabel(emulation.visionDeficiency) }))
    if (emulation.renderingDebug?.paintFlashing) conditions.push(options.translate('runtimeDetails.emulation.paint'))
    if (emulation.renderingDebug?.layoutShiftRegions) conditions.push(options.translate('runtimeDetails.emulation.shifts'))
    if (emulation.renderingDebug?.layerBorders) conditions.push(options.translate('runtimeDetails.emulation.layers'))
    if (emulation.renderingDebug?.fpsCounter) conditions.push(options.translate('runtimeDetails.emulation.frames'))
    if (emulation.renderingDebug?.scrollBottlenecks) conditions.push(options.translate('runtimeDetails.emulation.scroll'))
    if (emulation.userAgent) conditions.push(options.translate('runtimeDetails.emulation.userAgent'))
    if (emulation.extraHttpHeaderNames?.length) conditions.push(options.translate('runtimeDetails.emulation.customHeaders', { count: options.formatNumber(emulation.extraHttpHeaderNames.length) }, emulation.extraHttpHeaderNames.length))
    return conditions.join(', ') || options.translate('runtimeDetails.emulation.custom')
  }

  function beginMutation(): number {
    return ++mutationSequence
  }

  function invalidateMutation(): void {
    mutationSequence += 1
  }

  function isMutationCurrent(sequence: number, tabId: string): boolean {
    return !disposed && sequence === mutationSequence && options.activeTab.value?.id === tabId
  }

  async function resetActive(): Promise<boolean> {
    const tab = options.activeTab.value
    if (disposed || resetPending.value || !tab?.emulation) return false
    const mutation = beginMutation()
    const operation = ++resetOperation
    resetPending.value = true
    try {
      await options.syncState(options.resetTabEmulation(tab.id))
      if (!isMutationCurrent(mutation, tab.id)) return false
      if (options.responsivePanelOpen()) options.loadResponsiveDraft(options.activeTab.value?.emulation?.viewport)
      if (options.environmentPanelOpen()) options.loadEnvironmentDraft(options.activeTab.value?.emulation)
      return true
    } catch (error) {
      if (isMutationCurrent(mutation, tab.id)) options.onResetError(error)
      return false
    } finally {
      if (operation === resetOperation) resetPending.value = false
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    mutationSequence += 1
    resetOperation += 1
    resetPending.value = false
  }

  return {
    activeEmulation,
    resetPending,
    label,
    describe,
    beginMutation,
    invalidateMutation,
    isMutationCurrent,
    resetActive,
    dispose
  }
}

export type EmulationController = ReturnType<typeof useEmulationController>
