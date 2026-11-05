import { render } from '@testing-library/vue'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SidebarOverlayView from '../../src/renderer/src/components/SidebarOverlayView.vue'
import {
  runSidebarOverlayIntent,
  useChromeSidebarOverlay,
  type ChromeSidebarOverlayOptions,
  type SidebarOverlayCommands
} from '../../src/renderer/src/composables/useChromeSidebarOverlay.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { HronautSidebarOverlayApi, HronautSidebarOverlayViewApi, SidebarOverlayIntent, SidebarOverlayState } from '../../src/shared/sidebar-overlay.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

afterEach(() => { vi.unstubAllGlobals() })

const muted = { id: 'alpha', title: 'Alpha', url: 'https://alpha.example/' } as BrowserTabState

function commands(): SidebarOverlayCommands & { ran: Array<() => unknown> } {
  const ran: Array<() => unknown> = []
  const footer = Object.fromEntries(['command-palette', 'tab-search', 'downloads', 'history', 'all-tabs-muted', 'all-interaction', 'follow-agent-activity',
    'update-settings', 'license-settings', 'settings', 'mcp-pause'].map((action) => [action, vi.fn(() => action)])) as unknown as SidebarOverlayCommands['footer']
  return {
    ran,
    runAction: vi.fn(async (action: () => unknown) => {
      ran.push(action)
      await action()
      return true
    }),
    tabs: () => [muted],
    openHome: vi.fn(),
    selectTab: vi.fn(),
    closeTab: vi.fn(),
    toggleTabMuted: vi.fn(),
    stopWorkerCapture: vi.fn(),
    reorderTab: vi.fn(),
    newTabInWorkspace: vi.fn(),
    toggleWorkspace: vi.fn(),
    openNewWorkspaceEditor: vi.fn(),
    toggleWorkspaceSwitcher: vi.fn(),
    stayHere: vi.fn(),
    toggleRailPinned: vi.fn(),
    scrollTabList: vi.fn(),
    closeRail: vi.fn(),
    footer,
    openMcpSummary: vi.fn(),
    refuseOverlay: vi.fn()
  }
}

describe('what the person does in the rail over the page', () => {
  it('runs as the same click in the shell\'s own rail, through the chrome\'s action boundary where that click goes through it', async () => {
    const run = (intent: SidebarOverlayIntent, target: SidebarOverlayCommands) => runSidebarOverlayIntent(intent, target)
    const c = commands()
    run({ kind: 'open-home' }, c)
    run({ kind: 'close-tab', tabId: 'alpha' }, c)
    run({ kind: 'toggle-tab-muted', tabId: 'alpha' }, c)
    run({ kind: 'reorder-tab', tabId: 'alpha', targetTabId: 'beta', placement: 'after' }, c)
    run({ kind: 'new-tab', workspaceId: 'research' }, c)
    run({ kind: 'new-tab' }, c)
    run({ kind: 'create-workspace' }, c)
    run({ kind: 'switch-workspace' }, c)
    run({ kind: 'footer', action: 'downloads' }, c)
    run({ kind: 'footer', action: 'mcp-pause' }, c)
    await Promise.resolve()
    expect(c.ran).toHaveLength(10)
    expect(c.openHome).toHaveBeenCalledOnce()
    expect(c.closeTab).toHaveBeenCalledWith('alpha')
    expect(c.toggleTabMuted).toHaveBeenCalledWith(muted)
    expect(c.reorderTab).toHaveBeenCalledWith({ tabId: 'alpha', targetTabId: 'beta', placement: 'after' })
    expect(vi.mocked(c.newTabInWorkspace).mock.calls).toEqual([['research'], [undefined]])
    expect(c.openNewWorkspaceEditor).toHaveBeenCalledOnce()
    expect(c.toggleWorkspaceSwitcher).toHaveBeenCalledOnce()
    expect(c.footer.downloads).toHaveBeenCalledOnce()
    expect(c.footer['mcp-pause']).toHaveBeenCalledOnce()
    expect(c.footer.settings).not.toHaveBeenCalled()
    // A tab the shell no longer has is not muted.
    run({ kind: 'toggle-tab-muted', tabId: 'gone' }, c)
    expect(c.ran).toHaveLength(10)
  })

  it('runs the rail\'s own changes at once, and leaves menus to main', () => {
    const c = commands()
    runSidebarOverlayIntent({ kind: 'select-tab', tabId: 'alpha' }, c)
    runSidebarOverlayIntent({ kind: 'stop-worker-capture', tabId: 'alpha' }, c)
    runSidebarOverlayIntent({ kind: 'toggle-workspace', workspaceId: 'research' }, c)
    runSidebarOverlayIntent({ kind: 'stay-here' }, c)
    runSidebarOverlayIntent({ kind: 'toggle-rail-pinned' }, c)
    runSidebarOverlayIntent({ kind: 'scroll', top: 120 }, c)
    runSidebarOverlayIntent({ kind: 'dismiss' }, c)
    runSidebarOverlayIntent({ kind: 'tab-context-menu', tabId: 'alpha' }, c)
    runSidebarOverlayIntent({ kind: 'workspace-context-menu', workspaceId: 'research' }, c)
    expect(c.selectTab).toHaveBeenCalledWith('alpha')
    expect(c.stopWorkerCapture).toHaveBeenCalledWith('alpha')
    expect(c.toggleWorkspace).toHaveBeenCalledWith('research')
    expect(c.stayHere).toHaveBeenCalledOnce()
    expect(c.toggleRailPinned).toHaveBeenCalledOnce()
    expect(c.scrollTabList).toHaveBeenCalledWith(120)
    expect(c.closeRail).toHaveBeenCalledOnce()
    expect(c.runAction).not.toHaveBeenCalled()
  })

  it('opens the agent service summary from the shell\'s own rail, which opens beside the page for it', async () => {
    const c = commands()
    runSidebarOverlayIntent({ kind: 'footer', action: 'mcp-summary' }, c)
    expect(c.refuseOverlay).toHaveBeenCalledOnce()
    expect(c.openMcpSummary).not.toHaveBeenCalled()
    await nextTick()
    expect(c.openMcpSummary).toHaveBeenCalledOnce()
    expect(c.runAction).not.toHaveBeenCalled()
  })
})

