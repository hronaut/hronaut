import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'

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
    controller.revealVerticalTabRail()
    firstControl.focus()
    secondControl.focus()
    expect(controller.tabRailWidth.value).toBe(280)
    outsideControl.focus()
    expect(controller.tabRailWidth.value).toBe(56)
    rail.remove()
    outsideControl.remove()

    controller.toggleVerticalTabRailPinned()
    expect(controller.verticalTabRailPinned.value).toBe(true)
    expect(controller.tabRailWidth.value).toBe(280)
    expect(window.localStorage.getItem('hronaut:vertical-tab-rail-pinned')).toBe('true')
    scope.stop()
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
})
