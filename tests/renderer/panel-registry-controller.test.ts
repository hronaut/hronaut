import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  usePanelRegistryController,
  type DetachablePanelRegistry
} from '../../src/renderer/src/composables/usePanelRegistryController.js'
import { DETACHABLE_PANEL_IDS, type DetachablePanelId } from '../../src/shared/types.js'

function create(initiallyOpen: readonly DetachablePanelId[] = []) {
  const panels = Object.fromEntries(
    DETACHABLE_PANEL_IDS.map((panel) => [panel, ref(initiallyOpen.includes(panel))])
  ) as DetachablePanelRegistry
  const onActivate = vi.fn<(panel: DetachablePanelId) => void>()
  const controller = usePanelRegistryController({ panels, onActivate })
  return { controller, panels, onActivate }
}

describe('panel registry controller', () => {
  it('reports the first active panel in shared contract order', () => {
    const { controller } = create(['network', 'environment'])
    expect(controller.activePanelId.value).toBe('environment')
    expect(controller.dockedPanelOpen.value).toBe(true)
  })

  it('activates one panel exclusively and announces it', () => {
    const { controller, panels, onActivate } = create(['console', 'bookmarks'])

    controller.activate('network')

    expect(DETACHABLE_PANEL_IDS.filter((panel) => panels[panel].value)).toEqual(['network'])
    expect(controller.activePanelId.value).toBe('network')
    expect(onActivate).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith('network')
  })

  it('makes the most recently opened direct panel exclusive', () => {
    const { controller, panels, onActivate } = create()

    panels.console.value = true
    panels.network.value = true

    expect(DETACHABLE_PANEL_IDS.filter((panel) => panels[panel].value)).toEqual(['network'])
    expect(controller.activePanelId.value).toBe('network')
    expect(onActivate.mock.calls.map(([panel]) => panel)).toEqual(['console', 'network'])
    controller.dispose()
  })

  it('closes every registered panel without an activation callback', () => {
    const { controller, panels, onActivate } = create(DETACHABLE_PANEL_IDS)

    controller.closeAll()

    expect(DETACHABLE_PANEL_IDS.some((panel) => panels[panel].value)).toBe(false)
    expect(controller.activePanelId.value).toBeNull()
    expect(controller.dockedPanelOpen.value).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('closes competing panels while preserving the overlay being opened', () => {
    const { controller, panels, onActivate } = create([
      'site-controls',
      'responsive-preview',
      'debug-report'
    ])

    controller.closeAllExcept('site-controls')

    expect(DETACHABLE_PANEL_IDS.filter((panel) => panels[panel].value)).toEqual(['site-controls'])
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('stops enforcing or announcing direct panel changes after disposal', () => {
    const { controller, panels, onActivate } = create()

    controller.dispose()
    panels.console.value = true
    panels.network.value = true

    expect(DETACHABLE_PANEL_IDS.filter((panel) => panels[panel].value)).toEqual(['console', 'network'])
    expect(onActivate).not.toHaveBeenCalled()
  })
})
