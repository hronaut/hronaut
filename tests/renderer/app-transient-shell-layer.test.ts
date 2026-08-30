import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppTransientShellLayer from '../../src/renderer/src/components/AppTransientShellLayer.vue'

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

function createHarness() {
  const handles = {
    tabSearch: { openPanel: vi.fn(async () => undefined), close: vi.fn() },
    find: { openForTab: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    zoom: { openForTab: vi.fn(async () => undefined), close: vi.fn(), setZoom: vi.fn(async () => undefined) },
    workspace: { openExisting: vi.fn(async () => undefined), openNew: vi.fn(async () => undefined), close: vi.fn() },
    credential: { openPanel: vi.fn(async () => undefined), close: vi.fn() },
    command: { openPanel: vi.fn(async () => undefined), close: vi.fn() }
  }
  const state = {
    tabs: [],
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
      mcpActivityByTab: {},
      credentials: [],
      collectionsController: { id: 'collections' } as never,
      activeUrl: null,
      activeTitle: '',
      activeOrigin: null,
      helpDialogOpen: false,
      settingsOpen: false,
      websiteAvailable: false,
      browser: {} as never,
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
      reportZoomError,
      onNewTab: newTab
    },
    global: {
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
        CommandPalette: exposedStub('CommandPalette', ['open', 'websiteAvailable', 'formatNumber', 'runCommand', 'reportCommandError'], handles.command)
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
      newTab
    }
  }
}

describe('AppTransientShellLayer', () => {
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
