import { describe, expect, it, vi } from 'vitest'
import { useSettingsSectionResetController } from '../../src/renderer/src/composables/useSettingsSectionResetController.js'

function createHarness() {
  const calls: string[] = []
  const asyncSetting = (name: string) => vi.fn(async (value: unknown) => { calls.push(`${name}:${String(value)}`) })
  const callbacks = {
    setTheme: asyncSetting('theme'),
    setInterfaceScale: asyncSetting('scale'),
    setTabPosition: asyncSetting('tabs'),
    setHideInTray: asyncSetting('tray'),
    setAttentionSound: asyncSetting('sound'),
    setAttentionSoundCue: asyncSetting('cue'),
    setLanguagePreference: asyncSetting('language'),
    resetSearch: vi.fn(() => true),
    resetDownloads: vi.fn(async () => true),
    resetPerformance: vi.fn(async () => true),
    resetPrivacySelection: vi.fn(),
    clearSitePermissions: vi.fn(async () => true),
    resetMcp: vi.fn(async () => true),
    resetUpdates: vi.fn(async () => true)
  }
  return {
    calls,
    callbacks,
    controller: useSettingsSectionResetController(callbacks)
  }
}

describe('settings section reset controller', () => {
  it('resets every Appearance preference and changes language only after the other defaults', async () => {
    const harness = createHarness()

    await expect(harness.controller.reset('appearance')).resolves.toBe(true)

    expect(harness.calls).toEqual([
      'theme:system',
      'scale:1',
      'tabs:top',
      'tray:true',
      'sound:true',
      'cue:warning',
      'language:system'
    ])
    expect(harness.callbacks.setLanguagePreference).toHaveBeenCalledWith('system')
  })

  it.each([
    ['search', 'resetSearch'],
    ['downloads', 'resetDownloads'],
    ['performance', 'resetPerformance'],
    ['privacy', 'resetPrivacySelection'],
    ['permissions', 'clearSitePermissions'],
    ['mcp', 'resetMcp'],
    ['updates', 'resetUpdates']
  ] as const)('routes the %s reset to %s', async (section, callback) => {
    const harness = createHarness()

    await harness.controller.reset(section)

    expect(harness.callbacks[callback]).toHaveBeenCalledOnce()
  })

  it.each(['credentials', 'support'] as const)('rejects a reset for the non-resettable %s section', (section) => {
    const harness = createHarness()

    expect(harness.controller.reset(section)).toBe(false)
    expect(harness.calls).toEqual([])
  })
})
