import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, effectScope, h, nextTick, ref, type EffectScope, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppBrowserChromeLayer from '../../src/renderer/src/components/AppBrowserChromeLayer.vue'
import { useFullPageView } from '../../src/renderer/src/composables/useFullPageView.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    loading: false,
    navigationGeneration: 0,
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
    workspaceSwitcherOpen: Boolean,
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
    'toggleRailPinned',
    'switchWorkspace'
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
    hasWebsiteTabs: Boolean,
    allTabsMuted: Boolean,
    allInteractionLocked: Boolean,
    allInteractionLockLabel: String,
    followAgentActivity: Boolean,
    showUpdateStatus: Boolean,
    licenseReminderShown: Boolean,
    updateState: Object,
    mcpStatusController: Object
  },
  emits: [
    'toggleCommandPalette',
    'toggleTabSearch',
    'toggleDownloads',
    'toggleHistory',
    'toggleAllTabsMuted',
    'toggleAllInteraction',
    'toggleFollowAgentActivity',
    'openUpdateSettings',
    'openLicenseSettings',
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
    activeTab: Object,
    addressController: Object,
    activeTabPresentation: Object,
    emulationController: Object,
    pageToolsPresentation: Object,
    siteDataController: Object,
    sitePermissionsController: Object,
    locale: String,
    formatNumber: Function,
    runAction: Function,
    actions: Object,
    keepsSeparatePanelOpen: Function
  },
  emits: ['update:siteControlsOpen', 'update:panelDock'],
  setup() {
    return () => h('div', { 'data-testid': 'address' })
  }
})

const AgentPresenceAvatarsStub = defineComponent({
  name: 'AgentPresenceAvatars',
  props: {
    workspaceId: String,
    activeTabId: String,
    attentionReason: String,
    attentionId: String,
    attentionDecision: Boolean,
    takeOverBadge: Object
  },
  emits: ['select', 'takeOver', 'answerAttention', 'reviewDecision', 'setPinLiveStatus'],
  setup(_props, { expose }) {
    // Each mounted toolbar starts with no card open, as the real avatars do.
    const cardOpen = ref(false)
    agentCardsOpen.push(cardOpen)
    expose({ openCard: openAgentCardSpy, focus: focusAgentAvatarSpy, cardOpen })
    return () => h('div', { 'data-testid': 'agent-presence' })
  }
})

const takeOverOfferText = ref('')
const takeOverBadge = ref<{ clientKey: string; kind: 'offer' | 'control' }>()
const takeOverSpy = vi.fn(() => takeOverOfferText.value !== '')

const AgentTakeOverPromptStub = defineComponent({
  name: 'AgentTakeOverPrompt',
  props: {
    workspaceId: String,
    activeTabId: String,
    tabs: Array,
    agentControlLocked: Boolean
  },
  emits: ['takeOver', 'handBack'],
  setup(_props, { expose }) {
    expose({ takeOver: takeOverSpy, offerText: takeOverOfferText, badge: takeOverBadge })
    return () => h('div', { 'data-testid': 'agent-take-over' })
  }
})

const agentCardsOpen: Array<Ref<boolean>> = []

const openAgentCardSpy = vi.fn((_options?: { reopen?: boolean }) => true)
const focusAgentAvatarSpy = vi.fn(() => true)

