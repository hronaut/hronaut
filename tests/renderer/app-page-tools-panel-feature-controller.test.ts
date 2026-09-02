import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePageTools: vi.fn(),
  usePanel: vi.fn(),
  pageToolsDispose: vi.fn(),
  panelDispose: vi.fn()
}))
const diagnosticsController = { marker: 'diagnostics' }

vi.mock('../../src/renderer/src/composables/useAppPageToolsFeatureController.js', () => ({
  useAppPageToolsFeatureController: mocks.usePageTools
}))
vi.mock('../../src/renderer/src/composables/useAppPanelFeatureController.js', () => ({
  useAppPanelFeatureController: mocks.usePanel
}))

import { useAppPageToolsPanelFeatureController } from '../../src/renderer/src/composables/useAppPageToolsPanelFeatureController.js'

describe('app page-tools panel feature controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePageTools.mockReturnValue({
      diagnosticsController,
      dispose: mocks.pageToolsDispose
    })
    mocks.usePanel.mockReturnValue({
      transientPanelsController: { close: vi.fn() },
      activePanelId: ref(null),
      dockedPanelOpen: ref(false),
      closeDockedPanels: vi.fn(),
      closeDockedPanelsExcept: vi.fn(),
      resetConsoleView: vi.fn(),
      resetNetworkMonitorView: vi.fn(),
      dispose: mocks.panelDispose
    })
  })

  it('owns panel surface handles, controller wiring, and idempotent aggregate disposal', () => {
    const responsivePanel = ref(null)
    const setSiteStoragePanel = vi.fn()
    const options = {
      pageTools: { marker: 'page-tools' },
      panel: {
        registry: {
          siteControlsOpen: ref(false),
          siteStorageOpen: ref(false),
          responsivePanelOpen: ref(false),
          environmentPanelOpen: ref(false),
          bookmarksOpen: ref(false),
          onActivate: vi.fn()
        },
        transient: { marker: 'transient' },
        developer: { keepsSeparatePanelOpen: vi.fn() },
        detached: { marker: 'detached' },
        dock: { marker: 'dock' },
        onError: vi.fn()
      },
      responsivePanel,
      setSiteStoragePanel
    } as never

    const controller = useAppPageToolsPanelFeatureController(options)
    const responsiveHandle = { reset: vi.fn() }
    const consoleHandle = { reset: vi.fn(), refresh: vi.fn() }
    const networkHandle = { reset: vi.fn(), refresh: vi.fn() }

    controller.layerHandles.setResponsivePanel(responsiveHandle as never)
    controller.layerHandles.setConsolePanel(consoleHandle)
    controller.layerHandles.setNetworkPanel(networkHandle as never)
    controller.layerHandles.setSiteStoragePanel('storage' as never)

    expect(responsivePanel.value).toStrictEqual(responsiveHandle)
    expect(setSiteStoragePanel).toHaveBeenCalledWith('storage')
    const panelOptions = mocks.usePanel.mock.calls[0]?.[0] as {
      registry: { pageToolsOpen: unknown }
      developer: {
        consoleOpen: unknown
        consolePanel: { value: unknown }
        networkOpen: unknown
        networkPanel: { value: unknown }
      }
      detached: { diagnostics: unknown }
    }
    expect(panelOptions.registry.pageToolsOpen).toBe(controller.pageToolsOpen)
    expect(panelOptions.developer.consoleOpen).toBe(controller.consolePanelOpen)
    expect(panelOptions.developer.consolePanel.value).toStrictEqual(consoleHandle)
    expect(panelOptions.developer.networkOpen).toBe(controller.networkMonitorOpen)
    expect(panelOptions.developer.networkPanel.value).toStrictEqual(networkHandle)
    expect(panelOptions.detached.diagnostics).toBe(diagnosticsController)

    controller.dispose()
    controller.dispose()
    expect(mocks.panelDispose).toHaveBeenCalledOnce()
    expect(mocks.pageToolsDispose).toHaveBeenCalledOnce()
  })

  it('rolls back page-tool resources when panel composition fails', () => {
    mocks.usePanel.mockImplementationOnce(() => {
      throw new Error('panel registration failed')
    })

    expect(() => useAppPageToolsPanelFeatureController({
      pageTools: {},
      panel: {
        registry: {},
        transient: {},
        developer: {},
        detached: {},
        dock: {},
        onError: vi.fn()
      },
      responsivePanel: ref(null),
      setSiteStoragePanel: vi.fn()
    } as never)).toThrow('panel registration failed')

    expect(mocks.pageToolsDispose).toHaveBeenCalledOnce()
  })
})
