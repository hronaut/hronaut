import { describe, expect, it } from 'vitest'
import {
  MICA_MINIMUM_WINDOWS_BUILD,
  WINDOW_MATERIAL_BACKGROUND,
  windowMaterialFor,
  windowMaterialOptions,
  type WindowMaterialInput
} from '../src/shared/window-material.js'

const mac: WindowMaterialInput = {
  platform: 'darwin',
  osRelease: '24.6.0',
  theme: 'light',
  tabPosition: 'left',
  chrome: 'overlay',
  reducedTransparency: false,
  forcedColors: false
}
const windows11: WindowMaterialInput = { ...mac, platform: 'win32', osRelease: `10.0.${MICA_MINIMUM_WINDOWS_BUILD}` }

describe('window material', () => {
  it('shows vibrancy on macOS and Mica on Windows 11 22H2 and later behind the rail, in the light and dark themes', () => {
    expect(windowMaterialFor(mac)).toBe('vibrancy')
    expect(windowMaterialFor({ ...mac, theme: 'dark' })).toBe('vibrancy')
    expect(windowMaterialFor(windows11)).toBe('mica')
    expect(windowMaterialFor({ ...windows11, osRelease: '10.0.26100', theme: 'dark' })).toBe('mica')
  })

  it('keeps the solid surface on Linux, older Windows, other themes, tabs above the page, and when the system asks for it', () => {
    expect(windowMaterialFor({ ...mac, platform: 'linux', osRelease: '6.8.0' })).toBeNull()
    // Windows 10 and the first Windows 11 release draw no backdrop behind the content.
    for (const osRelease of ['10.0.19045', '10.0.22000', '10.0.22620', '6.3.9600', '', 'unknown']) {
      expect(windowMaterialFor({ ...windows11, osRelease }), osRelease).toBeNull()
    }
    for (const theme of ['midnight', 'sepia', 'cyberpunk', 'cyberpunk-turbo', 'matrix', 'machine', 'galactic'] as const) {
      expect(windowMaterialFor({ ...mac, theme }), theme).toBeNull()
      expect(windowMaterialFor({ ...windows11, theme }), theme).toBeNull()
    }
    expect(windowMaterialFor({ ...mac, tabPosition: 'top' })).toBeNull()
    expect(windowMaterialFor({ ...mac, reducedTransparency: true })).toBeNull()
    expect(windowMaterialFor({ ...windows11, reducedTransparency: true })).toBeNull()
    expect(windowMaterialFor({ ...windows11, forcedColors: true })).toBeNull()
  })

  it('keeps the solid surface on Windows with the system title bar, where a clear background would be black', () => {
    expect(windowMaterialFor({ ...windows11, chrome: 'system' })).toBeNull()
    // macOS draws vibrancy under the content with either title bar.
    expect(windowMaterialFor({ ...mac, chrome: 'system' })).toBe('vibrancy')
  })

  it('creates the window with its material and a clear background, and with neither without one', () => {
    expect(windowMaterialOptions('vibrancy')).toEqual({ vibrancy: 'sidebar', backgroundColor: WINDOW_MATERIAL_BACKGROUND })
    expect(windowMaterialOptions('mica')).toEqual({ backgroundMaterial: 'mica', backgroundColor: WINDOW_MATERIAL_BACKGROUND })
    expect(windowMaterialOptions(null)).toEqual({})
    expect(WINDOW_MATERIAL_BACKGROUND).toBe('#00000000')
  })
})
