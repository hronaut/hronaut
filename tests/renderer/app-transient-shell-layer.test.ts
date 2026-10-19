import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppTransientShellLayer from '../../src/renderer/src/components/AppTransientShellLayer.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

function exposedStub(name: string, props: string[], exposed: Record<string, unknown>) {
  return defineComponent({
    name,
    props,
    emits: ['update:open', 'new-tab', 'error'],
    setup(componentProps, { emit, expose }) {
      expose(exposed)
      return () => h('button', {
        'data-testid': name,
        onClick: () => {
          emit('update:open', false)
          if (name === 'TabSearchPanel') emit('new-tab')
          if (name === 'ZoomBar') emit('error', new Error('zoom failed'))
        }
      }, JSON.stringify(componentProps))
    }
  })
}

function createHarness(options: { browser?: object; locale?: 'en-US' | 'uk-UA' } = {}) {
  const handles = {
    tabSearch: { openPanel: vi.fn(async () => undefined), close: vi.fn() },
    find: { openForTab: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    zoom: { openForTab: vi.fn(async () => undefined), close: vi.fn(), setZoom: vi.fn(async () => undefined) },
    workspace: { openExisting: vi.fn(async () => undefined), openNew: vi.fn(async () => undefined), close: vi.fn() },
    credential: { openPanel: vi.fn(async () => undefined), close: vi.fn() },
    command: { openPanel: vi.fn(async () => undefined), close: vi.fn() },
    switcher: { openPanel: vi.fn(async () => undefined), close: vi.fn() }
  }
  const state = {
    tabs: [{ id: 'tab-9', mcpGroupId: 'workspace-1', title: 'Checkout', url: 'https://shop.example/checkout' }],
    closedTabs: [],
    savedTabGroups: [],
    mcpTabGroups: []
  }
  const syncState = vi.fn(async () => undefined)
  const selectTab = vi.fn(async () => undefined)
  const expandTabGroup = vi.fn()
  const describeEmulation = vi.fn(() => 'Desktop')
  const formatNumber = vi.fn(String)
  const formatTime = vi.fn(String)
  const formatPercent = vi.fn(String)
  const formatError = vi.fn(String)
  const showError = vi.fn()
  const fillCredential = vi.fn()
  const runCommand = vi.fn()
  const reportCommandError = vi.fn()
  const reportZoomError = vi.fn()
  const newTab = vi.fn()
  const searchTabs = vi.fn()
  const createWorkspace = vi.fn()
  const userAttention = { id: 'attention-1', workspaceId: 'workspace-1', reason: 'Sign in', requestedAt: '2026-10-16T00:00:00.000Z' }
  const wrapper = mount(AppTransientShellLayer, {
    props: {
      tabSearchOpen: true,
      findOpen: true,
      zoomOpen: true,
      workspaceEditorOpen: true,
      credentialPickerOpen: true,
      commandPaletteOpen: true,
      dock: 'right',
      state: state as never,
      activeTab: undefined,
      userAttention: userAttention as never,
      mcpActivityByTab: {},
      credentials: [],
      collectionsController: { id: 'collections' } as never,
      activeUrl: null,
      activeTitle: '',
      activeOrigin: null,
      helpDialogOpen: false,
      settingsOpen: false,
      websiteAvailable: false,
      browser: (options.browser ?? {}) as never,
      syncState,
      selectTab,
      expandTabGroup,
      describeEmulation,
      formatNumber,
      formatBytes: formatNumber,
      formatDateTime: formatTime,
      formatTime,
      formatPercent,
      formatError,
      showError,
      fillCredential,
      runCommand,
      reportCommandError,
      openSettingsSection: vi.fn(),
      reportZoomError,
      onNewTab: newTab,
      onSearchTabs: searchTabs,
      onCreateWorkspace: createWorkspace
    },
    global: {
      plugins: [createHronautI18n(options.locale ?? 'en-US')],
      stubs: {
        TabSearchPanel: exposedStub('TabSearchPanel', [
          'open', 'state', 'mcpActivityByTab', 'syncState', 'selectTab', 'expandTabGroup',
          'describeEmulation', 'formatNumber', 'formatTime', 'formatError', 'showError'
        ], handles.tabSearch),
        FindInPageBar: exposedStub('FindInPageBar', ['open', 'activeTab', 'browser'], handles.find),
        ZoomBar: exposedStub('ZoomBar', ['open', 'activeTab', 'browser', 'acceptState', 'formatPercent'], handles.zoom),
        AppBrowserCollectionsLayer: exposedStub('AppBrowserCollectionsLayer', [
          'dock', 'controller', 'activeUrl', 'activeTitle', 'currentBookmark', 'formatBytes',
          'formatPercent', 'formatDateTime', 'formatNumber'
        ], {}),
        WorkspaceEditor: exposedStub('WorkspaceEditor', ['open', 'state', 'syncState', 'formatNumber', 'canPresent'], handles.workspace),
        CredentialPicker: exposedStub('CredentialPicker', ['open', 'credentials', 'origin', 'fillCredential'], handles.credential),
        CommandPalette: exposedStub('CommandPalette', ['open', 'websiteAvailable', 'formatNumber', 'runCommand', 'reportCommandError'], handles.command),
        WorkspaceSwitcher: defineComponent({
          name: 'WorkspaceSwitcher',
          props: ['open', 'state', 'userAttention', 'browser', 'syncState', 'selectTab', 'expandTabGroup', 'formatNumber', 'formatError', 'showError'],
          emits: ['update:open', 'search-tabs', 'create-workspace'],
          setup(_props, { expose }) {
            expose(handles.switcher)
            return () => h('div', { 'data-testid': 'WorkspaceSwitcher' })
          }
        }),
        AgentStepsDialog: defineComponent({
          name: 'AgentStepsDialog',
          props: ['open', 'target', 'state', 'selectTab', 'formatTime', 'formatNumber', 'formatError', 'showError'],
          emits: ['update:open'],
          setup: () => () => h('div', { 'data-testid': 'AgentStepsDialog' })
        })
      }
    }
  })
  return {
    wrapper,
    handles,
    forwarded: {
      state,
      syncState,
      selectTab,
      expandTabGroup,
      describeEmulation,
      formatNumber,
      formatTime,
      formatPercent,
      formatError,
      showError,
      fillCredential,
      runCommand,
      reportCommandError,
      reportZoomError,
      newTab,
      searchTabs,
      createWorkspace,
      userAttention
    }
  }
}

describe('AppTransientShellLayer', () => {
  it('shows an agent\'s All steps on its own open state, opening a step\'s workspace before its tab', async () => {
    const { wrapper, forwarded } = createHarness()
    const dialog = () => wrapper.findComponent({ name: 'AgentStepsDialog' })
    expect(dialog().props()).toMatchObject({ open: false, target: null, state: forwarded.state, formatTime: forwarded.formatTime, showError: forwarded.showError })
    const target = { clientKey: 'AbCdEfGhIjKlMnOpQrSt-_', workspaceId: 'workspace-1' }
    await wrapper.setProps({ agentStepsOpen: true, agentStepsTarget: target })
    expect(dialog().props()).toMatchObject({ open: true, target })
    // The palette keeps its own state.
    expect(wrapper.findComponent({ name: 'CommandPalette' }).props('open')).toBe(true)

    await (dialog().props('selectTab') as (tabId: string) => Promise<unknown>)('tab-9')
    expect(forwarded.expandTabGroup).toHaveBeenCalledWith(forwarded.state.tabs[0])
    expect(forwarded.expandTabGroup.mock.invocationCallOrder[0]).toBeLessThan(forwarded.selectTab.mock.invocationCallOrder[0])
    expect(forwarded.selectTab).toHaveBeenCalledWith('tab-9')
    ;(dialog() as unknown as { vm: { $emit: (event: string, ...args: unknown[]) => void } }).vm.$emit('update:open', false)
    expect(wrapper.emitted('update:agentStepsOpen')?.at(-1)).toEqual([false])
  })

  it('owns every transient shell surface and preserves its wiring', async () => {
    const harness = createHarness()
    const { wrapper, forwarded } = harness

    expect(wrapper.findComponent({ name: 'TabSearchPanel' }).props()).toMatchObject({
      open: true,
      state: forwarded.state,
      syncState: forwarded.syncState,
      selectTab: forwarded.selectTab,
      expandTabGroup: forwarded.expandTabGroup,
      describeEmulation: forwarded.describeEmulation
    })
    expect(wrapper.findComponent({ name: 'WorkspaceEditor' }).props()).toMatchObject({
      open: true,
      state: forwarded.state,
      canPresent: false
    })
    expect(wrapper.findComponent({ name: 'CredentialPicker' }).props()).toMatchObject({
      open: true,
      origin: null,
      fillCredential: forwarded.fillCredential
    })
    expect(wrapper.findComponent({ name: 'CommandPalette' }).props()).toMatchObject({
      open: true,
      websiteAvailable: false,
      runCommand: forwarded.runCommand,
      reportCommandError: forwarded.reportCommandError
    })

    await wrapper.find('[data-testid="TabSearchPanel"]').trigger('click')
    await wrapper.find('[data-testid="ZoomBar"]').trigger('click')
    expect(wrapper.emitted('update:tabSearchOpen')?.at(-1)).toEqual([false])
    expect(forwarded.newTab).toHaveBeenCalledOnce()
    expect(forwarded.reportZoomError).toHaveBeenCalledOnce()
  })

  it('shows the palette as commands or as the workspace switcher, one at a time, on one open state', async () => {
    const { wrapper, handles, forwarded } = createHarness()
    // The two lists the palette shows, as the layer sees them: their props and what they emit.
    type List = { props: (key?: string) => unknown; vm: { $emit: (event: string, ...args: unknown[]) => void } }
    const commands = () => wrapper.findComponent({ name: 'CommandPalette' }) as unknown as List
    const switcher = () => wrapper.findComponent({ name: 'WorkspaceSwitcher' }) as unknown as List
    expect(commands().props('open')).toBe(true)
    expect(switcher().props()).toMatchObject({
      open: false,
      state: forwarded.state,
      userAttention: forwarded.userAttention,
      syncState: forwarded.syncState,
      selectTab: forwarded.selectTab,
      expandTabGroup: forwarded.expandTabGroup,
      showError: forwarded.showError
    })

    await wrapper.setProps({ commandPaletteView: 'workspaces' })
    expect(commands().props('open')).toBe(false)
    expect(switcher().props('open')).toBe(true)

    // A late close from the list not shown leaves the palette open.
    commands().vm.$emit('update:open', false)
    expect(wrapper.emitted('update:commandPaletteOpen')).toBeUndefined()
    switcher().vm.$emit('update:open', false)
    expect(wrapper.emitted('update:commandPaletteOpen')?.at(-1)).toEqual([false])

    // Opening one list shows it, from either list.
    commands().vm.$emit('update:open', true)
    expect(wrapper.emitted('update:commandPaletteView')?.at(-1)).toEqual(['commands'])
    expect(wrapper.emitted('update:commandPaletteOpen')?.at(-1)).toEqual([true])

    const surface = wrapper.vm as unknown as {
      openCommandPalette: (view?: 'commands' | 'workspaces') => Promise<void>
      closeCommandPalette: () => void
    }
    await surface.openCommandPalette('workspaces')
    expect(handles.switcher.openPanel).toHaveBeenCalledOnce()
    expect(handles.command.openPanel).not.toHaveBeenCalled()
    surface.closeCommandPalette()
    expect(handles.switcher.close).toHaveBeenCalledOnce()
    expect(handles.command.close).not.toHaveBeenCalled()

    switcher().vm.$emit('search-tabs')
    switcher().vm.$emit('create-workspace')
    expect(forwarded.searchTabs).toHaveBeenCalledOnce()
    expect(forwarded.createWorkspace).toHaveBeenCalledOnce()
  })

  it('names a failed workspace library request from Home in the interface language, without the IPC wrapper', async () => {
    // It used to show the English title "Workspaces" and Electron's "Error invoking remote method" prefix.
    let request: ((request: { view: 'edit'; workspaceId: string }) => void) | undefined
    const browser = { onHomeWorkspaceEditorRequested: (listener: typeof request) => { request = listener; return () => undefined } }
    const { wrapper, handles, forwarded } = createHarness({ browser, locale: 'uk-UA' })
    try {
      handles.workspace.openExisting.mockRejectedValueOnce(new Error("Error invoking remote method 'browser:workspace': Error: Збережені робочі простори недоступні."))
      request?.({ view: 'edit', workspaceId: 'workspace-1' })
      await vi.waitFor(() => expect(forwarded.showError).toHaveBeenCalledWith('Робочі простори', 'Збережені робочі простори недоступні.'))
    } finally { wrapper.unmount() }
  })

  it('exposes one stable imperative surface for all child handles', async () => {
    const { wrapper, handles } = createHarness()
    const surface = wrapper.vm as unknown as {
      openTabSearch: () => Promise<void>
      closeTabSearch: () => void
      openFindForTab: (tab: unknown) => Promise<void>
      closeFind: () => Promise<void>
      openZoomForTab: (tab: unknown) => Promise<void>
      closeZoom: () => void
      setZoom: (action: 'in' | 'out' | 'reset') => Promise<void>
      openWorkspace: (groupId: string) => Promise<void>
      openNewWorkspace: () => Promise<void>
      closeWorkspace: () => void
      openCredentialPicker: () => Promise<void>
      closeCredentialPicker: () => void
      openCommandPalette: () => Promise<void>
      closeCommandPalette: () => void
    }
    const tab = { id: 'tab-1' }

    await surface.openTabSearch()
    surface.closeTabSearch()
    await surface.openFindForTab(tab)
    await surface.closeFind()
    await surface.openZoomForTab(tab)
    surface.closeZoom()
    await surface.setZoom('reset')
    await surface.openWorkspace('workspace-1')
    await surface.openNewWorkspace()
    surface.closeWorkspace()
    await surface.openCredentialPicker()
    surface.closeCredentialPicker()
    await surface.openCommandPalette()
    surface.closeCommandPalette()

    expect(handles.tabSearch.openPanel).toHaveBeenCalledOnce()
    expect(handles.tabSearch.close).toHaveBeenCalledOnce()
    expect(handles.find.openForTab).toHaveBeenCalledWith(tab)
    expect(handles.find.close).toHaveBeenCalledOnce()
    expect(handles.zoom.openForTab).toHaveBeenCalledWith(tab)
    expect(handles.zoom.close).toHaveBeenCalledOnce()
    expect(handles.zoom.setZoom).toHaveBeenCalledWith('reset')
    expect(handles.workspace.openExisting).toHaveBeenCalledWith('workspace-1')
    expect(handles.workspace.openNew).toHaveBeenCalledOnce()
    expect(handles.workspace.close).toHaveBeenCalledOnce()
    expect(handles.credential.openPanel).toHaveBeenCalledOnce()
    expect(handles.credential.close).toHaveBeenCalledOnce()
    expect(handles.command.openPanel).toHaveBeenCalledOnce()
    expect(handles.command.close).toHaveBeenCalledOnce()
  })
})
