import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDeveloperPanelsShellController } from '../../src/renderer/src/composables/useDeveloperPanelsShellController.js'

function setup() {
  const consoleOpen = ref(false)
  const networkOpen = ref(false)
  const consolePanel = ref({
    reset: vi.fn(),
    refresh: vi.fn(async () => undefined)
  })
  const networkPanel = ref({
    reset: vi.fn(),
    refresh: vi.fn(async () => undefined),
    refreshRoutes: vi.fn(async () => undefined),
    refreshAll: vi.fn(async () => undefined),
    openRequestConditions: vi.fn(async () => undefined)
  })
  const closeTransientPanels = vi.fn()
  const controller = useDeveloperPanelsShellController({
    consoleOpen,
    consolePanel,
    networkOpen,
    networkPanel,
    closeTransientPanels,
    keepsSeparatePanelOpen: () => false
  })
  return { controller, consoleOpen, networkOpen, consolePanel, networkPanel, closeTransientPanels }
}

describe('useDeveloperPanelsShellController', () => {
  it('opens one developer panel after closing transient shell surfaces', () => {
    const harness = setup()

    harness.controller.toggleConsole()

    expect(harness.closeTransientPanels).toHaveBeenCalledOnce()
    expect(harness.consoleOpen.value).toBe(true)
    harness.controller.toggleConsole()
    expect(harness.consoleOpen.value).toBe(false)
    expect(harness.closeTransientPanels).toHaveBeenCalledOnce()
  })

  it('does not refresh a network panel that was closed again before it rendered', async () => {
    const harness = setup()

    const opening = harness.controller.toggleNetwork()
    const closing = harness.controller.toggleNetwork()
    await Promise.all([opening, closing])
    await nextTick()

    expect(harness.networkOpen.value).toBe(false)
    expect(harness.networkPanel.value.refreshAll).not.toHaveBeenCalled()
  })

  it('opens request conditions only after the network panel is available', async () => {
    const harness = setup()

    await harness.controller.openRequestConditions()

    expect(harness.networkOpen.value).toBe(true)
    expect(harness.networkPanel.value.openRequestConditions).toHaveBeenCalledOnce()
  })

  it('cancels queued request-condition work when the panel closes during render', async () => {
    const harness = setup()

    const opening = harness.controller.openRequestConditions()
    harness.networkOpen.value = false
    await opening

    expect(harness.networkPanel.value.openRequestConditions).not.toHaveBeenCalled()
  })

  it('resets panel-owned state and closes docked panels', () => {
    const harness = setup()
    harness.consoleOpen.value = true
    harness.networkOpen.value = true

    harness.controller.resetConsole(true)
    harness.controller.resetNetwork(true)

    expect(harness.consolePanel.value.reset).toHaveBeenCalledWith(true)
    expect(harness.networkPanel.value.reset).toHaveBeenCalledWith(true)
    expect(harness.consoleOpen.value).toBe(false)
    expect(harness.networkOpen.value).toBe(false)
  })
})
