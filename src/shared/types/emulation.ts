export type BrowserNetworkEmulation = 'none' | 'offline' | 'slow-3g' | 'slow-4g' | 'fast-4g'
export type BrowserDataSaverEmulation = 'auto' | 'enabled' | 'disabled'
export type BrowserAnimationPlaybackRate = 0 | 0.1 | 0.25 | 1
export type BrowserColorSchemeEmulation = 'auto' | 'light' | 'dark'
export type BrowserReducedMotionEmulation = 'auto' | 'reduce' | 'no-preference'
export type BrowserMediaTypeEmulation = 'auto' | 'screen' | 'print'
export type BrowserForcedColorsEmulation = 'auto' | 'active' | 'none'
export type BrowserContrastEmulation = 'auto' | 'more' | 'less' | 'custom' | 'no-preference'
export type BrowserReducedTransparencyEmulation = 'auto' | 'reduce' | 'no-preference'
export type BrowserVisionDeficiencyEmulation = 'none' | 'blurredVision' | 'reducedContrast' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia'
export type BrowserViewportOrientation = 'portrait' | 'landscape'
export type BrowserViewportPresetId = 'compact-phone' | 'phone' | 'large-phone' | 'tablet' | 'laptop' | 'desktop'

export interface BrowserViewportEmulation {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  touch: boolean
  orientation: BrowserViewportOrientation
}

export interface BrowserGeolocationEmulation {
  latitude: number
  longitude: number
  accuracy: number
}

/** Integer CSS pixels for env(safe-area-inset-*) and env(safe-area-max-inset-*). */
export interface BrowserSafeAreaInsets {
  top?: number
  topMax?: number
  left?: number
  leftMax?: number
  bottom?: number
  bottomMax?: number
  right?: number
  rightMax?: number
}

export interface BrowserRenderingDebugOverlays {
  paintFlashing: boolean
  layoutShiftRegions: boolean
  layerBorders: boolean
  fpsCounter: boolean
  scrollBottlenecks: boolean
}

export interface BrowserEmulationState {
  network: BrowserNetworkEmulation
  cacheDisabled: boolean
  bypassServiceWorker: boolean
  dataSaver: BrowserDataSaverEmulation
  cpuThrottlingRate: number
  animationPlaybackRate: BrowserAnimationPlaybackRate
  colorScheme: BrowserColorSchemeEmulation
  reducedMotion: BrowserReducedMotionEmulation
  mediaType: BrowserMediaTypeEmulation
  forcedColors: BrowserForcedColorsEmulation
  contrast: BrowserContrastEmulation
  reducedTransparency: BrowserReducedTransparencyEmulation
  visionDeficiency: BrowserVisionDeficiencyEmulation
  userAgent?: string
  locale?: string
  timezoneId?: string
  javaScriptDisabled?: boolean
  viewport?: BrowserViewportEmulation
  geolocation?: BrowserGeolocationEmulation
  /** Present while an override is active; omitted fields resolve to 0px. */
  safeAreaInsets?: BrowserSafeAreaInsets
  /** Emulated OS text-scale factor; absent means the browser's own preference. */
  osTextScale?: number
  /** CSS pixels by which the large viewport (lvh) exceeds the visible small viewport (svh). */
  smallViewportHeightDifference?: number
  extraHttpHeaderNames?: string[]
  renderingDebug?: BrowserRenderingDebugOverlays
}

/** Retained settings are not a claim about the current native browser. */
export interface BrowserUnconfirmedEmulation {
  application: 'pending' | 'unknown'
  retainedSettings: BrowserEmulationState
  recovery: 'restore-committed'
}

export type BrowserEmulationResult = BrowserEmulationState | BrowserUnconfirmedEmulation

export interface BrowserEmulationOptions {
  recover?: boolean
  tabId?: string
  reset?: boolean
  network?: BrowserNetworkEmulation
  cacheDisabled?: boolean
  bypassServiceWorker?: boolean
  dataSaver?: BrowserDataSaverEmulation
  cpuThrottlingRate?: number
  animationPlaybackRate?: BrowserAnimationPlaybackRate
  colorScheme?: BrowserColorSchemeEmulation
  reducedMotion?: BrowserReducedMotionEmulation
  mediaType?: BrowserMediaTypeEmulation
  forcedColors?: BrowserForcedColorsEmulation
  contrast?: BrowserContrastEmulation
  reducedTransparency?: BrowserReducedTransparencyEmulation
  visionDeficiency?: BrowserVisionDeficiencyEmulation
  userAgent?: string
  locale?: string
  timezoneId?: string
  javaScriptDisabled?: boolean
  viewport?: BrowserViewportEmulation | null
  viewportPreset?: BrowserViewportPresetId
  viewportOrientation?: BrowserViewportOrientation
  geolocation?: BrowserGeolocationEmulation | null
  /** Replaces the whole override; null restores the browser's own values. */
  safeAreaInsets?: BrowserSafeAreaInsets | null
  /** 0.85–2; null restores the browser's own text-scale preference. */
  osTextScale?: number | null
  /** Integer 0–1000 CSS pixels; null restores the browser's own small viewport. */
  smallViewportHeightDifference?: number | null
  extraHttpHeaders?: Record<string, string>
  renderingDebug?: Partial<BrowserRenderingDebugOverlays> | null
}

export interface BrowserEnvironmentSettings {
  network: BrowserNetworkEmulation
  cacheDisabled: boolean
  bypassServiceWorker: boolean
  dataSaver: BrowserDataSaverEmulation
  cpuThrottlingRate: number
  animationPlaybackRate: BrowserAnimationPlaybackRate
  colorScheme: BrowserColorSchemeEmulation
  reducedMotion: BrowserReducedMotionEmulation
  mediaType: BrowserMediaTypeEmulation
  forcedColors: BrowserForcedColorsEmulation
  contrast: BrowserContrastEmulation
  reducedTransparency: BrowserReducedTransparencyEmulation
  visionDeficiency: BrowserVisionDeficiencyEmulation
  userAgent: string
  locale: string
  timezoneId: string
  javaScriptDisabled: boolean
  geolocation: BrowserGeolocationEmulation | null
  renderingDebug: BrowserRenderingDebugOverlays
}
