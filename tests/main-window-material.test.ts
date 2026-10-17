import { describe, expect, it, vi } from 'vitest'
import { applyWindowMaterial, type MaterialWindow } from '../src/main/window-material.js'
import { WINDOW_MATERIAL_BACKGROUND } from '../src/shared/window-material.js'

function fakeWindow(destroyed = false) {
  const calls: unknown[][] = []
  const window: MaterialWindow = {
    isDestroyed: () => destroyed,
    setVibrancy: vi.fn((type) => { calls.push(['vibrancy', type]) }),
    setBackgroundMaterial: vi.fn((material) => { calls.push(['material', material]) }),
    setBackgroundColor: vi.fn((color) => { calls.push(['background', color]) })
  } as unknown as MaterialWindow
  return { window, calls }
}

describe('applying the main window material', () => {
  it('turns macOS vibrancy on and off only when it changes, with a clear background while it shows', () => {
    const { window, calls } = fakeWindow()
    expect(applyWindowMaterial(window, 'darwin', null, 'vibrancy', '#f5f5f6')).toBe('vibrancy')
    expect(applyWindowMaterial(window, 'darwin', 'vibrancy', 'vibrancy', '#f5f5f6')).toBe('vibrancy')
    expect(applyWindowMaterial(window, 'darwin', 'vibrancy', null, '#17181c')).toBeNull()
    expect(calls).toEqual([
      ['vibrancy', 'sidebar'], ['background', WINDOW_MATERIAL_BACKGROUND],
      ['background', WINDOW_MATERIAL_BACKGROUND],
      ['vibrancy', null], ['background', '#17181c']
    ])
  })

  it('removes Windows Mica before setting the theme\'s surface, which removing it resets', () => {
    const { window, calls } = fakeWindow()
    applyWindowMaterial(window, 'win32', null, 'mica', '#f5f5f6')
    applyWindowMaterial(window, 'win32', 'mica', null, '#f5f5f6')
    expect(calls).toEqual([
      ['material', 'mica'], ['background', WINDOW_MATERIAL_BACKGROUND],
      ['material', 'none'], ['background', '#f5f5f6']
    ])
  })

  it('only follows the theme on Linux, and returns the material for a window not created yet', () => {
    const { window, calls } = fakeWindow()
    expect(applyWindowMaterial(window, 'linux', null, null, '#f5f5f6')).toBeNull()
    expect(calls).toEqual([['background', '#f5f5f6']])
    const destroyed = fakeWindow(true)
    expect(applyWindowMaterial(destroyed.window, 'darwin', null, 'vibrancy', '#f5f5f6')).toBe('vibrancy')
    expect(destroyed.calls).toEqual([])
    expect(applyWindowMaterial(undefined, 'win32', null, 'mica', '#f5f5f6')).toBe('mica')
  })
})
