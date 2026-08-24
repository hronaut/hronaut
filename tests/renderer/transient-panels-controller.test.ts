import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTransientPanelsController } from '../../src/renderer/src/composables/useTransientPanelsController.js'

function createController(shouldCloseDockedPanels = true) {
  const panels = {
    addressSuggestionsOpen: ref(true),
    zoomOpen: ref(true),
    downloadsOpen: ref(true),
    historyOpen: ref(true),
    tabSearchOpen: ref(true),
    updateNoticeOpen: ref(true),
    findOpen: ref(true)
  }
  const closeDockedPanels = vi.fn()
  const closeFind = vi.fn(async () => undefined)
  const onError = vi.fn()
  const controller = useTransientPanelsController({
    shouldCloseDockedPanels: () => shouldCloseDockedPanels,
    closeDockedPanels,
    ...panels,
    closeFind,
    onError
  })
  return { controller, panels, closeDockedPanels, closeFind, onError }
}

describe('useTransientPanelsController', () => {
  it('closes every transient surface and starts Find cleanup', () => {
    const harness = createController()

    harness.controller.close()

    expect(Object.values(harness.panels).every((panel) => !panel.value)).toBe(true)
    expect(harness.closeDockedPanels).toHaveBeenCalledOnce()
    expect(harness.closeFind).toHaveBeenCalledOnce()
  })

  it('leaves a separate panel window open while closing overlay surfaces', () => {
    const harness = createController(false)

    harness.controller.close()

    expect(harness.closeDockedPanels).not.toHaveBeenCalled()
    expect(Object.values(harness.panels).every((panel) => !panel.value)).toBe(true)
  })

  it('skips redundant Find cleanup when Find is already closed', () => {
    const harness = createController()
    harness.panels.findOpen.value = false

    harness.controller.close()

    expect(harness.closeFind).not.toHaveBeenCalled()
  })

  it('can preserve Find while closing every competing transient surface', () => {
    const harness = createController()

    harness.controller.close({ preserveFind: true })

    expect(harness.panels.findOpen.value).toBe(true)
    expect(Object.entries(harness.panels)
      .filter(([name]) => name !== 'findOpen')
      .every(([, panel]) => !panel.value)).toBe(true)
    expect(harness.closeDockedPanels).toHaveBeenCalledOnce()
    expect(harness.closeFind).not.toHaveBeenCalled()
  })

  it('reports asynchronous Find cleanup failures after closing the UI', async () => {
    const harness = createController()
    const failure = new Error('stopFindInPage failed')
    harness.closeFind.mockRejectedValueOnce(failure)

    harness.controller.close()
    await Promise.resolve()

    expect(harness.panels.findOpen.value).toBe(false)
    expect(harness.onError).toHaveBeenCalledWith(failure)
  })
})
