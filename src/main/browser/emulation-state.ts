import { validateHeaderName, validateHeaderValue } from 'node:http'
import type { BrowserEmulationOptions, BrowserEmulationState, BrowserSafeAreaInsets, BrowserViewportEmulation } from '../../shared/types.js'
import { resolveViewportPreset } from '../../shared/viewport-presets.js'
import { DEFAULT_RENDERING_DEBUG, isValidBrowserLocale, isValidBrowserTimezone } from '../../shared/browser-environment.js'

export const EMULATION_INPUT_ERRORS = {
  VIEWPORT_CONFLICT: 'viewport and viewportPreset cannot be combined',
  ORIENTATION_REQUIRES_PRESET: 'viewportOrientation requires viewportPreset',
  RECOVERY_CONFLICT: 'recover cannot be combined with reset or emulation overrides',
  RESET_CONFLICT: 'reset cannot be combined with emulation overrides'
} as const

/** Bounded option-combination errors; never include request or native error text. */
export class EmulationInputError extends Error {
  constructor(readonly reason: keyof typeof EMULATION_INPUT_ERRORS) { super(EMULATION_INPUT_ERRORS[reason]) }
}

export const SAFE_AREA_INSET_FIELDS = ['top', 'topMax', 'left', 'leftMax', 'bottom', 'bottomMax', 'right', 'rightMax'] as const
export const MAX_SAFE_AREA_INSET = 1_000
export const MIN_OS_TEXT_SCALE = 0.85
export const MAX_OS_TEXT_SCALE = 2

function validateSafeAreaInsets(insets: BrowserSafeAreaInsets): void {
  if (!insets || typeof insets !== 'object' || Array.isArray(insets)) throw new Error('safeAreaInsets must be an object or null')
  for (const [name, value] of Object.entries(insets)) {
    if (!(SAFE_AREA_INSET_FIELDS as readonly string[]).includes(name)) throw new Error(`Invalid safe-area inset: ${name}`)
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_AREA_INSET) {
      throw new Error(`safeAreaInsets.${name} must be an integer from 0 to ${MAX_SAFE_AREA_INSET} CSS pixels`)
    }
  }
}

function copySafeAreaInsets(insets: BrowserSafeAreaInsets): BrowserSafeAreaInsets {
  return Object.fromEntries(SAFE_AREA_INSET_FIELDS.flatMap(name => insets[name] === undefined ? [] : [[name, insets[name]]]))
}

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
    || state.safeAreaInsets !== undefined
    || state.osTextScale !== undefined
    || Boolean(state.extraHttpHeaderNames?.length)
    || Boolean(state.renderingDebug && Object.values(state.renderingDebug).some(Boolean))
}

export function cloneEmulationState(state: BrowserEmulationState): BrowserEmulationState {
  return {
    ...state,
    ...(state.viewport ? { viewport: { ...state.viewport } } : {}),
    ...(state.geolocation ? { geolocation: { ...state.geolocation } } : {}),
    ...(state.safeAreaInsets ? { safeAreaInsets: copySafeAreaInsets(state.safeAreaInsets) } : {}),
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
    throw new EmulationInputError('VIEWPORT_CONFLICT')
  }
  if (options.viewportOrientation !== undefined && options.viewportPreset === undefined) {
    throw new EmulationInputError('ORIENTATION_REQUIRES_PRESET')
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
    || options.safeAreaInsets !== undefined
    || options.osTextScale !== undefined
    || options.extraHttpHeaders !== undefined
    || options.renderingDebug !== undefined
  if (options.recover) {
    if (options.reset !== undefined || overridesProvided || options.viewportOrientation !== undefined) throw new EmulationInputError('RECOVERY_CONFLICT')
    return { state: cloneEmulationState(current), headers: { ...currentHeaders } }
  }
  if (options.reset && overridesProvided) throw new EmulationInputError('RESET_CONFLICT')
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
  if (options.safeAreaInsets !== undefined && options.safeAreaInsets !== null) validateSafeAreaInsets(options.safeAreaInsets)
  if (options.osTextScale !== undefined && options.osTextScale !== null
    && (typeof options.osTextScale !== 'number' || !Number.isFinite(options.osTextScale)
      || options.osTextScale < MIN_OS_TEXT_SCALE || options.osTextScale > MAX_OS_TEXT_SCALE)) {
    // Chromium accepts any value here, so the documented range is enforced before dispatch.
    throw new Error(`osTextScale must be between ${MIN_OS_TEXT_SCALE} and ${MAX_OS_TEXT_SCALE}`)
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
        ...(options.safeAreaInsets !== undefined
          ? { safeAreaInsets: options.safeAreaInsets === null ? undefined : copySafeAreaInsets(options.safeAreaInsets) }
          : {}),
        ...(options.osTextScale !== undefined
          ? { osTextScale: options.osTextScale === null ? undefined : options.osTextScale }
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
