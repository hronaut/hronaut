import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  usePanelRegistryController,
  type DetachablePanelRegistry
} from '../../src/renderer/src/composables/usePanelRegistryController.js'
import { DETACHABLE_PANEL_IDS, type DetachablePanelId } from '../../src/shared/types.js'

function create() {
  const panels = Object.fromEntries(
    DETACHABLE_PANEL_IDS.map((panel) => [panel, ref(false)])
  ) as DetachablePanelRegistry
  const onActivate = vi.fn<(panel: DetachablePanelId) => void>()
  const controller = usePanelRegistryController({ panels, onActivate })
  return { controller, panels, onActivate }
}

describe('panel registry controller', () => {
  it('reports the first active panel in shared contract order', () => {
    const { controller, panels } = create()
    expect(controller.activePanelId.value).toBeNull()
    expect(controller.dockedPanelOpen.value).toBe(false)

    panels.network.value = true
    panels.environment.value = true
    expect(controller.activePanelId.value).toBe('environment')
    expect(controller.dockedPanelOpen.value).toBe(true)
  })

  it('activates one panel exclusively and announces it', () => {
    const { controller, panels, onActivate } = create()
    panels.console.value = true
    panels.bookmarks.value = true

    controller.activate('network')

    expect(DETACHABLE_PANEL_IDS.filter((panel) => panels[panel].value)).toEqual(['network'])
    expect(controller.activePanelId.value).toBe('network')
    expect(onActivate).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith('network')
  })

  it('closes every registered panel without an activation callback', () => {
    const { controller, panels, onActivate } = create()
    for (const panel of DETACHABLE_PANEL_IDS) panels[panel].value = true

    controller.closeAll()

    expect(DETACHABLE_PANEL_IDS.some((panel) => panels[panel].value)).toBe(false)
    expect(controller.activePanelId.value).toBeNull()
    expect(controller.dockedPanelOpen.value).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('closes competing panels while preserving the overlay being opened', () => {
    const { controller, panels, onActivate } = create()
    panels['site-controls'].value = true
    panels['responsive-preview'].value = true
    panels['debug-report'].value = true

    controller.closeAllExcept('site-controls')

    expect(DETACHABLE_PANEL_IDS.filter((panel) => panels[panel].value)).toEqual(['site-controls'])
    expect(onActivate).not.toHaveBeenCalled()
  })
})
