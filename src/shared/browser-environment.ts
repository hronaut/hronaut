import type {
  BrowserColorSchemeEmulation,
  BrowserEmulationState,
  BrowserEnvironmentSettings,
  BrowserAnimationPlaybackRate,
  BrowserDataSaverEmulation,
  BrowserNetworkEmulation,
  BrowserReducedMotionEmulation,
  BrowserMediaTypeEmulation,
  BrowserForcedColorsEmulation,
  BrowserContrastEmulation,
  BrowserReducedTransparencyEmulation,
  BrowserVisionDeficiencyEmulation
} from './types.js'

const NETWORK_VALUES: readonly BrowserNetworkEmulation[] = ['none', 'offline', 'slow-3g', 'slow-4g', 'fast-4g']
const DATA_SAVER_VALUES: readonly BrowserDataSaverEmulation[] = ['auto', 'enabled', 'disabled']
const ANIMATION_PLAYBACK_RATES: readonly BrowserAnimationPlaybackRate[] = [0, 0.1, 0.25, 1]
const COLOR_SCHEME_VALUES: readonly BrowserColorSchemeEmulation[] = ['auto', 'light', 'dark']
const REDUCED_MOTION_VALUES: readonly BrowserReducedMotionEmulation[] = ['auto', 'reduce', 'no-preference']
const MEDIA_TYPE_VALUES: readonly BrowserMediaTypeEmulation[] = ['auto', 'screen', 'print']
const FORCED_COLORS_VALUES: readonly BrowserForcedColorsEmulation[] = ['auto', 'active', 'none']
const CONTRAST_VALUES: readonly BrowserContrastEmulation[] = ['auto', 'more', 'less', 'custom', 'no-preference']
const REDUCED_TRANSPARENCY_VALUES: readonly BrowserReducedTransparencyEmulation[] = ['auto', 'reduce', 'no-preference']
const VISION_DEFICIENCY_VALUES: readonly BrowserVisionDeficiencyEmulation[] = ['none', 'blurredVision', 'reducedContrast', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']

const DEFAULT_RENDERING_DEBUG = {
  paintFlashing: false,
  layoutShiftRegions: false,
  layerBorders: false,
  fpsCounter: false,
  scrollBottlenecks: false
} as const

export const DEFAULT_BROWSER_ENVIRONMENT: BrowserEnvironmentSettings = {
  network: 'none',
  cacheDisabled: false,
  bypassServiceWorker: false,
  dataSaver: 'auto',
  cpuThrottlingRate: 1,
  animationPlaybackRate: 1,
  colorScheme: 'auto',
  reducedMotion: 'auto',
  mediaType: 'auto',
  forcedColors: 'auto',
  contrast: 'auto',
  reducedTransparency: 'auto',
  visionDeficiency: 'none',
  userAgent: '',
  locale: '',
  timezoneId: '',
  javaScriptDisabled: false,
  geolocation: null,
  renderingDebug: { ...DEFAULT_RENDERING_DEBUG }
}

export function browserEnvironmentFromEmulation(emulation?: BrowserEmulationState): BrowserEnvironmentSettings {
  if (!emulation) return { ...DEFAULT_BROWSER_ENVIRONMENT, renderingDebug: { ...DEFAULT_RENDERING_DEBUG } }
  return {
    network: emulation.network,
    cacheDisabled: emulation.cacheDisabled,
    bypassServiceWorker: emulation.bypassServiceWorker,
    dataSaver: emulation.dataSaver,
    cpuThrottlingRate: emulation.cpuThrottlingRate,
    animationPlaybackRate: emulation.animationPlaybackRate ?? 1,
    colorScheme: emulation.colorScheme,
    reducedMotion: emulation.reducedMotion,
    mediaType: emulation.mediaType,
    forcedColors: emulation.forcedColors,
    contrast: emulation.contrast,
    reducedTransparency: emulation.reducedTransparency,
    visionDeficiency: emulation.visionDeficiency,
    userAgent: emulation.userAgent ?? '',
    locale: emulation.locale ?? '',
    timezoneId: emulation.timezoneId ?? '',
    javaScriptDisabled: emulation.javaScriptDisabled === true,
    geolocation: emulation.geolocation ? { ...emulation.geolocation } : null,
    renderingDebug: { ...DEFAULT_RENDERING_DEBUG, ...emulation.renderingDebug }
  }
}

export function browserEnvironmentOverrideCount(environment: BrowserEnvironmentSettings): number {
  return [
    environment.network !== 'none',
    environment.cacheDisabled,
    environment.bypassServiceWorker,
    environment.dataSaver !== 'auto',
    environment.cpuThrottlingRate !== 1,
    environment.animationPlaybackRate !== 1,
    environment.colorScheme !== 'auto',
    environment.reducedMotion !== 'auto',
    environment.mediaType !== 'auto',
    environment.forcedColors !== 'auto',
    environment.contrast !== 'auto',
    environment.reducedTransparency !== 'auto',
    environment.visionDeficiency !== 'none',
    environment.userAgent.length > 0,
    environment.locale.length > 0,
    environment.timezoneId.length > 0,
    environment.javaScriptDisabled,
    environment.geolocation !== null,
    environment.renderingDebug.paintFlashing,
    environment.renderingDebug.layoutShiftRegions,
    environment.renderingDebug.layerBorders,
    environment.renderingDebug.fpsCounter,
    environment.renderingDebug.scrollBottlenecks
  ].filter(Boolean).length
}

export function isBrowserEnvironmentSettings(value: unknown): value is BrowserEnvironmentSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (!NETWORK_VALUES.includes(candidate.network as BrowserNetworkEmulation)) return false
  if (typeof candidate.cacheDisabled !== 'boolean') return false
  if (typeof candidate.bypassServiceWorker !== 'boolean') return false
  if (!DATA_SAVER_VALUES.includes(candidate.dataSaver as BrowserDataSaverEmulation)) return false
  if (typeof candidate.cpuThrottlingRate !== 'number'
    || !Number.isFinite(candidate.cpuThrottlingRate)
    || candidate.cpuThrottlingRate < 1
    || candidate.cpuThrottlingRate > 20) return false
  if (!ANIMATION_PLAYBACK_RATES.includes(candidate.animationPlaybackRate as BrowserAnimationPlaybackRate)) return false
  if (!COLOR_SCHEME_VALUES.includes(candidate.colorScheme as BrowserColorSchemeEmulation)) return false
  if (!REDUCED_MOTION_VALUES.includes(candidate.reducedMotion as BrowserReducedMotionEmulation)) return false
  if (!MEDIA_TYPE_VALUES.includes(candidate.mediaType as BrowserMediaTypeEmulation)) return false
  if (!FORCED_COLORS_VALUES.includes(candidate.forcedColors as BrowserForcedColorsEmulation)) return false
  if (!CONTRAST_VALUES.includes(candidate.contrast as BrowserContrastEmulation)) return false
  if (!REDUCED_TRANSPARENCY_VALUES.includes(candidate.reducedTransparency as BrowserReducedTransparencyEmulation)) return false
  if (!VISION_DEFICIENCY_VALUES.includes(candidate.visionDeficiency as BrowserVisionDeficiencyEmulation)) return false
  if (typeof candidate.userAgent !== 'string'
    || candidate.userAgent.length > 512
    || /[\u0000-\u001f\u007f]/.test(candidate.userAgent)) return false
  if (!isValidBrowserLocale(candidate.locale)) return false
  if (!isValidBrowserTimezone(candidate.timezoneId)) return false
  if (typeof candidate.javaScriptDisabled !== 'boolean') return false
  if (!candidate.renderingDebug || typeof candidate.renderingDebug !== 'object' || Array.isArray(candidate.renderingDebug)) return false
  const renderingDebug = candidate.renderingDebug as Record<string, unknown>
  if (!['paintFlashing', 'layoutShiftRegions', 'layerBorders', 'fpsCounter', 'scrollBottlenecks']
    .every((key) => typeof renderingDebug[key] === 'boolean')) return false
  if (candidate.geolocation === null) return true
  if (!candidate.geolocation || typeof candidate.geolocation !== 'object' || Array.isArray(candidate.geolocation)) return false
  const geolocation = candidate.geolocation as Record<string, unknown>
  return typeof geolocation.latitude === 'number'
    && Number.isFinite(geolocation.latitude)
    && geolocation.latitude >= -90
    && geolocation.latitude <= 90
    && typeof geolocation.longitude === 'number'
    && Number.isFinite(geolocation.longitude)
    && geolocation.longitude >= -180
    && geolocation.longitude <= 180
    && typeof geolocation.accuracy === 'number'
    && Number.isFinite(geolocation.accuracy)
    && geolocation.accuracy >= 0
    && geolocation.accuracy <= 100_000
}

export function isValidBrowserLocale(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) return false
  if (value === '') return true
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) return false
  try {
    return Intl.getCanonicalLocales(value).length === 1
  } catch {
    return false
  }
}

export function isValidBrowserTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_+\-/]*$/.test(value)) return false
  if (value === '') return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}
