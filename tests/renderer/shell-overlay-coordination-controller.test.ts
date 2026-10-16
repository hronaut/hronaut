import type { DetachablePanelId } from '../../src/shared/types.js'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { overlayExitHoldsPage, resetOverlayMotion, setPageSnapshotOnScreen } from '../../src/renderer/src/composables/overlay-motion.js'
import { useShellOverlayCoordinationController } from '../../src/renderer/src/composables/useShellOverlayCoordinationController.js'
import UiOverlayTransition from '../../src/renderer/src/ui/UiOverlayTransition.vue'

/** The occlusion watch waits for the render after a modal closes, which may not be queued yet. */
async function afterCloseRender(): Promise<void> {
  await nextTick()
  await nextTick()
}

afterEach(() => resetOverlayMotion())

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
    await afterCloseRender()
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(false)

    harness.fullModalOpen.value = true
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(true)

    harness.fullModalOpen.value = false
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(true)
    await afterCloseRender()
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
    await afterCloseRender()
    harness.fullModalOpen.value = true
    const transitions: string[] = []
    harness.reportLayout.mockImplementation(() => transitions.push('layout'))
    harness.setBrowserContentOccluded.mockImplementation((occluded: boolean) => transitions.push(occluded ? 'hide' : 'show'))
    harness.fullModalOpen.value = false
    expect(transitions).toEqual([])
    await afterCloseRender()
    expect(transitions).toEqual(['layout', 'show'])
    harness.controller.dispose()
  })

  it('keeps the page hidden through an exit that starts as the modal closes, without reporting the flip', async () => {
    const leaving = ref(false)
    const fullModalOpen = ref(false)
    const setBrowserContentOccluded = vi.fn()
    const reportLayout = vi.fn()
    const controller = useShellOverlayCoordinationController({
      activePanel: ref(null),
      splitMenu: ref(false),
      layoutSources: [],
      competingOverlayStates: [],
      preservedPanels: [],
      fullModalOpen,
      browserContentOccluded: computed(() => fullModalOpen.value || leaving.value),
      keepsSeparatePanelOpen: () => false,
      closePanelsExcept: vi.fn(),
      closeAddressSuggestions: vi.fn(),
      setBrowserContentOccluded,
      reportLayout
    })
    fullModalOpen.value = true
    expect(setBrowserContentOccluded.mock.calls).toEqual([[true]])

    // The modal closes, and its exit begins in the render that follows.
    fullModalOpen.value = false
    leaving.value = true
    await nextTick()
    expect(setBrowserContentOccluded.mock.calls).toEqual([[true]])
    expect(reportLayout).not.toHaveBeenCalled()

    leaving.value = false
    await afterCloseRender()
    expect(reportLayout).toHaveBeenCalledOnce()
    expect(setBrowserContentOccluded.mock.calls).toEqual([[true], [false]])
    controller.dispose()
  })

  it('keeps the page hidden through a real overlay exit that starts in the render after the close', async () => {
    const open = ref(false)
    const setBrowserContentOccluded = vi.fn()
    // Nothing else queues a render before the occlusion watch runs, as when the closing modal is no layout source.
    const wrapper = mount(defineComponent({
      setup() {
        useShellOverlayCoordinationController({
          activePanel: ref(null),
          splitMenu: ref(false),
          layoutSources: [],
          competingOverlayStates: [],
          preservedPanels: [],
          fullModalOpen: open,
          browserContentOccluded: computed(() => open.value || overlayExitHoldsPage.value),
          keepsSeparatePanelOpen: () => false,
          closePanelsExcept: vi.fn(),
          closeAddressSuggestions: vi.fn(),
          setBrowserContentOccluded,
          reportLayout: vi.fn()
        })
        return () => h(UiOverlayTransition, null, () => open.value ? h('div', { class: 'settings-overlay' }) : null)
      }
    }), { attachTo: document.body, global: { stubs: { transition: false } } })
    open.value = true
    await nextTick()
    setPageSnapshotOnScreen(true)
    setBrowserContentOccluded.mockClear()

    open.value = false
    await afterCloseRender()
    await Promise.resolve()
    // Reporting the page shown before the exit starts would bring it back over the dialog, then hide it again.
    expect(document.querySelector('.settings-overlay')?.classList.contains('ui-overlay-leave-active')).toBe(true)
    expect(setBrowserContentOccluded).not.toHaveBeenCalled()

    document.querySelector('.settings-overlay')?.dispatchEvent(new Event('animationend'))
    await vi.waitFor(() => expect(setBrowserContentOccluded.mock.calls).toEqual([[false]]))
    wrapper.unmount()
  })
})
