import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings } from '../../src/shared/types.js'

const foley = vi.hoisted(() => ({ play: vi.fn(), set: vi.fn() }))
vi.mock('@foleyjs/core', () => foley)

import { useAppearancePresentationController } from '../../src/renderer/src/composables/useAppearancePresentationController.js'

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
})

afterEach(() => {
  foley.play.mockReset()
  foley.set.mockReset()
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-preference')
  document.documentElement.style.colorScheme = ''
})

describe('useAppearancePresentationController', () => {
  it('resolves persisted tab position without reserving a rail in detached panels', () => {
    const settings = ref({ ...DEFAULT_RENDERER_SETTINGS, tabPosition: 'left' as const })
    const systemTheme = ref<'light' | 'dark'>('light')
    const mainScope = effectScope()
    const main = mainScope.run(() => useAppearancePresentationController({ settings, systemTheme, detachedWindow: false }))!
    const detachedScope = effectScope()
    const detached = detachedScope.run(() => useAppearancePresentationController({ settings, systemTheme, detachedWindow: true }))!

    expect(main.tabOrientation.value).toBe('vertical')
    expect(main.tabRailWidth.value).toBe(280)
    expect(detached.tabOrientation.value).toBe('horizontal')
    expect(detached.tabRailWidth.value).toBe(0)
    mainScope.stop()
    detachedScope.stop()
  })

  it('collapses a pinned vertical rail at narrow widths so the complete toolbar still fits', () => {
    const settings = ref({ ...DEFAULT_RENDERER_SETTINGS, tabPosition: 'left' as const })
    const systemTheme = ref<'light' | 'dark'>('light')
    const scope = effectScope()
    const controller = scope.run(() => useAppearancePresentationController({ settings, systemTheme, detachedWindow: false }))!

    controller.updateViewportWidth(760)
    expect(controller.compactVerticalTabRail.value).toBe(true)
    expect(controller.verticalTabRailCollapsed.value).toBe(true)
    expect(controller.tabRailWidth.value).toBe(56)

    controller.setVerticalTabRailRevealed(true)
    expect(controller.verticalTabRailCollapsed.value).toBe(false)
    expect(controller.tabRailWidth.value).toBe(56)
    controller.setVerticalTabRailRevealed(false)

    controller.updateViewportWidth(1_000)
    expect(controller.compactVerticalTabRail.value).toBe(false)
    expect(controller.verticalTabRailCollapsed.value).toBe(false)
    expect(controller.tabRailWidth.value).toBe(280)
    scope.stop()
  })

  it('persists an unpinned vertical rail and temporarily expands it for interaction', () => {
    window.localStorage.setItem('hronaut:vertical-tab-rail-pinned', 'false')
    const settings = ref({ ...DEFAULT_RENDERER_SETTINGS, tabPosition: 'left' as const })
    const systemTheme = ref<'light' | 'dark'>('light')
    const scope = effectScope()
    const controller = scope.run(() => useAppearancePresentationController({ settings, systemTheme, detachedWindow: false }))!

    expect(controller.verticalTabRailPinned.value).toBe(false)
    expect(controller.tabRailWidth.value).toBe(56)

    controller.setVerticalTabRailRevealed(true)
    expect(controller.tabRailWidth.value).toBe(280)
    controller.setVerticalTabRailRevealed(false)
    expect(controller.tabRailWidth.value).toBe(56)

    const rail = document.createElement('div')
    const firstControl = document.createElement('button')
    const secondControl = document.createElement('button')
    const outsideControl = document.createElement('button')
    rail.append(firstControl, secondControl)
    document.body.append(rail, outsideControl)
    rail.addEventListener('focusout', controller.handleVerticalTabRailFocusOut)
    rail.addEventListener('mouseleave', controller.concealVerticalTabRail)
    const documentFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    controller.revealVerticalTabRail()
    firstControl.focus()
    secondControl.focus()
    rail.dispatchEvent(new MouseEvent('mouseleave'))
    expect(controller.tabRailWidth.value).toBe(280)
    outsideControl.focus()
    expect(controller.tabRailWidth.value).toBe(56)
    controller.revealVerticalTabRail()
    window.dispatchEvent(new Event('blur'))
    expect(controller.tabRailWidth.value).toBe(56)
    documentFocus.mockRestore()
    rail.remove()
    outsideControl.remove()

    controller.toggleVerticalTabRailPinned()
    expect(controller.verticalTabRailPinned.value).toBe(true)
    expect(controller.tabRailWidth.value).toBe(280)
    expect(window.localStorage.getItem('hronaut:vertical-tab-rail-pinned')).toBe('true')
    scope.stop()
  })

  it('finishes a pending collapse immediately when a native page takes window focus', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const settings = ref({ ...DEFAULT_RENDERER_SETTINGS, tabPosition: 'left' as const })
    const systemTheme = ref<'light' | 'dark'>('light')
    const scope = effectScope()
    try {
      const controller = scope.run(() => useAppearancePresentationController({ settings, systemTheme, detachedWindow: false }))!
      controller.updateViewportWidth(1200)
      controller.revealVerticalTabRail()
      controller.toggleVerticalTabRailPinned()
      controller.concealVerticalTabRail()
      expect(controller.verticalTabRailCollapsing.value).toBe(true)
      window.dispatchEvent(new Event('blur'))
      expect(controller.verticalTabRailCollapsing.value).toBe(false)
      expect(controller.tabRailWidth.value).toBe(56)
    } finally { scope.stop(); vi.unstubAllGlobals() }
  })

  it('applies system theme and plays the selected attention cue', () => {
    const settings = ref({ ...DEFAULT_RENDERER_SETTINGS, attentionSoundCue: 'chime' as const })
    const systemTheme = ref<'light' | 'dark'>('dark')
    const scope = effectScope()
    const controller = scope.run(() => useAppearancePresentationController({ settings, systemTheme, detachedWindow: false }))!

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themePreference).toBe('system')
    expect(foley.set).toHaveBeenCalledWith({ muted: false })
    controller.playAttentionSound()
    expect(foley.play).toHaveBeenCalledWith('chime', { volume: 0.65 })
    scope.stop()
  })

  it('uses a light color scheme for sepia and a dark scheme for cinematic themes', async () => {
    const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS, theme: 'sepia' })
    const systemTheme = ref<'light' | 'dark'>('dark')
    const scope = effectScope()
    scope.run(() => useAppearancePresentationController({ settings, systemTheme, detachedWindow: false }))

    expect(document.documentElement.dataset.theme).toBe('sepia')
    expect(document.documentElement.style.colorScheme).toBe('light')

    settings.value = { ...settings.value, theme: 'matrix' }
    await nextTick()
    expect(document.documentElement.dataset.theme).toBe('matrix')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    scope.stop()
  })
})
