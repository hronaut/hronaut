import type { BrowserEmulationState } from './types.js'

/** How the words for emulated conditions are looked up and numbers written, in the interface language. */
export interface EmulationWording {
  translate: (key: string, parameters?: Record<string, unknown>, plural?: number) => string
  formatNumber: (value: number) => string
  formatPercent: (value: number) => string
}

function networkLabel(network: BrowserEmulationState['network'], format: EmulationWording): string {
  if (network === 'slow-3g') return format.translate('environment.network.slow3g')
  if (network === 'slow-4g') return format.translate('environment.network.slow4g')
  if (network === 'fast-4g') return format.translate('environment.network.fast4g')
  if (network === 'offline') return format.translate('environment.network.offline')
  return format.translate('runtime.emulation.normal')
}

function visionDeficiencyLabel(value: BrowserEmulationState['visionDeficiency'], format: EmulationWording): string {
  if (value === 'blurredVision') return format.translate('environment.rendering.blurred')
  if (value === 'reducedContrast') return format.translate('environment.rendering.reducedContrast')
  if (value === 'protanopia') return format.translate('environment.rendering.protanopia')
  if (value === 'deuteranopia') return format.translate('environment.rendering.deuteranopia')
  if (value === 'tritanopia') return format.translate('environment.rendering.tritanopia')
  if (value === 'achromatopsia') return format.translate('environment.rendering.achromatopsia')
  return format.translate('environment.rendering.noSimulation')
}

/** The one condition a short label names, such as the emulated network or viewport. */
export function emulationLabel(emulation: BrowserEmulationState, format: EmulationWording): string {
  const animationPlaybackRate = emulation.animationPlaybackRate ?? 1
  if (emulation.network !== 'none') return networkLabel(emulation.network, format)
  if (emulation.cacheDisabled) return format.translate('runtime.emulation.cacheDisabled')
  if (emulation.bypassServiceWorker) return format.translate('runtime.emulation.workerBypassed')
  if (emulation.dataSaver !== 'auto') {
    return format.translate(emulation.dataSaver === 'enabled' ? 'runtime.emulation.dataSaverOn' : 'runtime.emulation.dataSaverOff')
  }
  if (emulation.javaScriptDisabled) return format.translate('runtime.emulation.jsDisabled')
  if (emulation.viewport) {
    return format.translate('runtimeDetails.emulation.viewport', {
      size: `${format.formatNumber(emulation.viewport.width)}×${format.formatNumber(emulation.viewport.height)}`,
      scale: format.formatNumber(emulation.viewport.deviceScaleFactor),
      mobile: emulation.viewport.mobile ? format.translate('runtimeDetails.emulation.mobile') : '',
      touch: '',
      orientation: emulation.viewport.orientation
    })
  }
  if (emulation.locale) return format.translate('runtimeDetails.emulation.locale', { locale: emulation.locale })
  if (emulation.timezoneId) return emulation.timezoneId
  if (emulation.geolocation) return format.translate('runtime.emulation.location')
  if (emulation.cpuThrottlingRate > 1) {
    return format.translate('runtimeDetails.emulation.cpu', { rate: format.formatNumber(emulation.cpuThrottlingRate) })
  }
  if (animationPlaybackRate !== 1) {
    return animationPlaybackRate === 0
      ? format.translate('runtime.emulation.animationsPaused')
      : format.translate('runtime.emulation.animations', { percent: format.formatPercent(animationPlaybackRate * 100) })
  }
  if (emulation.colorScheme !== 'auto') {
    return format.translate(emulation.colorScheme === 'dark' ? 'runtime.emulation.darkMode' : 'runtime.emulation.lightMode')
  }
  if (emulation.reducedMotion !== 'auto') {
    return format.translate(emulation.reducedMotion === 'reduce' ? 'runtime.emulation.reducedMotion' : 'runtime.emulation.fullMotion')
  }
  if (emulation.mediaType !== 'auto') {
    return format.translate(emulation.mediaType === 'print' ? 'runtime.emulation.printMedia' : 'runtime.emulation.screenMedia')
  }
  if (emulation.forcedColors !== 'auto') {
    return format.translate(emulation.forcedColors === 'active' ? 'runtime.emulation.forcedColors' : 'runtime.emulation.noForcedColors')
  }
  if (emulation.contrast !== 'auto') return format.translate('runtimeDetails.emulation.contrast', { contrast: emulation.contrast })
  if (emulation.reducedTransparency !== 'auto') {
    return format.translate(emulation.reducedTransparency === 'reduce' ? 'runtime.emulation.reducedTransparency' : 'runtime.emulation.fullTransparency')
  }
  if (emulation.visionDeficiency !== 'none') return visionDeficiencyLabel(emulation.visionDeficiency, format)
  if (emulation.renderingDebug?.paintFlashing) return format.translate('runtime.emulation.paint')
  if (emulation.renderingDebug?.layoutShiftRegions) return format.translate('runtime.emulation.shifts')
  if (emulation.renderingDebug?.layerBorders) return format.translate('runtime.emulation.layers')
  if (emulation.renderingDebug?.fpsCounter) return format.translate('runtime.emulation.frames')
  if (emulation.renderingDebug?.scrollBottlenecks) return format.translate('runtime.emulation.scroll')
  if (emulation.extraHttpHeaderNames?.length) {
    const count = emulation.extraHttpHeaderNames.length
    return format.translate('runtimeDetails.headers', { count: format.formatNumber(count) }, count)
  }
  return format.translate('runtime.emulation.custom')
}

