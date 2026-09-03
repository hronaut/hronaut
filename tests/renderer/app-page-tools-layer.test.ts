import { fireEvent, render, screen } from '@testing-library/vue'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppPageToolsLayer from '../../src/renderer/src/components/AppPageToolsLayer.vue'
import type { BrowserTabState, PanelDock } from '../../src/shared/types.js'

function tab(): BrowserTabState {
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
    devToolsOpen: false
  }
}

function panelStub(testId: string, exposed: Record<string, unknown> = {}) {
  return defineComponent({
    props: { open: Boolean, dock: String },
    emits: ['update:open', 'update:dock'],
    setup(_props, { emit, expose }) {
      expose(exposed)
      return () => h('button', {
        'data-testid': testId,
        onClick: () => {
          emit('update:open', false)
          emit('update:dock', 'bottom')
        }
      })
    }
  })
}

function createHarness(websiteAvailable = true) {
  const activeTab = tab()
  const toggleSiteStorage = vi.fn()
  const toggleResponsivePreview = vi.fn()
  const toggleEnvironment = vi.fn()
  const toggleConsole = vi.fn()
  const toggleNetworkMonitor = vi.fn()
  const openRequestConditions = vi.fn()
  const toggleElementPicker = vi.fn()
  const copyPageSnapshot = vi.fn()
  const saveActivePdf = vi.fn()
  const fillSavedPassword = vi.fn()
  let pageToolsProps: Record<string, unknown> | undefined
  const PageToolsStub = defineComponent({
    props: {
      open: Boolean,
      dock: String,
      activeTab: Object,
      credentialCount: Number,
      actions: Object
    },
    emits: ['update:open', 'update:dock'],
    setup(props, { emit }) {
      pageToolsProps = props
      return () => h('button', {
        'data-testid': 'page-tools',
        onClick: () => {
          emit('update:open', false)
          emit('update:dock', 'left')
        }
      })
    }
  })
  const handles = {
    setResponsivePanel: vi.fn(),
    setConsolePanel: vi.fn(),
    setNetworkPanel: vi.fn(),
    setSiteStoragePanel: vi.fn()
  }
  const view = render(AppPageToolsLayer, {
    props: {
      websiteAvailable,
      activeTab,
      locale: 'en-US',
      handles,
      dock: 'right' as PanelDock,
      pageToolsOpen: true,
      responsivePanelOpen: true,
      environmentPanelOpen: true,
      consolePanelOpen: true,
      networkMonitorOpen: true,
      siteStorageOpen: true,
      activeTabController: {
        activeWebUrl: ref(activeTab.url),
        activeHostname: ref('example.test'),
        activeCredentials: ref([{ id: 'credential-1' }]),
        fillSavedPassword
      } as never,
      emulationController: {
        activeEmulation: ref(undefined),
        environmentState: ref('idle'),
        activeEnvironmentOverrideCount: ref(0),
        setResponsiveTabViewport: vi.fn(),
        beginEmulationMutation: vi.fn(),
        isEmulationMutationCurrent: vi.fn(),
        toggleResponsivePreview,
        toggleEnvironment,
        environmentController: {}
      } as never,
      pageToolsController: {
        diagnosticsController: {},
        elementPickerState: ref('idle'),
        elementPickerMode: ref('context'),
        areaCaptureState: ref('idle'),
        toggleElementPicker,
        pageSnapshotState: ref('idle'),
        pdfExportState: ref('idle'),
        copyPageSnapshot,
        saveActivePdf,
        pageToolsLabels: {},
        activeNetworkRouteCount: ref(0),
        activeInspectorIssueCount: ref(0),
        debugReportSignalCount: ref(0)
      } as never,
      panelController: { toggleConsole, toggleNetworkMonitor, openRequestConditions } as never,
      siteManagementController: { toggleSiteStorage } as never,
      credentialStorageAvailable: true,
      syncState: vi.fn(),
      copyText: vi.fn(),
      closeTransientPanels: vi.fn(),
      openSupport: vi.fn(),
      preservationBusy: false,
      updatePreservation: vi.fn(),
      keepsSeparatePanelOpen: vi.fn()
    },
    global: {
      stubs: {
        PageToolsPanel: PageToolsStub,
        ResponsivePreviewPanel: panelStub('responsive', {
          loadDraft: vi.fn(), resetFeedback: vi.fn(), toggle: vi.fn(), handleEscape: vi.fn()
        }),
        EnvironmentPanel: panelStub('environment'),
        DiagnosticsPanels: panelStub('diagnostics'),
        ConsolePanelContainer: panelStub('console', { reset: vi.fn(), refresh: vi.fn() }),
        NetworkPanel: panelStub('network', {
          reset: vi.fn(),
          refresh: vi.fn(),
          refreshRoutes: vi.fn(),
          refreshAll: vi.fn(),
          openRequestConditions: vi.fn()
        }),
        SiteStoragePanel: panelStub('site-storage', {
          reset: vi.fn(), refresh: vi.fn(), refreshActiveSiteStorageView: vi.fn()
        })
      }
    }
  })
  return {
    view,
    handles,
    pageToolsProps: () => pageToolsProps,
    actions: {
      toggleSiteStorage,
      toggleResponsivePreview,
      toggleEnvironment,
      toggleConsole,
      toggleNetworkMonitor,
      openRequestConditions,
      toggleElementPicker,
      copyPageSnapshot,
      saveActivePdf,
      fillSavedPassword
    }
  }
}

