import { validateHeaderName, validateHeaderValue } from 'node:http'
import type { BrowserEmulationOptions, BrowserEmulationState, BrowserViewportEmulation } from '../../shared/types.js'
import { resolveViewportPreset } from '../../shared/viewport-presets.js'
import { DEFAULT_RENDERING_DEBUG, isValidBrowserLocale, isValidBrowserTimezone } from '../../shared/browser-environment.js'

export const DEFAULT_EMULATION: BrowserEmulationState = {
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
  visionDeficiency: 'none'
}

export function hasEmulationOverrides(state: BrowserEmulationState): boolean {
  return state.network !== 'none'
    || state.cacheDisabled
    || state.bypassServiceWorker
    || state.dataSaver !== 'auto'
    || state.cpuThrottlingRate !== 1
    || (state.animationPlaybackRate ?? 1) !== 1
    || state.colorScheme !== 'auto'
    || state.reducedMotion !== 'auto'
    || state.mediaType !== 'auto'
    || state.forcedColors !== 'auto'
    || state.contrast !== 'auto'
    || state.reducedTransparency !== 'auto'
    || state.visionDeficiency !== 'none'
    || state.userAgent !== undefined
    || state.locale !== undefined
    || state.timezoneId !== undefined
    || state.javaScriptDisabled === true
    || state.viewport !== undefined
    || state.geolocation !== undefined
    || Boolean(state.extraHttpHeaderNames?.length)
    || Boolean(state.renderingDebug && Object.values(state.renderingDebug).some(Boolean))
}

export function cloneEmulationState(state: BrowserEmulationState): BrowserEmulationState {
  return {
    ...state,
    ...(state.viewport ? { viewport: { ...state.viewport } } : {}),
    ...(state.geolocation ? { geolocation: { ...state.geolocation } } : {}),
    ...(state.extraHttpHeaderNames ? { extraHttpHeaderNames: [...state.extraHttpHeaderNames] } : {}),
    ...(state.renderingDebug ? { renderingDebug: { ...state.renderingDebug } } : {})
  }
}

function validateViewportEmulation(viewport: BrowserViewportEmulation): void {
  if (!Number.isInteger(viewport.width) || viewport.width < 200 || viewport.width > 3840) {
    throw new Error('viewport width must be an integer between 200 and 3840')
  }
  if (!Number.isInteger(viewport.height) || viewport.height < 200 || viewport.height > 3840) {
    throw new Error('viewport height must be an integer between 200 and 3840')
  }
  if (!Number.isFinite(viewport.deviceScaleFactor)
    || viewport.deviceScaleFactor < 0.5
    || viewport.deviceScaleFactor > 5) {
    throw new Error('viewport deviceScaleFactor must be between 0.5 and 5')
  }
  if (typeof viewport.mobile !== 'boolean' || typeof viewport.touch !== 'boolean') {
    throw new Error('viewport mobile and touch must be boolean values')
  }
  if (viewport.orientation !== 'portrait' && viewport.orientation !== 'landscape') {
    throw new Error('viewport orientation must be portrait or landscape')
  }
}

