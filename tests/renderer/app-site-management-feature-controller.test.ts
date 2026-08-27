import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { BrowsingDataSiteSummary } from '../../src/shared/types.js'
import { useAppSiteManagementFeatureController } from '../../src/renderer/src/composables/useAppSiteManagementFeatureController.js'
import { useSiteDataSummaryController } from '../../src/renderer/src/composables/useSiteDataSummaryController.js'
import type { SettingsSection } from '../../src/renderer/src/composables/useSettingsDialogController.js'

function createHarness() {
  const activeContext = ref({ tabId: 'tab-1', url: 'https://example.test/path' })
  const siteSummary: BrowsingDataSiteSummary = {
    origin: 'https://example.test',
    cookieCount: 2,
    historyEntries: 3,
    historyVisits: 5
  }
  const loadSiteSummary = vi.fn(async () => siteSummary)
  const siteDataController = useSiteDataSummaryController({
    current: () => activeContext.value,
    load: loadSiteSummary
  })
  const siteControlsOpen = ref(false)
  const siteStorageOpen = ref(false)
  const resetSiteStorage = vi.fn()
  const refreshSiteStorage = vi.fn(async () => undefined)
  const siteStoragePanel = ref({
    reset: resetSiteStorage,
    refresh: refreshSiteStorage
  })
  const settingsOpen = ref(false)
  const settingsSection = ref<SettingsSection>('appearance')
  const updateNoticeOpen = ref(false)
  const downloadsOpen = ref(false)
  const bookmarksOpen = ref(false)
  const historyOpen = ref(false)
  const tabSearchOpen = ref(false)
  const zoomOpen = ref(false)
  const addressSuggestionsOpen = ref(false)
  const findOpen = ref(false)
  const janitorSearch = ref('')
  const usesDefaultProfile = ref(true)
  const settingsEntryBlocked = ref(false)
  const closeFind = vi.fn(async () => {
    findOpen.value = false
  })
  const closeHelp = vi.fn()
  const refreshPrivacySettings = vi.fn(async () => undefined)
  const onActionError = vi.fn()
  const openSettingsSection = vi.fn((section: SettingsSection) => {
    settingsSection.value = section
    settingsOpen.value = true
  })
  const closeSettings = vi.fn(() => {
    settingsOpen.value = false
  })
  const controller = useAppSiteManagementFeatureController({
    siteDataController,
    siteControlsOpen,
    siteStorageOpen,
    siteStoragePanel,
    keepsSeparatePanelOpen: () => false,
    canOpenSiteControls: () => Boolean(activeContext.value.url),
    settingsOpen,
    settingsSection,
    updateNoticeOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen,
    zoomOpen,
    addressSuggestionsOpen,
    findOpen,
    janitorSearch,
    usesDefaultProfile: () => usesDefaultProfile.value,
    activeOrigin: () => siteSummary.origin,
    settingsEntryBlocked: () => settingsEntryBlocked.value,
    openSettingsSection,
    closeSettings,
    closeHelp,
    closeFind,
    refreshPrivacySettings,
    onActionError
  })

  return {
    controller,
    siteDataController,
    siteControlsOpen,
    siteStorageOpen,
    resetSiteStorage,
    refreshSiteStorage,
    settingsOpen,
    settingsSection,
    updateNoticeOpen,
    downloadsOpen,
    bookmarksOpen,
    historyOpen,
    tabSearchOpen,
    zoomOpen,
    addressSuggestionsOpen,
    findOpen,
    janitorSearch,
    usesDefaultProfile,
    settingsEntryBlocked,
    loadSiteSummary,
    closeFind,
    closeHelp,
    refreshPrivacySettings,
    openSettingsSection
  }
}

function openCompetingSurfaces(harness: ReturnType<typeof createHarness>): void {
  harness.settingsOpen.value = true
  harness.updateNoticeOpen.value = true
  harness.downloadsOpen.value = true
  harness.bookmarksOpen.value = true
  harness.historyOpen.value = true
  harness.tabSearchOpen.value = true
  harness.zoomOpen.value = true
  harness.addressSuggestionsOpen.value = true
  harness.findOpen.value = true
}

