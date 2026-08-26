import { describe, expect, it, vi } from 'vitest'
import { useSettingsNavigationController } from '../../src/renderer/src/composables/useSettingsNavigationController.js'

function createController(overrides: { defaultProfile?: boolean; blocked?: boolean; origin?: string | null } = {}) {
  const closeSiteControls = vi.fn()
  const openSiteStorage = vi.fn(async () => undefined)
  const openPrivacySettings = vi.fn(async () => undefined)
  const openSettingsSection = vi.fn()
  const closeHelp = vi.fn()
  const closeTransientCollections = vi.fn()
  const controller = useSettingsNavigationController({
    closeSiteControls,
    usesDefaultProfile: () => overrides.defaultProfile ?? true,
    activeOrigin: () => overrides.origin ?? 'https://example.test',
    openSiteStorage,
    openPrivacySettings,
    openSettingsSection,
    settingsEntryBlocked: () => overrides.blocked ?? false,
    closeHelp,
    closeTransientCollections
  })
  return {
    controller,
    closeSiteControls,
    openSiteStorage,
    openPrivacySettings,
    openSettingsSection,
    closeHelp,
    closeTransientCollections
  }
}

describe('useSettingsNavigationController', () => {
  it('opens origin-filtered privacy settings for the default profile', async () => {
    const harness = createController()

    await harness.controller.openSitePrivacySettings()

    expect(harness.closeSiteControls).toHaveBeenCalledOnce()
    expect(harness.openPrivacySettings).toHaveBeenCalledWith('https://example.test')
    expect(harness.openSiteStorage).not.toHaveBeenCalled()
  })

  it('opens isolated site storage instead of global privacy settings', async () => {
    const harness = createController({ defaultProfile: false })

    await harness.controller.openSitePrivacySettings()

    expect(harness.closeSiteControls).toHaveBeenCalledOnce()
    expect(harness.openSiteStorage).toHaveBeenCalledOnce()
    expect(harness.openPrivacySettings).not.toHaveBeenCalled()
  })

  it('opens site permissions after closing site controls', () => {
    const harness = createController()

    harness.controller.openSitePermissionSettings()

    expect(harness.closeSiteControls).toHaveBeenCalledOnce()
    expect(harness.openSettingsSection).toHaveBeenCalledWith('permissions')
  })

  it('closes competing overlays before opening update settings', () => {
    const harness = createController()

    harness.controller.openUpdateSettings()

    expect(harness.closeHelp).toHaveBeenCalledOnce()
    expect(harness.closeTransientCollections).toHaveBeenCalledOnce()
    expect(harness.openSettingsSection).toHaveBeenCalledWith('updates')
  })

  it('does not disturb a blocking editor when update settings are requested', () => {
    const harness = createController({ blocked: true })

    harness.controller.openUpdateSettings()

    expect(harness.closeHelp).not.toHaveBeenCalled()
    expect(harness.closeTransientCollections).not.toHaveBeenCalled()
    expect(harness.openSettingsSection).not.toHaveBeenCalled()
  })
})
