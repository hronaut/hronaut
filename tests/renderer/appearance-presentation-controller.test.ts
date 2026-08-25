import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'

const foley = vi.hoisted(() => ({ play: vi.fn(), set: vi.fn() }))
vi.mock('@foleyjs/core', () => foley)

import { useAppearancePresentationController } from '../../src/renderer/src/composables/useAppearancePresentationController.js'

afterEach(() => {
  foley.play.mockReset()
  foley.set.mockReset()
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
