import { describe, expect, it, vi } from 'vitest'
import { useSettingsSectionResetController } from '../../src/renderer/src/composables/useSettingsSectionResetController.js'

function createHarness() {
  const callbacks = {
    resetAppearance: vi.fn(async () => true),
    resetSearch: vi.fn(() => true),
    resetDownloads: vi.fn(async () => true),
    resetPerformance: vi.fn(async () => true),
    resetPrivacySelection: vi.fn(),
    clearSitePermissions: vi.fn(async () => true),
    resetMcp: vi.fn(async () => true),
    resetUpdates: vi.fn(async () => true)
  }
  return {
    callbacks,
    controller: useSettingsSectionResetController(callbacks)
  }
}

describe('settings section reset controller', () => {
  it('routes Appearance through one authoritative reset transaction', async () => {
    const harness = createHarness()

    await expect(harness.controller.reset('appearance')).resolves.toBe(true)

    expect(harness.callbacks.resetAppearance).toHaveBeenCalledOnce()
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
    expect(harness.callbacks.resetAppearance).not.toHaveBeenCalled()
  })
})
