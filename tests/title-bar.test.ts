import { describe, expect, it } from 'vitest'
import { INTERFACE_SCALE_OPTIONS } from '../src/shared/interface-scale.js'
import { RESOLVED_THEME_NAMES } from '../src/shared/theme.js'
import {
  TITLE_BAR_BASE_HEIGHT,
  isAutoHideMenuToggleInput,
  mainWindowChromeOptions,
  normalizeTitleBarArea,
  titleBarOverlayStyle
} from '../src/shared/title-bar.js'

function relativeLuminance(color: string): number {
  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)]
    .map((channel) => Number.parseInt(channel, 16) / 255)
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )) as [number, number, number]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

describe('hybrid title bar configuration', () => {
  it.each(['linux', 'win32'] as const)(
    'keeps native controls and an Alt-accessible menu on %s without becoming frameless',
    (platform) => {
      const options = mainWindowChromeOptions({
        platform,
        useSystemTitleBar: false,
        theme: 'dark',
        tabPosition: 'top',
        interfaceScale: 1
      })

      expect(options).toMatchObject({
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        titleBarOverlay: {
          color: '#20212c',
          symbolColor: '#eeeef5',
          height: TITLE_BAR_BASE_HEIGHT
        }
      })
      expect(options).not.toHaveProperty('frame')
    }
  )

  it.each(['linux', 'win32'] as const)('keeps the auto-hidden menu reachable with bare Alt on %s', (platform) => {
    expect(isAutoHideMenuToggleInput(platform, { type: 'keyDown', key: 'Alt' })).toBe(true)
    expect(isAutoHideMenuToggleInput(platform, { type: 'rawKeyDown', key: '', code: 'AltLeft' })).toBe(true)
    expect(isAutoHideMenuToggleInput(platform, { type: 'keyUp', key: 'Alt' })).toBe(false)
    expect(isAutoHideMenuToggleInput(platform, { type: 'keyDown', key: 'Alt', control: true })).toBe(false)
  })

  it('leaves bare Alt to the native macOS menu bar', () => {
    expect(isAutoHideMenuToggleInput('darwin', { type: 'keyDown', key: 'Alt' })).toBe(false)
  })

  it('retains macOS traffic lights and enables the overlay safe-area APIs', () => {
    expect(mainWindowChromeOptions({
      platform: 'darwin',
      useSystemTitleBar: false,
      theme: 'light',
      tabPosition: 'top',
      interfaceScale: 1
    })).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { height: TITLE_BAR_BASE_HEIGHT }
    })
  })

  it.each(['linux', 'win32', 'darwin'] as const)(
    'offers a real system-title-bar fallback on %s without disabling native frames',
    (platform) => {
      const options = mainWindowChromeOptions({
        platform,
        useSystemTitleBar: true,
        theme: 'matrix',
        tabPosition: 'left',
        interfaceScale: 1.25
      })

      expect(options.titleBarStyle).toBeUndefined()
      expect(options.titleBarOverlay).toBeUndefined()
      expect(options).not.toHaveProperty('frame')
      expect(options.autoHideMenuBar).toBe(platform === 'darwin' ? undefined : true)
    }
  )

  it('defines an accessible overlay palette for every theme and both tab layouts', () => {
    for (const theme of RESOLVED_THEME_NAMES) {
      const horizontal = titleBarOverlayStyle(theme, 'top', 1)
      const vertical = titleBarOverlayStyle(theme, 'left', 1)
      expect(horizontal.color).toMatch(/^#[\da-f]{6}$/i)
      expect(horizontal.symbolColor).toMatch(/^#[\da-f]{6}$/i)
      expect(vertical.color).toMatch(/^#[\da-f]{6}$/i)
      expect(vertical.symbolColor).toBe(horizontal.symbolColor)
      expect(contrastRatio(horizontal.color, horizontal.symbolColor)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(vertical.color, vertical.symbolColor)).toBeGreaterThanOrEqual(3)
      expect(horizontal.height).toBe(TITLE_BAR_BASE_HEIGHT)
      expect(vertical.height).toBe(TITLE_BAR_BASE_HEIGHT)
    }
  })

  it('keeps the native overlay aligned with every supported interface scale', () => {
    for (const { value } of INTERFACE_SCALE_OPTIONS) {
      expect(titleBarOverlayStyle('galactic', 'top', value).height)
        .toBe(Math.round(TITLE_BAR_BASE_HEIGHT * value))
    }
  })

  it.each([1, 1.25, 1.5])(
    'normalizes left and right native-control safe areas at %sx display scaling',
    (displayScale) => {
      const viewportWidth = 1_200 / displayScale
      const controlWidth = 144 / displayScale
      expect(normalizeTitleBarArea({
        x: controlWidth,
        y: 0,
        width: viewportWidth - controlWidth,
        height: TITLE_BAR_BASE_HEIGHT
      }, viewportWidth)).toMatchObject({ leftInset: controlWidth, rightInset: 0 })
      const rightControls = normalizeTitleBarArea({
        x: 0,
        y: 0,
        width: viewportWidth - controlWidth,
        height: TITLE_BAR_BASE_HEIGHT
      }, viewportWidth)
      expect(rightControls.leftInset).toBe(0)
      expect(rightControls.rightInset).toBeCloseTo(controlWidth)
    }
  )

  it('clamps malformed overlay geometry before it reaches CSS', () => {
    expect(normalizeTitleBarArea({ x: -20, y: 0, width: 2_000, height: -5 }, 760)).toEqual({
      x: 0,
      width: 760,
      height: TITLE_BAR_BASE_HEIGHT,
      leftInset: 0,
      rightInset: 0
    })
  })
})
