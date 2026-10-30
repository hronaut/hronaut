import { computed, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { browserEnvironmentFromEmulation } from '../../src/shared/browser-environment.js'
import type {
  BrowserBookmark,
  BrowserDownloadState,
  BrowserState,
  BrowserTabState,
  CredentialSummary,
  DetachablePanelId,
  SitePermissionEntry
} from '../../src/shared/types.js'
import { useAppActiveTabFeatureController } from '../../src/renderer/src/composables/useAppActiveTabFeatureController.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/path',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function credential(id: string, origin = 'https://example.test'): CredentialSummary {
  return {
    id,
    origin,
    username: id,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z'
  }
}

function createHarness() {
  const website = tab()
  const home = tab({ id: 'home', title: 'Home', url: 'hronaut://home/', active: false })
  const state = ref<BrowserState>({
    tabs: [home, website],
    closedTabs: [],
    activeTabId: website.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  })
  const activeTab = computed(() => state.value.tabs.find((entry) => entry.id === state.value.activeTabId))
  const credentials = ref<CredentialSummary[]>([
    credential('matching'),
    credential('other-origin', 'https://other.test')
  ])
  const pickerOpen = ref(false)
  const activePanelId = ref<DetachablePanelId | null>(null)
  const openPicker = vi.fn(() => { pickerOpen.value = true })
  const fillCredential = vi.fn(async () => true)
  const showToast = vi.fn()
  const translate = vi.fn((key: string) => key)
  const context = {
    keepsSeparatePanelOpen: vi.fn(() => false),
    siteControlsOpen: ref(true),
    pageToolsOpen: ref(true),
    responsivePanelOpen: ref(true),
    environmentPanelOpen: ref(true),
    emulation: {
      invalidateEmulationMutation: vi.fn(),
      loadResponsiveDraft: vi.fn(),
      resetResponsiveFeedback: vi.fn(),
      loadEnvironmentDraft: vi.fn(),
      environmentController: {
        pendingAction: ref<null | 'apply-reload'>(null),
        resetFeedback: vi.fn()
      }
    },
    siteData: { reset: vi.fn() },
    resetSiteStorage: vi.fn(),
    panels: {
      resetConsoleView: vi.fn(),
      resetNetworkMonitorView: vi.fn()
    },
    rememberWebsiteTab: vi.fn()
  }
  const controller = useAppActiveTabFeatureController({
    presentation: {
      state,
      activeTab,
      sitePermissions: ref<SitePermissionEntry[]>([]),
      credentials,
      downloads: ref<BrowserDownloadState[]>([]),
      bookmarks: ref<BrowserBookmark[]>([]),
      translate,
      formatNumber: String,
      describeEmulation: () => 'mobile viewport'
    },
    credentialFill: {
      pickerOpen,
      openPicker,
      fillCredential,
      showToast
    },
    detachedPanel: {
      window: true,
      activePanelId,
      label: (panelId) => `Panel: ${panelId}`
    },
    context
  })
  return {
    controller,
    state,
    credentials,
    pickerOpen,
    activePanelId,
    openPicker,
    fillCredential,
    showToast,
    translate,
    context
  }
}

describe('useAppActiveTabFeatureController', () => {
  it('keeps origin-scoped presentation and credential filling on one active-tab boundary', async () => {
    const harness = createHarness()

    expect(harness.controller.activeWebUrl.value).toBe('https://example.test/path')
    expect(harness.controller.activeCredentials.value.map(({ id }) => id)).toEqual(['matching'])
    await harness.controller.fillSavedPassword()

    expect(harness.fillCredential).toHaveBeenCalledWith('tab-1', 'matching')
    expect(harness.showToast).toHaveBeenCalledExactlyOnceWith(
      'success',
      'runtime.toast.passwordFilled',
      'runtime.toast.passwordFilledDescription'
    )
    expect(harness.translate).toHaveBeenCalledWith('runtime.toast.passwordFilledDescription', { username: 'matching' })
    expect(harness.openPicker).not.toHaveBeenCalled()

    harness.credentials.value.push(credential('second-match'))
    await harness.controller.fillSavedPassword()

    expect(harness.openPicker).toHaveBeenCalledOnce()
    expect(harness.pickerOpen.value).toBe(true)
    expect(harness.fillCredential).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('says when a saved password could not be filled, or no longer matches the page', async () => {
    const harness = createHarness()
    harness.fillCredential.mockRejectedValueOnce(new Error(''))
    await harness.controller.fillSavedPassword()
    expect(harness.showToast).toHaveBeenLastCalledWith('error', 'runtime.toast.passwordFillFailed', 'runtime.toast.passwordFillDescription')

    harness.fillCredential.mockResolvedValueOnce(false)
    await harness.controller.fillSavedPassword()
    expect(harness.showToast).toHaveBeenLastCalledWith('error', 'runtime.toast.passwordFillFailed', 'runtimeActions.credential.noLongerMatches')
    expect(harness.showToast).toHaveBeenCalledTimes(2)
    harness.controller.dispose()
  })

  it('derives detached-panel availability, labels, and emulation text from current state', () => {
    const harness = createHarness()
    const { geolocation, ...environment } = browserEnvironmentFromEmulation()
    const emulated = tab({
      emulation: { ...environment, ...(geolocation ? { geolocation } : {}) }
    })

    expect(harness.controller.detachedPanelUnavailable.value).toBe(false)
    expect(harness.controller.detachedPanelLabelText.value).toBe('shell.pageTools.heading')
    expect(harness.controller.describeTabEmulation(emulated)).toBe('mobile viewport')
    expect(harness.controller.describeTabEmulation(tab())).toBe('')

    harness.state.value = {
      ...harness.state.value,
      tabs: harness.state.value.tabs.map((entry) => ({
        ...entry,
        active: entry.id === 'home'
      })),
      activeTabId: 'home'
    }
    expect(harness.controller.activeIsHome.value).toBe(true)
    expect(harness.controller.detachedPanelUnavailable.value).toBe(true)

    harness.activePanelId.value = 'bookmarks'
    expect(harness.controller.detachedPanelUnavailable.value).toBe(false)
    expect(harness.controller.detachedPanelLabelText.value).toBe('Panel: bookmarks')

    harness.activePanelId.value = 'network'
    expect(harness.controller.detachedPanelUnavailable.value).toBe(true)
    expect(harness.controller.detachedPanelLabelText.value).toBe('Panel: network')
    harness.controller.dispose()
  })

  it('owns active-tab context cleanup and stops it when the feature is disposed', async () => {
    const harness = createHarness()
    vi.clearAllMocks()
    harness.pickerOpen.value = true

    harness.state.value = {
      ...harness.state.value,
      activeTabId: 'home',
      tabs: harness.state.value.tabs.map((entry) => ({
        ...entry,
        active: entry.id === 'home'
      }))
    }
    await nextTick()

    expect(harness.pickerOpen.value).toBe(false)
    expect(harness.context.rememberWebsiteTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'home' })
    )
    expect(harness.context.siteData.reset).toHaveBeenCalledOnce()
    expect(harness.context.panels.resetConsoleView).toHaveBeenCalledWith(true)
    expect(harness.context.panels.resetNetworkMonitorView).toHaveBeenCalledWith(true)

    harness.controller.dispose()
    vi.clearAllMocks()
    harness.state.value = {
      ...harness.state.value,
      activeTabId: 'tab-1',
      tabs: harness.state.value.tabs.map((entry) => ({
        ...entry,
        active: entry.id === 'tab-1'
      }))
    }
    await nextTick()

    expect(harness.context.rememberWebsiteTab).not.toHaveBeenCalled()
    expect(harness.context.siteData.reset).not.toHaveBeenCalled()
  })
})