const AgentLiveStripStub = defineComponent({
  name: 'AgentLiveStrip',
  props: {
    workspaceId: String,
    attentionReason: String,
    attentionId: String,
    attentionDecision: Boolean,
    attentionWorkspaceId: String,
    attentionTabId: String,
    tabs: Array,
    agentControlLocked: Boolean
  },
  emits: ['setPaused', 'takeOver', 'handBack', 'openCard', 'unpin'],
  setup() {
    return () => h('button', { 'data-testid': 'agent-live-strip', type: 'button' })
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
  emits: ['back', 'forward', 'reload', 'reloadIgnoringCache', 'openInNewTab', 'stop', 'find', 'toggleZoom', 'toggleBookmarks'],
  setup(_props, { slots }) {
    return () => h('div', { 'data-testid': 'navigation' }, [slots.default?.(), slots.leading?.(), slots.commands?.()])
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
    'togglePageLifecycle', 'toggleTabAgentPaused',
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

const scopes: EffectScope[] = []

function createHarness(home = false, options: { attach?: boolean } = {}) {
  const fullPageAvailable = ref(!home)
  const fullPageAttention = ref(false)
  const scope = effectScope()
  scopes.push(scope)
  const fullPage = scope.run(() => useFullPageView({ available: fullPageAvailable, attention: fullPageAttention }))!
  const activeTab = tab({ mcpGroupId: 'workspace-1' })
  const browserState = state(activeTab)
  const customTitleBar = ref(false)
  const orientation = ref<'horizontal' | 'vertical'>('horizontal')
  const compact = ref(false)
  const collapsed = ref(false)
  const activeIsHome = ref(home)
  const runtimeActiveTab = ref(activeTab)
  const panelDock = ref<'right' | 'bottom' | 'left' | 'window'>('right')
  const keepsSeparatePanelOpen = () => false
  const runAction = vi.fn(async (action: () => unknown) => {
    await action()
    return true
  })
  const syncState = vi.fn(async () => undefined)
  const browser = {
    back: vi.fn(async () => browserState),
    forward: vi.fn(async () => browserState),
    reload: vi.fn(async () => browserState),
    reloadIgnoringCache: vi.fn(async () => browserState),
    openNavigationInNewTab: vi.fn(async (_options: { tabId: string; target: 'back' | 'forward' | 'reload'; active: boolean }) => browserState),
    stop: vi.fn(async () => browserState),
    setTabAgentPaused: vi.fn(async (_tabId: string, _paused: boolean) => browserState),
    setTabPageLifecycle: vi.fn(async () => browserState),
    showTabContextMenu: vi.fn(async () => undefined),
    answerUserAttention: vi.fn(async (_id: string, _answer: 'resolved' | 'dismissed') => true)
  }
  const actions = {
    openHome: vi.fn(),
    newTabInWorkspace: vi.fn(),
    openNewWorkspaceEditor: vi.fn(),
    reviewDecisions: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleWorkspaceSwitcher: vi.fn(),
    toggleTabSearch: vi.fn(),
    openFind: vi.fn(),
    toggleZoom: vi.fn(),
    togglePageTools: vi.fn(),
    openLicenseSettings: vi.fn(),
    prepareSplitViewMenu: vi.fn(),
    handleSplitViewError: vi.fn()
  }
  const shellActions = {
    revealVerticalTabRail: vi.fn(),
    concealVerticalTabRail: vi.fn(),
    handleVerticalTabRailFocusOut: vi.fn(),
    toggleVerticalTabRailPinned: vi.fn()
  }
  const tabRailResize = {
    width: ref(280),
    minimum: ref(200),
    maximum: ref(480),
    resizing: ref(false),
    startResize: vi.fn(),
    resizeWithKeyboard: vi.fn(),
    resetSize: vi.fn()
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
    isTogglePending: vi.fn(() => false),
    reorderTab: vi.fn(),
    selectBrowserTab: vi.fn(),
    showWorkspaceContextMenu: vi.fn(),
    closeTab: vi.fn(),
    toggleTabMuted: vi.fn(),
    toggleTabAgentPaused: vi.fn(),
    setTabAgentPaused: vi.fn(async (_tabId: string, _paused: boolean) => true),
    togglePageLifecycle: vi.fn(),
    toggleAllTabsMuted: vi.fn(),
    toggleTabHumanInteraction: vi.fn(),
    toggleAllHumanInteraction: vi.fn()
  }
  const settingsActions = { toggle: vi.fn(), toggleFollowAgentActivity: vi.fn() }
  const settings = ref({ followAgentActivity: false, pinAgentLiveStatus: false })
  const setPinAgentLiveStatus = vi.fn(async (pin: boolean) => { settings.value = { ...settings.value, pinAgentLiveStatus: pin } })
  const settingsOpen = ref(false)
  const licenseReminderShown = ref(false)
  const addressActions = {
    resetActiveTabEmulation: vi.fn(),
    openRequestConditions: vi.fn(),
    setSitePermissionDecision: vi.fn(),
    removeSitePermission: vi.fn()
  }
  const props = {
    state: browserState,
    fullPage,
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
      keepsSeparatePanelOpen,
      tabRailResize,
      ...shellActions
    } as never,
    runtimeController: {
      activeTab: runtimeActiveTab,
      mcpActivityByTab: ref({})
    } as never,
    activeTabController: {
      activeTabPresentationController: {},
      activeIsHome,
      activeDownloads: ref([]),
      toolbarDownloads: ref([]),
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
      settings,
      setPinAgentLiveStatus,
      settingsDialogController: { open: settingsOpen, tabOpen: ref(false), close: vi.fn(), closeTab: vi.fn(), ...settingsActions },
      updateSettingsController: { state: ref({ status: 'idle', currentVersion: '1.9.9' }) },
      mcpStatusController: {},
      sitePermissionsController: {
        setDecision: addressActions.setSitePermissionDecision,
        remove: addressActions.removeSitePermission
      },
      showUpdateStatusPill: ref(false),
      licenseAskController: { reminderShown: licenseReminderShown },
      toggleFollowAgentActivity: settingsActions.toggleFollowAgentActivity
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
    ...(options.attach ? { attachTo: document.body } : {}),
    global: {
      plugins: [createHronautI18n('en-US')],
      stubs: {
        BrowserTabsBar: BrowserTabsBarStub,
        AppTopbarActions: AppTopbarActionsStub,
        BrowserAddressBar: BrowserAddressBarStub,
        AgentPresenceAvatars: AgentPresenceAvatarsStub,
        AgentLiveStrip: AgentLiveStripStub,
        AgentTakeOverPrompt: AgentTakeOverPromptStub,
        BrowserNavigationControls: BrowserNavigationControlsStub,
        BrowserPageActions: BrowserPageActionsStub,
        ShellTitleBarSurface: ShellTitleBarSurfaceStub
      }
    }
  })

  return {
    wrapper,
    props,
    licenseReminderShown,
    customTitleBar,
    orientation,
    compact,
    collapsed,
    activeIsHome,
    runtimeActiveTab,
    panelDock,
    keepsSeparatePanelOpen,
    runAction,
    syncState,
    browser,
    actions,
    shellActions,
    tabRailResize,
    collectionActions,
    pageActions,
    siteActions,
    tabActions,
    settingsActions,
    addressActions,
    settings,
    setPinAgentLiveStatus,
    settingsOpen,
    fullPage,
    fullPageAvailable,
    fullPageAttention
  }
}

describe('AppBrowserChromeLayer', () => {
  beforeEach(() => {
    openAgentCardSpy.mockClear()
    focusAgentAvatarSpy.mockClear()
    takeOverSpy.mockClear()
    takeOverOfferText.value = ''
    takeOverBadge.value = undefined
    agentCardsOpen.splice(0)
  })
  afterEach(() => {
    vi.useRealTimers()
    for (const scope of scopes.splice(0)) scope.stop()
  })

  it('gives a website the window in the full-page view and brings the chrome back at its edge', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    const edge = () => harness.wrapper.find('[data-testid="full-page-edge"]')
    const exit = () => harness.wrapper.find('button[aria-label="Exit full-page view"]')
    expect(edge().exists()).toBe(false)
    expect(exit().exists()).toBe(false)

    expect(harness.fullPage.toggle()).toBe(true)
    await nextTick()
    // The bars give way to the window's top edge, which names the page in view.
    expect(edge().text()).toBe('Example')
    expect(edge().attributes('aria-hidden')).toBe('true')
    expect(harness.wrapper.find('.full-page-side-edge').exists()).toBe(false)
    harness.orientation.value = 'vertical'
    await nextTick()
    // With the rail, its left edge too.
    expect(harness.wrapper.find('.full-page-side-edge').exists()).toBe(true)

    // Resting the pointer anywhere on the chrome shows it after a moment, and leaving hides it again.
    const chrome = harness.wrapper.find('.browser-chrome')
    await harness.wrapper.find('.full-page-side-edge').trigger('mouseover')
    await vi.advanceTimersByTimeAsync(179)
    expect(edge().exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(edge().exists()).toBe(false)
    expect(harness.wrapper.find('.full-page-side-edge').exists()).toBe(false)
    await chrome.trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(260)
    expect(edge().exists()).toBe(true)

    // Keyboard focus shows it at once.
    await chrome.trigger('focusin')
    expect(edge().exists()).toBe(false)
    await chrome.trigger('focusout')
    await vi.advanceTimersByTimeAsync(260)
    expect(edge().exists()).toBe(true)

    // An agent that needs you brings it back until the request is answered.
    harness.fullPageAttention.value = true
    await nextTick()
    expect(edge().exists()).toBe(false)
    harness.fullPageAttention.value = false
    await nextTick()
    expect(edge().exists()).toBe(true)

    // An agent card sits under its avatar, so the chrome stays while one is open.
    agentCardsOpen.at(-1)!.value = true
    await nextTick()
    expect(edge().exists()).toBe(false)
    agentCardsOpen.at(-1)!.value = false
    await nextTick()
    expect(edge().exists()).toBe(true)

    // The revealed toolbar offers a way out.
    await exit().trigger('click')
    expect(harness.fullPage.enabled.value).toBe(false)
    expect(edge().exists()).toBe(false)
    expect(exit().exists()).toBe(false)
  })

  it('shows the band again under a pointer that stays on the chrome when the window loses focus', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    const edge = () => harness.wrapper.find('[data-testid="full-page-edge"]')
    harness.fullPage.toggle()
    await nextTick()
    await edge().trigger('mouseover')
    await vi.advanceTimersByTimeAsync(180)
    expect(edge().exists()).toBe(false)
    // Choosing a tab gives the page focus; the chrome steps aside once the click is done, and the band
    // takes the tab's place under the pointer, inside the same chrome.
    window.dispatchEvent(new Event('blur'))
    await vi.advanceTimersByTimeAsync(400)
    expect(edge().exists()).toBe(true)
    await edge().trigger('mouseover')
    await vi.advanceTimersByTimeAsync(180)
    expect(edge().exists()).toBe(false)
  })

  it('lets an agent card hold the chrome only while that toolbar shows it', async () => {
    const harness = createHarness()
    harness.fullPage.toggle()
    agentCardsOpen.at(-1)!.value = true
    await nextTick()
    expect(harness.fullPage.concealed.value).toBe(false)
    // An agent's tab change goes Home and back with the card open; the new toolbar has no card.
    harness.activeIsHome.value = true
    await nextTick()
    harness.activeIsHome.value = false
    await nextTick()
    expect(agentCardsOpen).toHaveLength(2)
    expect(harness.fullPage.concealed.value).toBe(true)
  })

  it('keeps focus in the window when the view ends while its exit button has focus', async () => {
    const harness = createHarness(false, { attach: true })
    const activeTab = document.createElement('button')
    activeTab.dataset.activeTab = 'true'
    document.body.append(activeTab)
    try {
      harness.fullPage.toggle()
      await nextTick()
      const exit = harness.wrapper.find<HTMLButtonElement>('button[aria-label="Exit full-page view"]')
      exit.element.focus()
      expect(document.activeElement).toBe(exit.element)
      // By the keys, the menu or the palette rather than the button itself.
      harness.fullPage.toggle()
      await nextTick()
      await nextTick()
      expect(document.activeElement).toBe(activeTab)
      // Ending the view with focus elsewhere leaves it there.
      const field = document.createElement('input')
      document.body.append(field)
      harness.fullPage.toggle()
      await nextTick()
      field.focus()
      harness.fullPage.toggle()
      await nextTick()
      await nextTick()
      expect(document.activeElement).toBe(field)
    } finally {
      harness.wrapper.unmount()
      document.body.replaceChildren()
    }
  })

  it('has no full-page view on Home', async () => {
    const harness = createHarness(true)
    expect(harness.fullPage.toggle()).toBe(false)
    await nextTick()
    expect(harness.wrapper.find('[data-testid="full-page-edge"]').exists()).toBe(false)
  })

  it('takes over a tab after pausing it, unless you chose something else meanwhile', async () => {
    const harness = createHarness()
    const avatars = harness.wrapper.getComponent(AgentPresenceAvatarsStub)
    let finishPause!: (paused?: boolean) => void
    harness.tabActions.setTabAgentPaused.mockImplementation(() => new Promise<boolean>((resolve) => { finishPause = (paused = true) => resolve(paused) }))
    avatars.vm.$emit('takeOver', 'tab-1')
    await nextTick()
    // Main paused the tab, though the shell's copy of the state still shows it running, as when a
    // page update lands first: the tab is still shown.
    expect((harness.wrapper.props('state') as BrowserState).tabs[0].agentPaused).not.toBe(true)
    finishPause()
    await flushPromises()
    // The pause records that you took the tab over, so the agent hears you have it until you hand it back.
    expect(harness.tabActions.setTabAgentPaused).toHaveBeenCalledWith('tab-1', true, { takeOver: true })
    expect(harness.tabActions.selectBrowserTab).toHaveBeenCalledWith('tab-1')

    // A pause that did not happen, such as under locked agent control, shows nothing.
    harness.tabActions.selectBrowserTab.mockClear()
    avatars.vm.$emit('takeOver', 'tab-1')
    await nextTick()
    finishPause(false)
    await flushPromises()
    expect(harness.tabActions.selectBrowserTab).not.toHaveBeenCalled()

    // Another tab came into view while the pause was on its way: that choice stays.
    harness.tabActions.selectBrowserTab.mockClear()
    avatars.vm.$emit('takeOver', 'tab-1')
    await nextTick()
    harness.runtimeActiveTab.value = tab({ id: 'tab-2', mcpGroupId: 'workspace-1' })
    finishPause()
    await flushPromises()
    expect(harness.tabActions.selectBrowserTab).not.toHaveBeenCalled()

    // So does tab search opened meanwhile, or a newer take over.
    harness.runtimeActiveTab.value = tab({ mcpGroupId: 'workspace-1' })
    await harness.wrapper.setProps({ tabSearchOpen: false })
    avatars.vm.$emit('takeOver', 'tab-1')
    await nextTick()
    await harness.wrapper.setProps({ tabSearchOpen: true })
    finishPause()
    await flushPromises()
    expect(harness.tabActions.selectBrowserTab).not.toHaveBeenCalled()
    expect(harness.wrapper.props('tabSearchOpen')).toBe(true)
  })

  it('offers the take over in the toolbar, takes it by shortcut and hands the tab back', async () => {
    const harness = createHarness()
    const prompt = harness.wrapper.getComponent(AgentTakeOverPromptStub)
    expect(prompt.props()).toMatchObject({ workspaceId: 'workspace-1', activeTabId: 'tab-1', agentControlLocked: false })
    expect(prompt.props('tabs')).toEqual(harness.props.state.tabs)
    // The shortcut does nothing without an offer.
    const exposed = harness.wrapper.vm as unknown as { takeOverFromAgent: () => boolean }
    expect(exposed.takeOverFromAgent()).toBe(false)
    takeOverOfferText.value = 'Take over from Claude Code?'
    expect(exposed.takeOverFromAgent()).toBe(true)
    expect(takeOverSpy).toHaveBeenCalledTimes(2)

    prompt.vm.$emit('takeOver', 'tab-1')
    await flushPromises()
    expect(harness.tabActions.setTabAgentPaused).toHaveBeenLastCalledWith('tab-1', true, { takeOver: true })
    prompt.vm.$emit('handBack', 'tab-1')
    await flushPromises()
    expect(harness.tabActions.setTabAgentPaused).toHaveBeenLastCalledWith('tab-1', false)

    // Without room in the toolbar, the agent's avatar carries the prompt's badge.
    const avatars = harness.wrapper.getComponent(AgentPresenceAvatarsStub)
    expect(avatars.props('takeOverBadge')).toBeUndefined()
    takeOverBadge.value = { clientKey: 'key-claude', kind: 'offer' }
    await nextTick()
    expect(avatars.props('takeOverBadge')).toEqual({ clientKey: 'key-claude', kind: 'offer' })
  })

  it('offers the take over on the full-page band in place of the title', async () => {
    const harness = createHarness()
    harness.fullPage.toggle()
    await nextTick()
    const edge = () => harness.wrapper.find('[data-testid="full-page-edge"]')
    expect(edge().text()).toBe('Example')
    takeOverOfferText.value = 'Take over from Claude Code?'
    await nextTick()
    expect(edge().text()).toBe('Take over from Claude Code?')
    takeOverOfferText.value = ''
    await nextTick()
    expect(edge().text()).toBe('Example')
  })

  it('pins the live strip for the workspace in view and routes its actions like the agent card', async () => {
    const harness = createHarness()
    expect(harness.wrapper.findComponent(AgentLiveStripStub).exists()).toBe(false)
    // The card's switch pins it.
    harness.wrapper.getComponent(AgentPresenceAvatarsStub).vm.$emit('setPinLiveStatus', true)
    await flushPromises()
    expect(harness.setPinAgentLiveStatus).toHaveBeenCalledWith(true)
    await harness.wrapper.setProps({ userAttention: { id: 'attention-1', reason: 'Log in.', requestedAt: '2026-10-16T00:00:00.000Z', workspaceId: 'workspace-1', tabId: 'tab-1' } })
    const strip = harness.wrapper.getComponent(AgentLiveStripStub)
    expect(strip.props()).toMatchObject({
      workspaceId: 'workspace-1', attentionReason: 'Log in.', attentionId: 'attention-1', attentionDecision: false,
      attentionWorkspaceId: 'workspace-1', attentionTabId: 'tab-1', agentControlLocked: false
    })
    expect(strip.props('tabs')).toEqual(harness.props.state.tabs)

    strip.vm.$emit('handBack', 'attention-1')
    strip.vm.$emit('setPaused', 'tab-1', true)
    strip.vm.$emit('openCard')
    await flushPromises()
    expect(harness.browser.answerUserAttention).toHaveBeenCalledWith('attention-1', 'resolved')
    expect(harness.tabActions.setTabAgentPaused).toHaveBeenCalledWith('tab-1', true)
    // Pressing Answer takes focus from an open card, so the card is shown again as a new one.
    expect(openAgentCardSpy.mock.calls).toEqual([[{ reopen: true }]])
    strip.vm.$emit('takeOver', 'tab-1')
    await flushPromises()
    expect(harness.tabActions.selectBrowserTab).toHaveBeenCalledWith('tab-1')

    // Not on Home, under Settings or on a page outside a workspace.
    harness.activeIsHome.value = true
    await nextTick()
    expect(harness.wrapper.findComponent(AgentLiveStripStub).exists()).toBe(false)
    harness.activeIsHome.value = false
    harness.settingsOpen.value = true
    await nextTick()
    expect(harness.wrapper.findComponent(AgentLiveStripStub).exists()).toBe(false)
    harness.settingsOpen.value = false
    harness.runtimeActiveTab.value = tab({ id: 'tab-2' })
    await nextTick()
    expect(harness.wrapper.findComponent(AgentLiveStripStub).exists()).toBe(false)
    harness.runtimeActiveTab.value = tab({ mcpGroupId: 'workspace-1' })
    await nextTick()

    // Its chevron unpins it; focus, left on nothing once the strip is gone, goes to the agent's avatar.
    harness.wrapper.getComponent(AgentLiveStripStub).vm.$emit('unpin')
    await flushPromises()
    expect(harness.setPinAgentLiveStatus).toHaveBeenLastCalledWith(false)
    expect(harness.wrapper.findComponent(AgentLiveStripStub).exists()).toBe(false)
    expect(focusAgentAvatarSpy).toHaveBeenCalledOnce()

    // Focus you moved elsewhere meanwhile stays there.
    harness.settings.value = { ...harness.settings.value, pinAgentLiveStatus: true }
    await nextTick()
    const elsewhere = document.body.appendChild(document.createElement('input'))
    let finish!: () => void
    harness.setPinAgentLiveStatus.mockImplementationOnce(async (pin: boolean) => {
      await new Promise<void>((resolve) => { finish = resolve })
      harness.settings.value = { ...harness.settings.value, pinAgentLiveStatus: pin }
    })
    harness.wrapper.getComponent(AgentLiveStripStub).vm.$emit('unpin')
    elsewhere.focus()
    finish()
    await flushPromises()
    expect(document.activeElement).toBe(elsewhere)
    expect(focusAgentAvatarSpy).toHaveBeenCalledOnce()
    elsewhere.remove()
  })

  it('exposes the expanded vertical rail separator and forwards resize gestures', async () => {
    const harness = createHarness()
    const separator = () => harness.wrapper.find('[role="separator"]')

    expect(separator().exists()).toBe(false)
    harness.orientation.value = 'vertical'
    await nextTick()

    expect(separator().attributes()).toMatchObject({
      'aria-label': 'Resize workspace panel',
      'aria-orientation': 'vertical',
      'aria-valuemin': '200',
      'aria-valuemax': '480',
      'aria-valuenow': '280',
      tabindex: '0'
    })
    const pointerDown = new PointerEvent('pointerdown', { pointerId: 1, button: 0 })
    separator().element.dispatchEvent(pointerDown)
    expect(harness.tabRailResize.startResize).toHaveBeenCalledExactlyOnceWith(pointerDown)
    await separator().trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(harness.tabRailResize.resizeWithKeyboard).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ key: 'ArrowRight', shiftKey: true })
    )
    await separator().trigger('dblclick')
    expect(harness.tabRailResize.resetSize).toHaveBeenCalledOnce()

    harness.tabRailResize.resizing.value = true
    harness.tabRailResize.width.value = 328
    await nextTick()
    expect(separator().classes()).toContain('active')
    expect(separator().attributes('aria-valuenow')).toBe('328')

    harness.collapsed.value = true
    await nextTick()
    expect(separator().exists()).toBe(false)
    harness.wrapper.unmount()
  })

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
    expect(harness.wrapper.getComponent(BrowserTabsBarStub).props('workspaceSwitcherOpen')).toBe(false)
    expect(navigation.props('zoomOpen')).toBe(true)
    expect(address.props('siteControlsOpen')).toBe(true)
    expect(address.props('panelDock')).toBe('right')
    expect(address.props('keepsSeparatePanelOpen')).toBe(harness.keepsSeparatePanelOpen)
    expect(address.props('activeTab')).toEqual(harness.props.state.tabs[0])
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

    // The palette open on its workspace list marks the rail's switcher button, not the toolbar's Commands.
    await harness.wrapper.setProps({ commandPaletteOpen: true, workspaceSwitcherOpen: true })
    expect(topbar.props('commandPaletteOpen')).toBe(false)
    expect(harness.wrapper.getComponent(BrowserTabsBarStub).props('workspaceSwitcherOpen')).toBe(true)
    await harness.wrapper.setProps({ commandPaletteOpen: false, workspaceSwitcherOpen: false })
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

  it('routes independent agent and lifecycle actions through the tab controller', async () => {
    const harness = createHarness()
    const page = harness.wrapper.getComponent(BrowserPageActionsStub)
    const tab = harness.props.state.tabs[0]
    page.vm.$emit('toggleTabAgentPaused', tab)
    await nextTick()
    expect(harness.tabActions.toggleTabAgentPaused).toHaveBeenCalledWith(tab)
    expect(harness.tabActions.togglePageLifecycle).not.toHaveBeenCalled()
    page.vm.$emit('togglePageLifecycle', tab)
    await nextTick()
    expect(harness.tabActions.togglePageLifecycle).toHaveBeenCalledWith(tab)
    expect(harness.runAction).toHaveBeenCalledTimes(2)
  })

  it('shows the top bar\'s license reminder only while the license ask has one', async () => {
    const harness = createHarness()
    const topbar = harness.wrapper.getComponent(AppTopbarActionsStub)
    expect(topbar.props('licenseReminderShown')).toBe(false)
    harness.licenseReminderShown.value = true
    await nextTick()
    expect(topbar.props('licenseReminderShown')).toBe(true)
  })

  it('forwards every child event through the existing action boundary and closes tab search on select or drag', async () => {
    const harness = createHarness()
    const tabs = harness.wrapper.getComponent(BrowserTabsBarStub)
    const topbar = harness.wrapper.getComponent(AppTopbarActionsStub)
    const navigation = harness.wrapper.getComponent(BrowserNavigationControlsStub)
    const address = harness.wrapper.getComponent(BrowserAddressBarStub)
    const page = harness.wrapper.getComponent(BrowserPageActionsStub)
    const avatars = harness.wrapper.getComponent(AgentPresenceAvatarsStub)
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
    tabs.vm.$emit('switchWorkspace')

    topbar.vm.$emit('toggleCommandPalette')
    topbar.vm.$emit('toggleTabSearch')
    topbar.vm.$emit('toggleDownloads')
    topbar.vm.$emit('toggleHistory')
    topbar.vm.$emit('toggleAllTabsMuted')
    topbar.vm.$emit('toggleAllInteraction')
    topbar.vm.$emit('toggleFollowAgentActivity')
    topbar.vm.$emit('openUpdateSettings')
    topbar.vm.$emit('openLicenseSettings')
    topbar.vm.$emit('toggleSettings')

    for (const event of ['back', 'forward', 'reload', 'reloadIgnoringCache', 'stop'] as const) navigation.vm.$emit(event)
    navigation.vm.$emit('openInNewTab', 'back', false)
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
    // The rail's search icon opens the workspace switcher; the toolbar's Search tabs icon opens tab search.
    expect(harness.actions.toggleWorkspaceSwitcher).toHaveBeenCalledOnce()
    expect(harness.actions.toggleTabSearch).toHaveBeenCalledOnce()
    expect(harness.collectionActions.toggleDownloads).toHaveBeenCalledOnce()
    expect(harness.collectionActions.toggleVisitHistory).toHaveBeenCalledOnce()
    expect(harness.tabActions.toggleAllTabsMuted).toHaveBeenCalledOnce()
    expect(harness.tabActions.toggleAllHumanInteraction).toHaveBeenCalledOnce()
    expect(harness.settingsActions.toggleFollowAgentActivity).toHaveBeenCalledOnce()
    expect(harness.siteActions.openUpdateSettings).toHaveBeenCalledOnce()
    expect(harness.actions.openLicenseSettings).toHaveBeenCalledOnce()
    expect(harness.settingsActions.toggle).toHaveBeenCalledOnce()
    expect(harness.browser.back).toHaveBeenCalledOnce()
    expect(harness.browser.forward).toHaveBeenCalledOnce()
    expect(harness.browser.reload).toHaveBeenCalledOnce()
    expect(harness.browser.stop).toHaveBeenCalledOnce()
    expect(harness.browser.reloadIgnoringCache).toHaveBeenCalledOnce()
    // A middle-click on Back opens the page it goes to in a new tab beside the tab the toolbar shows.
    expect(harness.browser.openNavigationInNewTab).toHaveBeenCalledExactlyOnceWith({ tabId: 'tab-1', target: 'back', active: false })
    expect(harness.syncState).toHaveBeenCalledTimes(6)
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

    // The agent avatars follow the workspace of the page in view and select a tab like the tab bar.
    expect(avatars.props()).toMatchObject({ workspaceId: 'workspace-1', activeTabId: 'tab-1' })
    await harness.wrapper.setProps({ tabSearchOpen: true, userAttention: { id: 'attention-1', reason: 'Check the total.', requestedAt: '2026-10-16T00:00:00.000Z' } })
    expect(avatars.props()).toMatchObject({ attentionReason: 'Check the total.', attentionId: 'attention-1', attentionDecision: false })
    // The card's answers go to main with the id of the request they answer, and a decision opens its workspace.
    avatars.vm.$emit('answerAttention', 'attention-1', 'resolved')
    await nextTick()
    expect(harness.browser.answerUserAttention).toHaveBeenCalledWith('attention-1', 'resolved')
    avatars.vm.$emit('reviewDecision', 'workspace-1')
    expect(harness.actions.reviewDecisions).toHaveBeenCalledWith('workspace-1')
    await harness.wrapper.setProps({ userAttention: { id: 'attention-2', reason: 'Approve it.', requestedAt: '2026-10-16T00:00:00.000Z', humanWaitingDecisionId: 'decision-1' } })
    expect(avatars.props('attentionDecision')).toBe(true)
    avatars.vm.$emit('select', 'tab-2')
    await nextTick()
    expect(harness.wrapper.emitted('update:tabSearchOpen')?.at(-1)).toEqual([false])
    expect(harness.tabActions.selectBrowserTab).toHaveBeenCalledWith('tab-2')

    await harness.wrapper.setProps({ tabSearchOpen: true })
    tabs.vm.$emit('dragStart')
    await nextTick()
    expect(harness.wrapper.emitted('update:tabSearchOpen')?.at(-1)).toEqual([false])
    expect(harness.runAction).toHaveBeenCalled()
  })
})