/** Returns null for a read-only request; preparing a change never mutates current state. */
export function prepareBrowserEmulation(
  current: BrowserEmulationState,
  currentHeaders: Record<string, string>,
  options: BrowserEmulationOptions
): { state: BrowserEmulationState; headers: Record<string, string> } | null {
  if (options.viewport !== undefined && options.viewportPreset !== undefined) {
    throw new Error('viewport and viewportPreset cannot be combined')
  }
  if (options.viewportOrientation !== undefined && options.viewportPreset === undefined) {
    throw new Error('viewportOrientation requires viewportPreset')
  }
  const requestedViewport = options.viewportPreset !== undefined
    ? resolveViewportPreset(options.viewportPreset, options.viewportOrientation)
    : options.viewport
  const overridesProvided = options.network !== undefined
    || options.cacheDisabled !== undefined
    || options.bypassServiceWorker !== undefined
    || options.dataSaver !== undefined
    || options.cpuThrottlingRate !== undefined
    || options.animationPlaybackRate !== undefined
    || options.colorScheme !== undefined
    || options.reducedMotion !== undefined
    || options.mediaType !== undefined
    || options.forcedColors !== undefined
    || options.contrast !== undefined
    || options.reducedTransparency !== undefined
    || options.visionDeficiency !== undefined
    || options.userAgent !== undefined
    || options.locale !== undefined
    || options.timezoneId !== undefined
    || options.javaScriptDisabled !== undefined
    || options.viewport !== undefined
    || options.viewportPreset !== undefined
    || options.geolocation !== undefined
    || options.extraHttpHeaders !== undefined
    || options.renderingDebug !== undefined
  if (options.reset && overridesProvided) throw new Error('reset cannot be combined with emulation overrides')
  if (!options.reset && !overridesProvided) return null
  if (options.cpuThrottlingRate !== undefined && (
    !Number.isFinite(options.cpuThrottlingRate)
    || options.cpuThrottlingRate < 1
    || options.cpuThrottlingRate > 20
  )) throw new Error('cpuThrottlingRate must be between 1 and 20')
  if (options.animationPlaybackRate !== undefined
    && ![0, 0.1, 0.25, 1].includes(options.animationPlaybackRate)) {
    throw new Error('animationPlaybackRate must be 0, 0.1, 0.25, or 1')
  }
  // HTTP user agents must exclude control characters.
  // eslint-disable-next-line no-control-regex
  if (options.userAgent !== undefined && /[\u0000-\u001f\u007f]/.test(options.userAgent)) {
    throw new Error('userAgent cannot contain control characters')
  }
  if (options.locale !== undefined && !isValidBrowserLocale(options.locale)) {
    throw new Error('locale must be empty or a valid BCP 47 language tag such as en-US')
  }
  if (options.timezoneId !== undefined && !isValidBrowserTimezone(options.timezoneId)) {
    throw new Error('timezoneId must be empty or a supported IANA time zone such as America/New_York')
  }
  if (requestedViewport) validateViewportEmulation(requestedViewport)
  if (options.geolocation) {
    const { latitude, longitude, accuracy } = options.geolocation
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error('geolocation latitude must be between -90 and 90')
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('geolocation longitude must be between -180 and 180')
    }
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000) {
      throw new Error('geolocation accuracy must be between 0 and 100000 meters')
    }
  }
  if (options.extraHttpHeaders !== undefined) {
    const entries = Object.entries(options.extraHttpHeaders)
    if (entries.length > 50) throw new Error('extraHttpHeaders cannot contain more than 50 headers')
    for (const [name, value] of entries) {
      try {
        validateHeaderName(name)
        validateHeaderValue(name, value)
      } catch {
        throw new Error(`Invalid extra HTTP header: ${name || '(empty name)'}`)
      }
    }
    const totalHeaderBytes = entries.reduce((total, [name, value]) => total + Buffer.byteLength(name) + Buffer.byteLength(value), 0)
    if (totalHeaderBytes > 64 * 1024) throw new Error('extraHttpHeaders cannot exceed 64 KB in total')
  }
  if (options.renderingDebug !== undefined && options.renderingDebug !== null) {
    for (const [name, value] of Object.entries(options.renderingDebug)) {
      if (!Object.hasOwn(DEFAULT_RENDERING_DEBUG, name) || typeof value !== 'boolean') {
        throw new Error(`Invalid rendering debug overlay: ${name}`)
      }
    }
  }

  const previousHeaders = { ...currentHeaders }
  const nextHeaders = options.reset
    ? {}
    : options.extraHttpHeaders !== undefined ? { ...options.extraHttpHeaders } : previousHeaders
  const next: BrowserEmulationState = options.reset
    ? { ...DEFAULT_EMULATION }
    : {
        ...current,
        ...(options.network !== undefined ? { network: options.network } : {}),
        ...(options.cacheDisabled !== undefined ? { cacheDisabled: options.cacheDisabled } : {}),
        ...(options.bypassServiceWorker !== undefined ? { bypassServiceWorker: options.bypassServiceWorker } : {}),
        ...(options.dataSaver !== undefined ? { dataSaver: options.dataSaver } : {}),
        ...(options.cpuThrottlingRate !== undefined ? { cpuThrottlingRate: options.cpuThrottlingRate } : {}),
        ...(options.animationPlaybackRate !== undefined ? { animationPlaybackRate: options.animationPlaybackRate } : {}),
        ...(options.colorScheme !== undefined ? { colorScheme: options.colorScheme } : {}),
        ...(options.reducedMotion !== undefined ? { reducedMotion: options.reducedMotion } : {}),
        ...(options.mediaType !== undefined ? { mediaType: options.mediaType } : {}),
        ...(options.forcedColors !== undefined ? { forcedColors: options.forcedColors } : {}),
        ...(options.contrast !== undefined ? { contrast: options.contrast } : {}),
        ...(options.reducedTransparency !== undefined ? { reducedTransparency: options.reducedTransparency } : {}),
        ...(options.visionDeficiency !== undefined ? { visionDeficiency: options.visionDeficiency } : {}),
        ...(options.userAgent !== undefined
          ? options.userAgent === '' ? { userAgent: undefined } : { userAgent: options.userAgent }
          : {}),
        ...(options.locale !== undefined
          ? options.locale === '' ? { locale: undefined } : { locale: Intl.getCanonicalLocales(options.locale)[0] }
          : {}),
        ...(options.timezoneId !== undefined
          ? options.timezoneId === ''
            ? { timezoneId: undefined }
            : { timezoneId: new Intl.DateTimeFormat('en-US', { timeZone: options.timezoneId }).resolvedOptions().timeZone }
          : {}),
        ...(options.javaScriptDisabled !== undefined
          ? { javaScriptDisabled: options.javaScriptDisabled || undefined }
          : {}),
        ...(requestedViewport !== undefined
          ? { viewport: requestedViewport === null ? undefined : { ...requestedViewport } }
          : {}),
        ...(options.geolocation !== undefined
          ? { geolocation: options.geolocation === null ? undefined : { ...options.geolocation } }
          : {}),
        ...(options.extraHttpHeaders !== undefined
          ? { extraHttpHeaderNames: Object.keys(nextHeaders).sort((left, right) => left.localeCompare(right)) }
          : {}),
        ...(options.renderingDebug !== undefined
          ? {
              renderingDebug: options.renderingDebug === null
                ? undefined
                : {
                    ...DEFAULT_RENDERING_DEBUG,
                    ...current.renderingDebug,
                    ...options.renderingDebug
                  }
            }
          : {})
      }
  if (!next.extraHttpHeaderNames?.length) delete next.extraHttpHeaderNames
  if (next.renderingDebug && !Object.values(next.renderingDebug).some(Boolean)) delete next.renderingDebug
  return { state: next, headers: nextHeaders }
}
