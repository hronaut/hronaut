import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useActiveTabPresentationController } from '../../src/renderer/src/composables/useActiveTabPresentationController.js'
import { browserEnvironmentFromEmulation } from '../../src/shared/browser-environment.js'
import type {
  BrowserBookmark,
  BrowserDownloadState,
  BrowserEmulationState,
  BrowserState,
  BrowserTabState,
  CredentialSummary,
  SitePermissionEntry
} from '../../src/shared/types.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/path',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: true,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function emulation(): BrowserEmulationState {
  const { geolocation, ...environment } = browserEnvironmentFromEmulation()
  return { ...environment, ...(geolocation ? { geolocation } : {}) }
}

function state(active: BrowserTabState): BrowserState {
  return {
    tabs: [tab({ id: 'home', url: 'hronaut://home/', active: false }), active],
    closedTabs: [],
    activeTabId: active.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/tmp/profile',
    mcpTabGroups: [{
      id: 'isolated',
      name: 'Research',
      color: 'blue',
      createdAt: '2026-08-23T00:00:00.000Z',
      lastUsedAt: '2026-08-23T00:00:00.000Z',
      tabCount: 1,
      activeTabId: active.id,
      isDefault: false,
      storageKind: 'isolated',
      storageOriginCount: 1,
      navigationPolicy: { mode: 'unrestricted', rules: [] }
    }],
    savedTabGroups: []
  }
}

function create(active = tab()) {
  const browserState = ref(state(active))
  const activeTab = ref<BrowserTabState | undefined>(active)
  const sitePermissions = ref<SitePermissionEntry[]>([
    { origin: 'https://example.test', permission: 'camera', decision: 'allow' },
    { origin: 'https://other.test', permission: 'camera', decision: 'deny' }
  ])
  const credentials = ref<CredentialSummary[]>([
    { id: 'credential', origin: 'https://example.test', username: 'person', createdAt: '', updatedAt: '' },
    { id: 'other', origin: 'https://other.test', username: 'other', createdAt: '', updatedAt: '' }
  ])
  const downloads = ref<BrowserDownloadState[]>([])
  const bookmarks = ref<BrowserBookmark[]>([
    { id: 'bookmark', url: 'https://example.test/path', title: 'Example', createdAt: '', updatedAt: '' }
  ])
  const translate = (key: string, parameters?: Record<string, unknown>): string => {
    const suffix = parameters ? `:${Object.values(parameters).join(',')}` : ''
    return `[${key}${suffix}]`
  }
  const controller = useActiveTabPresentationController({
    state: browserState,
    activeTab,
    sitePermissions,
    credentials,
    downloads,
    bookmarks,
    translate,
    formatNumber: (value) => `#${value}`,
    describeEmulation: () => 'mobile viewport'
  })
  return { controller, browserState, activeTab, downloads }
}

describe('active tab presentation controller', () => {
  it('derives website context and keeps origin-scoped data isolated', () => {
    const { controller } = create(tab({ mcpGroupId: 'isolated' }))

    expect(controller.regularTabs.value).toHaveLength(1)
    expect(controller.activeWebUrl.value).toBe('https://example.test/path')
    expect(controller.activeOrigin.value).toBe('https://example.test')
    expect(controller.activeHostname.value).toBe('example.test')
    expect(controller.activeSitePermissions.value.map((entry) => entry.origin)).toEqual(['https://example.test'])
    expect(controller.activeCredentials.value.map((entry) => entry.id)).toEqual(['credential'])
    expect(controller.currentBookmark.value?.id).toBe('bookmark')
    expect(controller.activeTabUsesDefaultProfile.value).toBe(false)
  })

  it('rejects non-web and malformed active addresses from site-scoped presentation', () => {
    const active = tab({ url: 'file:///tmp/page.html' })
    const { controller, activeTab } = create(active)

    expect(controller.activeWebUrl.value).toBeNull()
    expect(controller.activeOrigin.value).toBeNull()
    expect(controller.activeHostname.value).toBe('')
    expect(controller.activeSitePermissions.value).toEqual([])
    expect(controller.activeCredentials.value).toEqual([])

    activeTab.value = tab({ url: 'not a valid URL' })
    expect(controller.activeWebUrl.value).toBeNull()
    expect(controller.activeOrigin.value).toBeNull()
  })

  it('presents active, completed, and historical download states', () => {
    const { controller, downloads } = create()
    downloads.value = [{
      id: 'download',
      url: 'https://example.test/file',
      filename: 'file.zip',
      state: 'progressing',
      receivedBytes: 1,
      totalBytes: 2,
      startedAt: ''
    }]
    expect(controller.downloadButtonLabel.value).toBe('[runtime.downloads.progress:#1]')

    downloads.value[0].state = 'completed'
    expect(controller.downloadButtonLabel.value).toBe('[runtime.downloads.complete:file.zip]')
    downloads.value[0].state = 'interrupted'
    expect(controller.downloadButtonLabel.value).toBe('[runtime.downloads.recent]')
    downloads.value = []
    expect(controller.downloadButtonLabel.value).toBe('[runtime.downloads.heading]')
  })

  it('includes protected tab state in tooltips and formats renderer failures', () => {
    const active = tab({
      title: '',
      pinned: true,
      sleeping: true,
      muted: true,
      humanInteractionLocked: true,
      networkRouteCount: 2,
      mcpGroupName: 'Research',
      emulation: emulation(),
      pageProblem: {
        kind: 'renderer-gone',
        title: 'Page crashed',
        message: 'The page renderer stopped.',
        url: 'https://example.test/path',
        reason: 'crashed',
        exitCode: 9
      }
    })
    const { controller, browserState } = create(active)
    browserState.value.splitView = { firstTabId: active.id, secondTabId: 'other', orientation: 'horizontal', ratio: 0.5 }

    expect(controller.tabTooltip(active)).toContain('[tabSearch.newTabTitle]')
    expect(controller.tabTooltip(active)).toContain('[runtimeDetails.tab.sleeping]')
    expect(controller.tabTooltip(active)).toContain('[runtimeDetails.tab.routes:#2]')
    expect(controller.tabTooltip(active)).toContain('[runtimeDetails.tab.workspace:Research]')
    expect(controller.pageProblemDetails(active)).toBe('[runtimeDetails.tab.exit:crashed,#9]')
  })
})