/** Every emulated condition, comma-separated, as the tab's details and its card in Home's Tabs view list them. */
export function describeEmulation(emulation: BrowserEmulationState, format: EmulationWording): string {
  const conditions: string[] = []
  const animationPlaybackRate = emulation.animationPlaybackRate ?? 1
  if (emulation.network !== 'none') conditions.push(networkLabel(emulation.network, format))
  if (emulation.cacheDisabled) conditions.push(format.translate('runtimeDetails.emulation.cache'))
  if (emulation.bypassServiceWorker) conditions.push(format.translate('runtimeDetails.emulation.worker'))
  if (emulation.dataSaver !== 'auto') {
    const state = format.translate(emulation.dataSaver === 'enabled' ? 'runtimeDetails.emulation.on' : 'runtimeDetails.emulation.off')
    conditions.push(format.translate('runtimeDetails.emulation.dataSaver', { state }))
  }
  if (emulation.javaScriptDisabled) conditions.push(format.translate('runtimeDetails.emulation.js'))
  if (emulation.viewport) {
    conditions.push(format.translate('runtimeDetails.emulation.viewport', {
      size: `${format.formatNumber(emulation.viewport.width)}×${format.formatNumber(emulation.viewport.height)}`,
      scale: format.formatNumber(emulation.viewport.deviceScaleFactor),
      mobile: emulation.viewport.mobile ? format.translate('runtimeDetails.emulation.mobile') : '',
      touch: emulation.viewport.touch ? format.translate('runtimeDetails.emulation.touch') : '',
      orientation: emulation.viewport.orientation
    }))
  }
  if (emulation.geolocation) conditions.push(format.translate('runtimeDetails.emulation.geolocation'))
  if (emulation.safeAreaInsets) conditions.push(format.translate('runtimeDetails.emulation.safeArea'))
  if (emulation.osTextScale !== undefined) {
    conditions.push(format.translate('runtimeDetails.emulation.textScale', { percent: format.formatPercent(emulation.osTextScale * 100) }))
  }
  if (emulation.smallViewportHeightDifference !== undefined) {
    const difference = format.formatNumber(emulation.smallViewportHeightDifference)
    conditions.push(format.translate('runtimeDetails.emulation.smallViewport', { difference }))
  }
  if (emulation.locale) conditions.push(format.translate('runtimeDetails.emulation.locale', { locale: emulation.locale }))
  if (emulation.timezoneId) conditions.push(format.translate('runtimeDetails.emulation.timezone', { timezone: emulation.timezoneId }))
  if (emulation.cpuThrottlingRate > 1) {
    conditions.push(format.translate('runtimeDetails.emulation.cpu', { rate: format.formatNumber(emulation.cpuThrottlingRate) }))
  }
  if (animationPlaybackRate !== 1) {
    conditions.push(animationPlaybackRate === 0
      ? format.translate('runtimeDetails.emulation.animationsPaused')
      : format.translate('runtimeDetails.emulation.animations', { percent: format.formatPercent(animationPlaybackRate * 100) }))
  }
  if (emulation.colorScheme !== 'auto') conditions.push(format.translate('runtimeDetails.emulation.color', { scheme: emulation.colorScheme }))
  if (emulation.reducedMotion !== 'auto') {
    conditions.push(format.translate(emulation.reducedMotion === 'reduce' ? 'runtimeDetails.emulation.reducedMotion' : 'runtimeDetails.emulation.fullMotion'))
  }
  if (emulation.mediaType !== 'auto') conditions.push(format.translate('runtimeDetails.emulation.media', { media: emulation.mediaType }))
  if (emulation.forcedColors !== 'auto') conditions.push(format.translate('runtimeDetails.emulation.forced', { state: emulation.forcedColors }))
  if (emulation.contrast !== 'auto') conditions.push(format.translate('runtimeDetails.emulation.contrast', { contrast: emulation.contrast }))
  if (emulation.reducedTransparency !== 'auto') {
    const reduced = emulation.reducedTransparency === 'reduce'
    conditions.push(format.translate(reduced ? 'runtimeDetails.emulation.reducedTransparency' : 'runtimeDetails.emulation.fullTransparency'))
  }
  if (emulation.visionDeficiency !== 'none') {
    conditions.push(format.translate('runtimeDetails.emulation.vision', { vision: visionDeficiencyLabel(emulation.visionDeficiency, format) }))
  }
  if (emulation.renderingDebug?.paintFlashing) conditions.push(format.translate('runtimeDetails.emulation.paint'))
  if (emulation.renderingDebug?.layoutShiftRegions) conditions.push(format.translate('runtimeDetails.emulation.shifts'))
  if (emulation.renderingDebug?.layerBorders) conditions.push(format.translate('runtimeDetails.emulation.layers'))
  if (emulation.renderingDebug?.fpsCounter) conditions.push(format.translate('runtimeDetails.emulation.frames'))
  if (emulation.renderingDebug?.scrollBottlenecks) conditions.push(format.translate('runtimeDetails.emulation.scroll'))
  if (emulation.userAgent) conditions.push(format.translate('runtimeDetails.emulation.userAgent'))
  if (emulation.extraHttpHeaderNames?.length) {
    const count = emulation.extraHttpHeaderNames.length
    conditions.push(format.translate('runtimeDetails.emulation.customHeaders', { count: format.formatNumber(count) }, count))
  }
  return conditions.join(', ') || format.translate('runtimeDetails.emulation.custom')
}
