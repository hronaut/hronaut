import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppBrowserChromeLayer from '../../src/renderer/src/components/AppBrowserChromeLayer.vue'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    loading: false,
    canGoBack: true,
    canGoForward: true,
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

function state(activeTab = tab()): BrowserState {
  return {
    tabs: [activeTab],
    closedTabs: [],
    activeTabId: activeTab.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/tmp/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

const expandTabGroup = vi.fn()
const expandTabGroupForTab = vi.fn()
const BrowserTabsBarStub = defineComponent({
  name: 'BrowserTabsBar',
  props: {
    state: Object,
    hydrated: Boolean,
    orientation: String,
    railPinned: Boolean,
    railRevealed: Boolean,
    forceRailCollapsed: Boolean,
    mcpActivityByTab: Object,
    formatNumber: Function,
    tabTooltip: Function,
    describeEmulation: Function
  },
  emits: [
    'openHome',
    'showWorkspaceContextMenu',
    'newTab',
    'createWorkspace',
    'selectTab',
    'showTabContextMenu',
    'reorderTab',
    'toggleTabMuted',
    'closeTab',
    'dragStart',
    'toggleRailPinned'
  ],
  setup(_props, { expose }) {
    expose({ expandTabGroup, expandTabGroupForTab })
    return () => h('div', { 'data-testid': 'tabs' })
  }
})

const AppTopbarActionsStub = defineComponent({
  name: 'AppTopbarActions',
  props: {
    commandPaletteOpen: Boolean,
    tabSearchOpen: Boolean,
    downloadsOpen: Boolean,
    historyOpen: Boolean,
    settingsOpen: Boolean,
    downloads: Array,
    activeDownloads: Array,
    downloadButtonLabel: String,
    allInteractionLocked: Boolean,
    allInteractionLockLabel: String,
    showUpdateStatus: Boolean,
    updateState: Object,
    mcpStatusController: Object
  },
  emits: [
    'toggleCommandPalette',
    'toggleTabSearch',
    'toggleDownloads',
    'toggleHistory',
    'toggleAllInteraction',
    'openUpdateSettings',
    'toggleSettings'
  ],
  setup() {
    return () => h('div', { 'data-testid': 'topbar-actions' })
  }
})

const BrowserAddressBarStub = defineComponent({
  name: 'BrowserAddressBar',
  props: {
    siteControlsOpen: Boolean,
    panelDock: String,
    addressController: Object,
    activeTabPresentation: Object,
    emulationController: Object,
    pageToolsPresentation: Object,
    siteDataController: Object,
    sitePermissionsController: Object,
    locale: String,
    formatNumber: Function,
    runAction: Function,
    actions: Object
  },
  emits: ['update:siteControlsOpen', 'update:panelDock'],
  setup() {
    return () => h('div', { 'data-testid': 'address' })
  }
})

const BrowserNavigationControlsStub = defineComponent({
  name: 'BrowserNavigationControls',
  props: {
    activeTab: Object,
    zoomOpen: Boolean,
    bookmarksOpen: Boolean,
    currentBookmark: Boolean,
    formatPercent: Function
  },
  emits: ['back', 'forward', 'reload', 'stop', 'find', 'toggleZoom', 'toggleBookmarks'],
  setup(_props, { slots }) {
    return () => h('div', { 'data-testid': 'navigation' }, slots.default?.())
  }
})

const BrowserPageActionsStub = defineComponent({
  name: 'BrowserPageActions',
  props: {
    splitMenuOpen: Boolean,
    state: Object,
    activeTab: Object,
    browser: Object,
    acceptState: Function,
    closeOtherMenus: Function,
    effectiveHumanInteractionLocked: Boolean,
    tabHumanInteractionLocked: Boolean,
    tabInteractionLockLabel: String,
    areaCaptureState: String,
    areaCaptureLabel: String,
    elementPickerState: String,
    elementPickerTitle: String,
    elementPickerLabel: String,
    pageToolsOpen: Boolean
  },
  emits: [
    'update:splitMenuOpen',
    'toggleTabInteraction',
    'toggleAreaCapture',
    'toggleElementPicker',
    'togglePageTools',
    'splitError'
  ],
  setup() {
    return () => h('div', { 'data-testid': 'page-actions' })
  }
})

const ShellTitleBarSurfaceStub = defineComponent({
  name: 'ShellTitleBarSurface',
  props: { kind: String, draggable: Boolean },
  setup(props) {
    return () => h('div', { 'data-testid': `titlebar-${props.kind}` })
  }
})

function createHarness(home = false) {
  const activeTab = tab()
  const browserState = state(activeTab)
  const customTitleBar = ref(false)
  const orientation = ref<'horizontal' | 'vertical'>('horizontal')
  const compact = ref(false)
  const collapsed = ref(false)
  const activeIsHome = ref(home)
  const panelDock = ref<'right' | 'bottom' | 'left' | 'window'>('right')
  const runAction = vi.fn(async (action: () => unknown) => {
    await action()
    return true
  })
  const syncState = vi.fn(async () => undefined)
  const browser = {
    back: vi.fn(async () => browserState),
    forward: vi.fn(async () => browserState),
    reload: vi.fn(async () => browserState),
    stop: vi.fn(async () => browserState),
    showTabContextMenu: vi.fn(async () => undefined)
  }
  const actions = {
    openHome: vi.fn(),
    newTabInWorkspace: vi.fn(),
    openNewWorkspaceEditor: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleTabSearch: vi.fn(),
    openFind: vi.fn(),
    toggleZoom: vi.fn(),
    togglePageTools: vi.fn(),
    prepareSplitViewMenu: vi.fn(),
    handleSplitViewError: vi.fn()
  }
  const shellActions = {
    revealVerticalTabRail: vi.fn(),
    concealVerticalTabRail: vi.fn(),
    handleVerticalTabRailFocusOut: vi.fn(),
    toggleVerticalTabRailPinned: vi.fn()
  }
  const collectionActions = {
    toggleDownloads: vi.fn(),
    toggleBookmarks: vi.fn(),
    toggleVisitHistory: vi.fn()
  }
  const pageActions = {
    toggleAreaCapture: vi.fn(),
    toggleElementPicker: vi.fn()
  }
  const siteActions = {
    toggleSiteControls: vi.fn(),
    openSitePermissionSettings: vi.fn(),
    openSitePrivacySettings: vi.fn(),
    openUpdateSettings: vi.fn()
  }
  const tabActions = {
    reorderTab: vi.fn(),
    selectBrowserTab: vi.fn(),
    showWorkspaceContextMenu: vi.fn(),
    closeTab: vi.fn(),
    toggleTabMuted: vi.fn(),
    toggleTabHumanInteraction: vi.fn(),
    toggleAllHumanInteraction: vi.fn()
  }
  const settingsActions = { toggle: vi.fn() }
  const addressActions = {
    resetActiveTabEmulation: vi.fn(),
    openRequestConditions: vi.fn(),
    setSitePermissionDecision: vi.fn(),
    removeSitePermission: vi.fn()
  }
  const props = {
    state: browserState,
    hydrated: true,
    locale: 'en-US' as const,
    browser: browser as never,
    shellController: {
      overlayEnabled: customTitleBar,
      tabOrientation: orientation,
      compactVerticalTabRail: compact,
      verticalTabRailCollapsed: collapsed,
      verticalTabRailPinned: ref(false),
      verticalTabRailRevealed: ref(false),
      panelDock,
      ...shellActions
    } as never,
    runtimeController: {
      activeTab: ref(activeTab),
      mcpActivityByTab: ref({})
    } as never,
    activeTabController: {
      activeTabPresentationController: {},
      activeIsHome,
      activeDownloads: ref([]),
      currentBookmark: ref(undefined),
      downloadButtonLabel: ref('Downloads'),
      effectiveHumanInteractionLocked: ref(false),
      tabHumanInteractionLocked: ref(false),
      tabInteractionLockLabel: ref('Lock tab'),
      allInteractionLockLabel: ref('Lock browser'),
      tabTooltip: vi.fn(),
      describeTabEmulation: vi.fn()
    } as never,
    settingsController: {
      settingsDialogController: { open: ref(false), ...settingsActions },
      updateSettingsController: { state: ref({ status: 'idle', currentVersion: '1.9.9' }) },
      mcpStatusController: {},
      sitePermissionsController: {
        setDecision: addressActions.setSitePermissionDecision,
        remove: addressActions.removeSitePermission
      },
      showUpdateStatusPill: ref(false)
    } as never,
    collectionsController: {
      downloads: ref([]),
      downloadsOpen: ref(false),
      bookmarksOpen: ref(false),
      historyOpen: ref(false),
      ...collectionActions
    } as never,
    emulationController: {
      emulationController: {},
      resetActiveTabEmulation: addressActions.resetActiveTabEmulation
    } as never,
    pageToolsController: {
      pageToolsPresentationController: {},
      areaCaptureState: ref('idle'),
      areaCaptureLabel: ref('Capture area'),
      elementPickerState: ref('idle'),
      elementPickerTitle: ref('Pick element'),
      elementPickerLabel: ref('Pick element'),
      ...pageActions
    } as never,
    panelController: { openRequestConditions: addressActions.openRequestConditions } as never,
    siteController: { ...siteActions } as never,
    tabActionsController: { ...tabActions } as never,
    addressController: {} as never,
    siteDataController: {} as never,
    formatNumber: String,
    formatPercent: String,
    runAction,
    syncState,
    actions,
    commandPaletteOpen: true,
    tabSearchOpen: true,
    zoomOpen: true,
    siteControlsOpen: true,
    splitMenuOpen: true,
    pageToolsOpen: true
  }
  const wrapper = mount(AppBrowserChromeLayer, {
    props,
    global: {
      stubs: {
        BrowserTabsBar: BrowserTabsBarStub,
        AppTopbarActions: AppTopbarActionsStub,
        BrowserAddressBar: BrowserAddressBarStub,
        BrowserNavigationControls: BrowserNavigationControlsStub,
        BrowserPageActions: BrowserPageActionsStub,
        ShellTitleBarSurface: ShellTitleBarSurfaceStub
      }
    }
  })

  return {
    wrapper,
    props,
    customTitleBar,
    orientation,
    compact,
    collapsed,
    activeIsHome,
    panelDock,
    runAction,
    syncState,
    browser,
    actions,
    shellActions,
    collectionActions,
    pageActions,
    siteActions,
    tabActions,
    settingsActions,
    addressActions
  }
}

describe('AppBrowserChromeLayer', () => {
  it('keeps global chrome on Home and switches website and titlebar surfaces without layout drift', async () => {
    const harness = createHarness(true)
    const topbar = () => harness.wrapper.get('.topbar')

    expect(harness.wrapper.get('[data-testid="tabs"]').element).toBeTruthy()
    expect(harness.wrapper.get('[data-testid="topbar-actions"]').element).toBeTruthy()
    expect(harness.wrapper.find('.toolbar').exists()).toBe(false)
    expect(topbar().attributes('data-titlebar-drag-surface')).toBeUndefined()

    harness.customTitleBar.value = true
    await nextTick()
    expect(topbar().attributes()).toHaveProperty('data-titlebar-drag-surface')

    harness.orientation.value = 'vertical'
    harness.compact.value = true
    harness.collapsed.value = true
    await nextTick()
    expect(harness.wrapper.find('[data-testid="titlebar-rail"]').exists()).toBe(true)
    expect(harness.wrapper.find('[data-testid="titlebar-home"]').exists()).toBe(true)
    expect(topbar().classes()).toEqual(expect.arrayContaining(['rail-collapsed', 'compact-vertical-tab-rail']))
    expect(topbar().attributes('data-titlebar-drag-surface')).toBeUndefined()

    harness.activeIsHome.value = false
    await nextTick()
    expect(harness.wrapper.find('[data-testid="titlebar-home"]').exists()).toBe(false)
    expect(harness.wrapper.get('.toolbar').attributes()).toHaveProperty('data-titlebar-drag-surface')
    expect(harness.wrapper.get('[data-testid="address"]').element).toBeTruthy()
    expect(harness.wrapper.get('[data-testid="page-actions"]').element).toBeTruthy()

    await topbar().trigger('mouseenter')
    await topbar().trigger('mouseleave')
    await topbar().trigger('focusin')
    await topbar().trigger('focusout')
    expect(harness.shellActions.revealVerticalTabRail).toHaveBeenCalledTimes(2)
    expect(harness.shellActions.concealVerticalTabRail).toHaveBeenCalledTimes(1)
    expect(harness.shellActions.handleVerticalTabRailFocusOut).toHaveBeenCalledTimes(1)
  })

  it('preserves all model channels and the BrowserTabsBar imperative facade', async () => {
    const harness = createHarness()
    expandTabGroup.mockClear()
    expandTabGroupForTab.mockClear()
    const topbar = harness.wrapper.getComponent(AppTopbarActionsStub)
    const navigation = harness.wrapper.getComponent(BrowserNavigationControlsStub)
    const address = harness.wrapper.getComponent(BrowserAddressBarStub)
    const page = harness.wrapper.getComponent(BrowserPageActionsStub)

    expect(topbar.props()).toMatchObject({ commandPaletteOpen: true, tabSearchOpen: true })
    expect(navigation.props('zoomOpen')).toBe(true)
    expect(address.props('siteControlsOpen')).toBe(true)
    expect(address.props('panelDock')).toBe('right')
    expect(page.props()).toMatchObject({ splitMenuOpen: true, pageToolsOpen: true })

    await harness.wrapper.setProps({
      commandPaletteOpen: false,
      tabSearchOpen: false,
      zoomOpen: false,
      siteControlsOpen: false,
      splitMenuOpen: false,
      pageToolsOpen: false
    })
    expect(topbar.props()).toMatchObject({ commandPaletteOpen: false, tabSearchOpen: false })
    expect(navigation.props('zoomOpen')).toBe(false)
    expect(address.props('siteControlsOpen')).toBe(false)
    expect(page.props()).toMatchObject({ splitMenuOpen: false, pageToolsOpen: false })

    address.vm.$emit('update:siteControlsOpen', true)
    address.vm.$emit('update:panelDock', 'bottom')
    page.vm.$emit('update:splitMenuOpen', true)
    await nextTick()
    expect(harness.wrapper.emitted('update:siteControlsOpen')?.at(-1)).toEqual([true])
    expect(harness.panelDock.value).toBe('bottom')
    expect(harness.wrapper.emitted('update:splitMenuOpen')?.at(-1)).toEqual([true])

    const surface = harness.wrapper.vm as unknown as {
      expandTabGroup: (groupId: string) => void
      expandTabGroupForTab: (tab: BrowserTabState) => void
    }
    surface.expandTabGroup('workspace-1')
    surface.expandTabGroupForTab(harness.props.state.tabs[0])
    expect(expandTabGroup).toHaveBeenCalledWith('workspace-1')
    expect(expandTabGroupForTab).toHaveBeenCalledWith(harness.props.state.tabs[0])

    harness.wrapper.unmount()
    surface.expandTabGroup('workspace-2')
    surface.expandTabGroupForTab(harness.props.state.tabs[0])
    expect(expandTabGroup).toHaveBeenCalledTimes(1)
    expect(expandTabGroupForTab).toHaveBeenCalledTimes(1)
  })

  it('forwards every child event through the existing action boundary and closes tab search on select or drag', async () => {
    const harness = createHarness()
    const tabs = harness.wrapper.getComponent(BrowserTabsBarStub)
    const topbar = harness.wrapper.getComponent(AppTopbarActionsStub)
    const navigation = harness.wrapper.getComponent(BrowserNavigationControlsStub)
    const address = harness.wrapper.getComponent(BrowserAddressBarStub)
    const page = harness.wrapper.getComponent(BrowserPageActionsStub)
    const reorder = { tabId: 'tab-1', targetTabId: 'tab-2', placement: 'after' as const }

    tabs.vm.$emit('openHome')
    tabs.vm.$emit('showWorkspaceContextMenu', 'workspace-1')
    tabs.vm.$emit('newTab', 'workspace-1')
    tabs.vm.$emit('createWorkspace')
    tabs.vm.$emit('showTabContextMenu', 'tab-1')
    tabs.vm.$emit('reorderTab', reorder)
    tabs.vm.$emit('toggleTabMuted', harness.props.state.tabs[0])
    tabs.vm.$emit('closeTab', 'tab-1')
    tabs.vm.$emit('toggleRailPinned')

    topbar.vm.$emit('toggleCommandPalette')
    topbar.vm.$emit('toggleTabSearch')
    topbar.vm.$emit('toggleDownloads')
    topbar.vm.$emit('toggleHistory')
    topbar.vm.$emit('toggleAllInteraction')
    topbar.vm.$emit('openUpdateSettings')
    topbar.vm.$emit('toggleSettings')

    for (const event of ['back', 'forward', 'reload', 'stop'] as const) navigation.vm.$emit(event)
    navigation.vm.$emit('find')
    navigation.vm.$emit('toggleZoom')
    navigation.vm.$emit('toggleBookmarks')

    page.vm.$emit('toggleTabInteraction')
    page.vm.$emit('toggleAreaCapture')
    page.vm.$emit('toggleElementPicker')
    page.vm.$emit('togglePageTools')
    page.vm.$emit('splitError', new Error('split'), 'Split failed')
    await nextTick()

    expect(harness.actions.openHome).toHaveBeenCalledOnce()
    expect(harness.tabActions.showWorkspaceContextMenu).toHaveBeenCalledWith('workspace-1')
    expect(harness.actions.newTabInWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(harness.actions.openNewWorkspaceEditor).toHaveBeenCalledOnce()
    expect(harness.browser.showTabContextMenu).toHaveBeenCalledWith('tab-1')
    expect(harness.tabActions.reorderTab).toHaveBeenCalledWith(reorder)
    expect(harness.tabActions.toggleTabMuted).toHaveBeenCalledWith(harness.props.state.tabs[0])
    expect(harness.tabActions.closeTab).toHaveBeenCalledWith('tab-1')
    expect(harness.shellActions.toggleVerticalTabRailPinned).toHaveBeenCalledOnce()
    expect(harness.actions.toggleCommandPalette).toHaveBeenCalledOnce()
    expect(harness.actions.toggleTabSearch).toHaveBeenCalledOnce()
    expect(harness.collectionActions.toggleDownloads).toHaveBeenCalledOnce()
    expect(harness.collectionActions.toggleVisitHistory).toHaveBeenCalledOnce()
    expect(harness.tabActions.toggleAllHumanInteraction).toHaveBeenCalledOnce()
    expect(harness.siteActions.openUpdateSettings).toHaveBeenCalledOnce()
    expect(harness.settingsActions.toggle).toHaveBeenCalledOnce()
    expect(harness.browser.back).toHaveBeenCalledOnce()
    expect(harness.browser.forward).toHaveBeenCalledOnce()
    expect(harness.browser.reload).toHaveBeenCalledOnce()
    expect(harness.browser.stop).toHaveBeenCalledOnce()
    expect(harness.syncState).toHaveBeenCalledTimes(4)
    expect(harness.actions.openFind).toHaveBeenCalledOnce()
    expect(harness.actions.toggleZoom).toHaveBeenCalledOnce()
    expect(harness.collectionActions.toggleBookmarks).toHaveBeenCalledOnce()
    expect(harness.tabActions.toggleTabHumanInteraction).toHaveBeenCalledOnce()
    expect(harness.pageActions.toggleAreaCapture).toHaveBeenCalledOnce()
    expect(harness.pageActions.toggleElementPicker).toHaveBeenCalledWith('context')
    expect(harness.actions.togglePageTools).toHaveBeenCalledOnce()
    expect(harness.actions.handleSplitViewError).toHaveBeenCalledWith(expect.any(Error), 'Split failed')

    const addressActions = address.props('actions') as Record<string, unknown>
    expect(addressActions).toMatchObject({
      toggleSiteControls: harness.siteActions.toggleSiteControls,
      resetActiveTabEmulation: harness.addressActions.resetActiveTabEmulation,
      openRequestConditions: harness.addressActions.openRequestConditions,
      setSitePermission: harness.addressActions.setSitePermissionDecision,
      resetSitePermission: harness.addressActions.removeSitePermission,
      openSitePermissionSettings: harness.siteActions.openSitePermissionSettings,
      openSitePrivacySettings: harness.siteActions.openSitePrivacySettings
    })
    expect(page.props('closeOtherMenus')).toBe(harness.actions.prepareSplitViewMenu)

    tabs.vm.$emit('selectTab', 'tab-1')
    await nextTick()
    expect(harness.wrapper.emitted('update:tabSearchOpen')?.at(-1)).toEqual([false])
    expect(harness.tabActions.selectBrowserTab).toHaveBeenCalledWith('tab-1')

    await harness.wrapper.setProps({ tabSearchOpen: true })
    tabs.vm.$emit('dragStart')
    await nextTick()
    expect(harness.wrapper.emitted('update:tabSearchOpen')?.at(-1)).toEqual([false])
    expect(harness.runAction).toHaveBeenCalled()
  })
})
