import type {
  BrowserViewportEmulation,
  BrowserViewportOrientation,
  BrowserViewportPresetId
} from './types.js'

export interface BrowserViewportPreset {
  id: BrowserViewportPresetId
  label: string
  description: string
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
  touch: boolean
}

export const BROWSER_VIEWPORT_PRESETS: readonly BrowserViewportPreset[] = [
  {
    id: 'compact-phone',
    label: 'Compact phone',
    description: 'Narrow mobile layouts',
    width: 360,
    height: 800,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true
  },
  {
    id: 'phone',
    label: 'Phone',
    description: 'Typical mobile layouts',
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true
  },
  {
    id: 'large-phone',
    label: 'Large phone',
    description: 'Wide mobile layouts',
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true
  },
  {
    id: 'tablet',
    label: 'Tablet',
    description: 'Touch-first tablet layouts',
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true
  },
  {
    id: 'laptop',
    label: 'Laptop',
    description: 'Compact desktop layouts',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false
  },
  {
    id: 'desktop',
    label: 'Desktop',
    description: 'Wide desktop layouts',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false
  }
] as const

export const BROWSER_VIEWPORT_PRESET_IDS = BROWSER_VIEWPORT_PRESETS.map((preset) => preset.id) as [
  BrowserViewportPresetId,
  ...BrowserViewportPresetId[]
]

export function viewportPresetById(id: BrowserViewportPresetId): BrowserViewportPreset {
  const preset = BROWSER_VIEWPORT_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown viewport preset: ${id}`)
  return preset
}

export function resolveViewportPreset(
  id: BrowserViewportPresetId,
  orientation: BrowserViewportOrientation = 'portrait'
): BrowserViewportEmulation {
  const preset = viewportPresetById(id)
  const landscape = orientation === 'landscape'
  return {
    width: landscape ? preset.height : preset.width,
    height: landscape ? preset.width : preset.height,
    deviceScaleFactor: preset.deviceScaleFactor,
    mobile: preset.mobile,
    touch: preset.touch,
    orientation
  }
}

export function matchingViewportPreset(viewport: BrowserViewportEmulation): BrowserViewportPreset | undefined {
  return BROWSER_VIEWPORT_PRESETS.find((preset) => {
    const resolved = resolveViewportPreset(preset.id, viewport.orientation)
    return resolved.width === viewport.width
      && resolved.height === viewport.height
      && resolved.deviceScaleFactor === viewport.deviceScaleFactor
      && resolved.mobile === viewport.mobile
      && resolved.touch === viewport.touch
  })
}

export function isBrowserViewportEmulation(value: unknown): value is BrowserViewportEmulation {
  if (!value || typeof value !== 'object') return false
  const viewport = value as Record<string, unknown>
  return Number.isInteger(viewport.width)
    && Number(viewport.width) >= 200
    && Number(viewport.width) <= 3840
    && Number.isInteger(viewport.height)
    && Number(viewport.height) >= 200
    && Number(viewport.height) <= 3840
    && typeof viewport.deviceScaleFactor === 'number'
    && Number.isFinite(viewport.deviceScaleFactor)
    && viewport.deviceScaleFactor >= 0.5
    && viewport.deviceScaleFactor <= 5
    && typeof viewport.mobile === 'boolean'
    && typeof viewport.touch === 'boolean'
    && (viewport.orientation === 'portrait' || viewport.orientation === 'landscape')
}
