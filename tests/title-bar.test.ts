import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INTERFACE_SCALE_OPTIONS } from '../src/shared/interface-scale.js'
import { RESOLVED_THEME_NAMES } from '../src/shared/theme.js'
import {
  TITLE_BAR_BASE_HEIGHT,
  createAutoHideMenuGesture,
  dimTitleBarOverlay,
  isAutoHideMenuToggleInput,
  mainWindowChromeOptions,
  normalizeTitleBarArea,
  parseScrimColor,
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
          color: '#202023',
          symbolColor: '#ededf0',
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
    const gesture = createAutoHideMenuGesture('darwin')
    expect(gesture({ type: 'keyDown', key: 'Alt' })).toBeUndefined()
    expect(gesture({ type: 'keyUp', key: 'Alt' })).toBeUndefined()
  })

  it.each(['linux', 'win32'] as const)('shows the menu when bare Alt is released on %s and lets the press reach the window', (platform) => {
    const gesture = createAutoHideMenuGesture(platform)
    // Chromium drops the release of a press held back in before-input-event, so the press must go through.
    expect(gesture({ type: 'rawKeyDown', key: 'Alt', code: 'AltLeft' })).toBeUndefined()
    expect(gesture({ type: 'keyUp', key: 'Alt', code: 'AltLeft' })).toBe('toggle')
    // Held down, the press repeats and the release still shows the menu.
    expect(gesture({ type: 'keyDown', key: 'Alt' })).toBeUndefined()
    expect(gesture({ type: 'keyDown', key: 'Alt', isAutoRepeat: true })).toBeUndefined()
    expect(gesture({ type: 'keyUp', key: 'Alt' })).toBe('toggle')
  })

  it.each(['linux', 'win32'] as const)('keeps Alt with another key from the menu on %s and holds every Alt release back', (platform) => {
    const gesture = createAutoHideMenuGesture(platform)
    expect(gesture({ type: 'keyDown', key: 'Alt' })).toBeUndefined()
    expect(gesture({ type: 'keyDown', key: '1', code: 'Digit1' })).toBeUndefined()
    // Released before the digit, too: the native menu never sees this release, so it opens nothing either.
    expect(gesture({ type: 'keyUp', key: 'Alt' })).toBe('suppress')
    expect(gesture({ type: 'keyUp', key: '1', code: 'Digit1' })).toBeUndefined()
    expect(gesture({ type: 'keyDown', key: 'Alt', control: true })).toBeUndefined()
    expect(gesture({ type: 'keyUp', key: 'Alt' })).toBe('suppress')
    // A release without its press shows nothing.
    expect(gesture({ type: 'keyUp', key: 'Alt' })).toBe('suppress')
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

  it('paints the window controls in the surface they sit on, beside the rail as with tabs above the page', () => {
    const tokens = readFileSync(new URL('../src/renderer/src/styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    const themeColor = (theme: string, name: string): string | undefined => {
      for (const [, selector, body] of tokens.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        if (!selector!.split(',').map((entry) => entry.trim()).includes(`:root[data-theme="${theme}"]`)) continue
        const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'u').exec(body!)?.[1]
        if (value) return value
      }
      return undefined
    }
    for (const theme of RESOLVED_THEME_NAMES) {
      expect(titleBarOverlayStyle(theme, 'top', 1).color, theme).toBe(themeColor(theme, '--shell-top'))
      // The toolbar beside the rail shares the rail's surface around the page card.
      expect(titleBarOverlayStyle(theme, 'left', 1).color, theme).toBe(themeColor(theme, '--shell-bottom'))
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

describe('window controls under a dialog backdrop', () => {
  it('accepts only a bounded translucent rgb color as the backdrop', () => {
    expect(parseScrimColor('rgba(4, 7, 12, 0.48)')).toEqual({ red: 4, green: 7, blue: 12, alpha: 0.48 })
    expect(parseScrimColor('rgb(4 7 12 / .5)')).toEqual({ red: 4, green: 7, blue: 12, alpha: 0.5 })
    for (const value of [
      'rgb(4, 7, 12)',
      'rgba(4, 7, 12, 0)',
      'rgba(4, 7, 12, 1)',
      'rgba(256, 7, 12, 0.5)',
      '#04070c80',
      'url(javascript:alert(1))',
      `rgba(4, 7, 12, 0.${'5'.repeat(80)})`,
      null,
      42
    ]) expect(parseScrimColor(value), String(value)).toBeNull()
  })

  it.each(RESOLVED_THEME_NAMES)('lays the backdrop over the %s window controls and restores them without one', (theme) => {
    const style = titleBarOverlayStyle(theme, 'top', 1)
    const scrim = { red: 0, green: 0, blue: 0, alpha: 0.5 }
    const dimmed = dimTitleBarOverlay(style, scrim)
    const half = (color: string) => `#${[1, 3, 5].map((index) => Math.round(Number.parseInt(color.slice(index, index + 2), 16) / 2).toString(16).padStart(2, '0')).join('')}`
    expect(dimmed).toEqual({ ...style, color: half(style.color), symbolColor: half(style.symbolColor) })
    expect(dimTitleBarOverlay(style, null)).toEqual(style)
  })

  it('blends exactly as the backdrop composites over an opaque color', () => {
    const style = { color: '#ffffff', symbolColor: '#000000', height: 44 }
    expect(dimTitleBarOverlay(style, { red: 4, green: 7, blue: 12, alpha: 0.48 })).toEqual({
      color: '#87888a',
      symbolColor: '#020306',
      height: 44
    })
  })
})