describe('app page tools layer', () => {
  it('keeps runtime panels mounted on Home while omitting the website-only Page Tools surface', () => {
    const harness = createHarness(false)

    expect(screen.queryByTestId('page-tools')).not.toBeInTheDocument()
    for (const panel of ['responsive', 'environment', 'diagnostics', 'console', 'network', 'site-storage']) {
      expect(screen.getByTestId(panel)).toBeInTheDocument()
    }
    for (const setter of Object.values(harness.handles)) expect(setter).toHaveBeenCalledWith(expect.anything())

    harness.view.unmount()
    for (const setter of Object.values(harness.handles)) expect(setter).toHaveBeenLastCalledWith(null)
  })

  it('preserves every model channel and the existing Page Tools action identities', async () => {
    const harness = createHarness()
    const actions = harness.pageToolsProps()?.actions as Record<string, unknown>

    expect(harness.pageToolsProps()?.activeTab).toEqual(tab())
    expect(harness.pageToolsProps()?.credentialCount).toBe(1)
    expect(actions).toMatchObject({
      toggleSiteStorage: harness.actions.toggleSiteStorage,
      toggleResponsivePreview: harness.actions.toggleResponsivePreview,
      toggleEnvironment: harness.actions.toggleEnvironment,
      toggleConsole: harness.actions.toggleConsole,
      toggleNetwork: harness.actions.toggleNetworkMonitor,
      openRequestConditions: harness.actions.openRequestConditions,
      toggleElementPicker: harness.actions.toggleElementPicker,
      copyPageSnapshot: harness.actions.copyPageSnapshot,
      savePdf: harness.actions.saveActivePdf,
      fillSavedPassword: harness.actions.fillSavedPassword
    })

    for (const panel of ['page-tools', 'responsive', 'environment', 'console', 'network', 'site-storage']) {
      await fireEvent.click(screen.getByTestId(panel))
    }
    expect(harness.view.emitted()['update:pageToolsOpen']?.at(-1)).toEqual([false])
    expect(harness.view.emitted()['update:responsivePanelOpen']?.at(-1)).toEqual([false])
    expect(harness.view.emitted()['update:environmentPanelOpen']?.at(-1)).toEqual([false])
    expect(harness.view.emitted()['update:consolePanelOpen']?.at(-1)).toEqual([false])
    expect(harness.view.emitted()['update:networkMonitorOpen']?.at(-1)).toEqual([false])
    expect(harness.view.emitted()['update:siteStorageOpen']?.at(-1)).toEqual([false])
    expect(harness.view.emitted()['update:dock']?.at(-1)).toEqual(['bottom'])
  })
})