describe('useAppSiteManagementFeatureController', () => {
  it('coordinates site controls with competing surfaces and the active site summary', async () => {
    const harness = createHarness()
    openCompetingSurfaces(harness)

    await harness.controller.toggleSiteControls()

    expect(harness.siteControlsOpen.value).toBe(true)
    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.updateNoticeOpen.value).toBe(false)
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(false)
    expect(harness.historyOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)
    expect(harness.zoomOpen.value).toBe(false)
    expect(harness.addressSuggestionsOpen.value).toBe(false)
    expect(harness.closeFind).toHaveBeenCalledOnce()
    expect(harness.loadSiteSummary).toHaveBeenCalledWith({
      tabId: 'tab-1',
      url: 'https://example.test/path'
    })
    expect(harness.siteDataController.summary.value?.cookieCount).toBe(2)

    harness.controller.openSitePermissionSettings()
    expect(harness.siteControlsOpen.value).toBe(false)
    expect(harness.openSettingsSection).toHaveBeenLastCalledWith('permissions')

    harness.controller.dispose()
  })

  it('routes privacy to global settings or isolated site storage based on the active profile', async () => {
    const harness = createHarness()
    harness.siteControlsOpen.value = true
    harness.findOpen.value = true
    harness.downloadsOpen.value = true

    await harness.controller.openSitePrivacySettings()

    expect(harness.siteControlsOpen.value).toBe(false)
    expect(harness.openSettingsSection).toHaveBeenLastCalledWith('privacy')
    expect(harness.janitorSearch.value).toBe('https://example.test')
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.closeFind).toHaveBeenCalledOnce()
    expect(harness.refreshPrivacySettings).toHaveBeenCalledOnce()

    harness.settingsOpen.value = false
    await nextTick()
    expect(harness.janitorSearch.value).toBe('')

    harness.usesDefaultProfile.value = false
    harness.siteControlsOpen.value = true
    harness.settingsOpen.value = true
    await harness.controller.openSitePrivacySettings()

    expect(harness.siteControlsOpen.value).toBe(false)
    expect(harness.siteStorageOpen.value).toBe(true)
    expect(harness.settingsOpen.value).toBe(false)
    expect(harness.resetSiteStorage).toHaveBeenCalledOnce()
    expect(harness.refreshSiteStorage).toHaveBeenCalledOnce()
    expect(harness.openSettingsSection).toHaveBeenCalledTimes(1)

    harness.controller.dispose()
  })

  it('preserves blocked update navigation and disposes its watchers idempotently', async () => {
    const harness = createHarness()
    harness.settingsEntryBlocked.value = true

    harness.controller.openUpdateSettings()
    expect(harness.openSettingsSection).not.toHaveBeenCalled()
    expect(harness.closeHelp).not.toHaveBeenCalled()

    harness.settingsEntryBlocked.value = false
    harness.downloadsOpen.value = true
    harness.bookmarksOpen.value = true
    harness.historyOpen.value = true
    harness.tabSearchOpen.value = true
    harness.controller.openUpdateSettings()

    expect(harness.closeHelp).toHaveBeenCalledOnce()
    expect(harness.openSettingsSection).toHaveBeenCalledWith('updates')
    expect(harness.downloadsOpen.value).toBe(false)
    expect(harness.bookmarksOpen.value).toBe(false)
    expect(harness.historyOpen.value).toBe(false)
    expect(harness.tabSearchOpen.value).toBe(false)

    const refreshCount = harness.refreshPrivacySettings.mock.calls.length
    harness.controller.dispose()
    harness.controller.dispose()
    harness.settingsSection.value = 'privacy'
    harness.settingsOpen.value = true
    await nextTick()
    expect(harness.refreshPrivacySettings).toHaveBeenCalledTimes(refreshCount)
  })
})