describe('the rail over the page in the browser chrome', () => {
  function chrome() {
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: () => void) { observers.push(() => this.callback()) }
      observe(): void {}
      disconnect(): void {}
    })
    const show = vi.fn<HronautSidebarOverlayApi['show']>()
    const api: HronautSidebarOverlayApi = { show, hide: vi.fn(), onEvent: () => () => undefined }
    const topbar = document.createElement('div')
    topbar.style.paddingTop = '44px'
    document.body.append(topbar)
    const overlaid = ref(false)
    const available = vi.fn()
    const state = { tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', mcpTabGroups: [], savedTabGroups: [] } as BrowserState
    const options: ChromeSidebarOverlayOptions = {
      api,
      agentPresenceApi: undefined,
      platform: 'linux',
      shell: {
        verticalTabRailOverlaid: overlaid,
        expandedTabRailWidth: ref(280),
        setVerticalTabRailOverlayAvailable: available,
        delegateVerticalTabRail: vi.fn(),
        setVerticalTabRailOverlayPointer: vi.fn(),
        refuseVerticalTabRailOverlay: vi.fn()
      },
      fullPageActive: ref(false),
      topbar: ref(topbar),
      rail: () => ({
        locale: 'en-US',
        state,
        settingsActive: false,
        workspaceSwitcherOpen: false,
        userAttention: null,
        collapsedWorkspaceIds: [],
        scrollTop: 0,
        mcpActivityByTab: {},
        tabTooltip: (tab) => tab.title,
        describeEmulation: () => '',
        footer: {
          commandPaletteOpen: false,
          downloadsOpen: false,
          historyOpen: false,
          settingsOpen: false,
          downloads: [],
          activeDownloads: [],
          downloadButtonLabel: 'Downloads',
          hasWebsiteTabs: false,
          allTabsMuted: false,
          allInteractionLocked: false,
          allInteractionLockLabel: 'Lock',
          interactionPending: false,
          audioPending: false,
          followAgentActivity: false,
          showUpdateStatus: false,
          updateState: { status: 'idle', currentVersion: '1.0.0' },
          licenseReminderShown: false,
          mcpEndpoint: '',
          mcpState: { status: 'ready', paused: false },
          mcpPauseBusy: false
        }
      }),
      commands: commands()
    }
    const scope = effectScope()
    scope.run(() => useChromeSidebarOverlay(options))
    const tops = () => show.mock.calls.map(([request]) => request.model.top)
    return { topbar, overlaid, available, observers, tops, show, dispose: () => { scope.stop(); topbar.remove() } }
  }

  it('starts the rail over the page below the title bar, which can grow while the rail is open', async () => {
    const h = chrome()
    try {
      expect(h.available).toHaveBeenCalledWith(true)
      h.overlaid.value = true
      await nextTick()
      expect(h.tops()).toEqual([44])
      // The window controls grow with the interface scale, and the title bar's room with them.
      h.topbar.style.paddingTop = '60px'
      for (const observed of h.observers) observed()
      await nextTick()
      expect(h.tops()).toEqual([44, 60])
    } finally { h.dispose() }
  })

  it('draws the rail over the page in the language of the latest state, once its messages are loaded', async () => {
    const h = chrome()
    Object.defineProperty(document, 'fonts', { value: { status: 'loaded', ready: Promise.resolve() }, configurable: true })
    try {
      h.overlaid.value = true
      await nextTick()
      const model = h.show.mock.calls[0]![0].model
      let receive!: (state: SidebarOverlayState) => void
      const rendered = vi.fn()
      const api: HronautSidebarOverlayViewApi = {
        onState: (listener) => { receive = listener; return () => undefined },
        rendered,
        pointer: vi.fn(),
        intent: vi.fn(),
        showTooltip: vi.fn(),
        hideTooltip: vi.fn()
      }
      const i18n = createHronautI18n('en-US')
      const view = render(SidebarOverlayView, { props: { api }, global: { plugins: [i18n] } })
      receive({ revision: 1, session: 1, model: { ...model, locale: 'fr-FR' } })
      await vi.waitFor(() => expect(rendered).toHaveBeenCalledWith({ revision: 1 }))
      expect(document.querySelector('.app-home-label')).toHaveTextContent('Accueil')
      expect(document.documentElement.lang).toBe('fr-FR')

      // German is asked for, then French again before German is loaded: French, the latest, stays.
      receive({ revision: 2, session: 1, model: { ...model, locale: 'de-DE' } })
      receive({ revision: 3, session: 1, model: { ...model, locale: 'fr-FR' } })
      await vi.waitFor(() => expect(rendered).toHaveBeenCalledWith({ revision: 3 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(i18n.global.locale.value).toBe('fr-FR')
      expect(document.querySelector('.app-home-label')).toHaveTextContent('Accueil')
      expect(rendered).not.toHaveBeenCalledWith({ revision: 2 })
      view.unmount()
    } finally {
      Reflect.deleteProperty(document, 'fonts')
      h.dispose()
    }
  })
})
