import type { DetachablePanelId } from '../../src/shared/types.js'
import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useShellOverlayCoordinationController } from '../../src/renderer/src/composables/useShellOverlayCoordinationController.js'

function createHarness(separatePanel = false) {
  const activePanel = ref<DetachablePanelId | null>(null)
  const splitMenu = ref(false)
  const separate = ref(separatePanel)
  const settingsOpen = ref(false)
  const siteControlsOpen = ref(false)
  const siteStorageOpen = ref(false)
  const bookmarksOpen = ref(false)
  const downloadsOpen = ref(false)
  const fullModalOpen = ref(false)
  const closePanelsExcept = vi.fn()
  const closeAddressSuggestions = vi.fn()
  const setBrowserContentOccluded = vi.fn()
  const reportLayout = vi.fn()
  const controller = useShellOverlayCoordinationController({
    activePanel,
    splitMenu,
    layoutSources: [settingsOpen, siteControlsOpen, downloadsOpen],
    competingOverlayStates: [settingsOpen, siteControlsOpen, siteStorageOpen, bookmarksOpen, downloadsOpen],
    preservedPanels: [
      { panel: 'site-controls', open: siteControlsOpen },
      { panel: 'site-storage', open: siteStorageOpen },
      { panel: 'bookmarks', open: bookmarksOpen }
    ],
    fullModalOpen,
    keepsSeparatePanelOpen: () => separate.value,
    closePanelsExcept,
    closeAddressSuggestions,
    setBrowserContentOccluded,
    reportLayout
  })
  return {
    activePanel, splitMenu, separate,
    bookmarksOpen,
    closeAddressSuggestions,
    closePanelsExcept,
    controller,
    downloadsOpen,
    fullModalOpen,
    reportLayout,
    setBrowserContentOccluded,
    settingsOpen,
    siteControlsOpen,
    siteStorageOpen
  }
}

describe('shell overlay coordination controller', () => {
  it('releases Split view space when a docked panel opens and permits reopening after close', () => {
    const harness = createHarness()
    harness.splitMenu.value = true
    harness.activePanel.value = 'page-tools'
    expect(harness.splitMenu.value).toBe(false)
    harness.activePanel.value = null
    harness.splitMenu.value = true
    expect(harness.splitMenu.value).toBe(true)
    harness.controller.dispose()
    harness.activePanel.value = 'page-tools'
    expect(harness.splitMenu.value).toBe(true)
  })

  it('preserves Split view with a detached panel and closes it when the panel docks', () => {
    const harness = createHarness(true)
    harness.splitMenu.value = true
    harness.activePanel.value = 'page-tools'
    expect(harness.splitMenu.value).toBe(true)
    harness.separate.value = false
    expect(harness.splitMenu.value).toBe(false)
    harness.controller.dispose()
  })

  it('preserves the registered panel represented by a newly opened overlay', async () => {
    const harness = createHarness()

    harness.siteControlsOpen.value = true
    await nextTick()

    expect(harness.closePanelsExcept).toHaveBeenCalledWith('site-controls')
  })

  it('closes every docked panel for overlays that are not panels', async () => {
    const harness = createHarness()

    harness.downloadsOpen.value = true
    await nextTick()

    expect(harness.closePanelsExcept).toHaveBeenCalledWith(null)
  })

  it('gives a non-panel overlay priority over a stale panel-backed overlay', async () => {
    const harness = createHarness()
    harness.siteControlsOpen.value = true
    await nextTick()
    harness.closePanelsExcept.mockClear()

    harness.settingsOpen.value = true
    await nextTick()

    expect(harness.closePanelsExcept).toHaveBeenCalledWith(null)
  })

  it('leaves detached panels alone', async () => {
    const harness = createHarness(true)

    harness.settingsOpen.value = true
    await nextTick()

    expect(harness.closePanelsExcept).not.toHaveBeenCalled()
  })

  it('dismisses native address suggestions synchronously before a full modal opens', () => {
    const harness = createHarness()

    harness.fullModalOpen.value = true

    expect(harness.closeAddressSuggestions).toHaveBeenCalledOnce()
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(true)
  })

  it('keeps native website content occluded until the modal has left the DOM', async () => {
    const harness = createHarness()
    await nextTick()
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(false)

    harness.fullModalOpen.value = true
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(true)

    harness.fullModalOpen.value = false
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(true)
    await nextTick()
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(false)
  })

  it('reports layout after rendering and stops every reaction on disposal', async () => {
    const harness = createHarness()

    harness.settingsOpen.value = true
    expect(harness.reportLayout).not.toHaveBeenCalled()
    await nextTick()
    await nextTick()
    expect(harness.reportLayout).toHaveBeenCalledOnce()

    harness.controller.dispose()
    harness.settingsOpen.value = false
    harness.siteControlsOpen.value = true
    harness.fullModalOpen.value = true
    await nextTick()

    expect(harness.reportLayout).toHaveBeenCalledOnce()
    expect(harness.closePanelsExcept).toHaveBeenCalledTimes(1)
    expect(harness.closeAddressSuggestions).not.toHaveBeenCalled()
  })

  it('restores page geometry before revealing native content after a modal closes', async () => {
    const harness = createHarness()
    await nextTick()
    harness.fullModalOpen.value = true
    const transitions: string[] = []
    harness.reportLayout.mockImplementation(() => transitions.push('layout'))
    harness.setBrowserContentOccluded.mockImplementation((occluded: boolean) => transitions.push(occluded ? 'hide' : 'show'))
    harness.fullModalOpen.value = false
    expect(transitions).toEqual([])
    await nextTick()
    expect(transitions).toEqual(['layout', 'show'])
    harness.controller.dispose()
  })
})
