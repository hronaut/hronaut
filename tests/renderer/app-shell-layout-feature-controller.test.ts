import { computed, defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DetachablePanelId, PanelDock } from '../../src/shared/types.js'
import {
  useAppShellLayoutFeatureController,
  type AppShellLayoutFeatureController
} from '../../src/renderer/src/composables/useAppShellLayoutFeatureController.js'

interface Harness {
  controller: AppShellLayoutFeatureController
  wrapper: VueWrapper
  dock: Ref<PanelDock>
  modals: Record<'settings' | 'commandPalette' | 'helpDialog' | 'releaseHistory' | 'workspaceEditor' | 'credentialPicker' | 'walletApproval', Ref<boolean>>
  overlays: {
    updateNotice: Ref<boolean>
    find: Ref<boolean>
    zoom: Ref<boolean>
    activePanel: Ref<DetachablePanelId | null>
    addressSuggestions: Ref<boolean>
    tabSearch: Ref<boolean>
    downloads: Ref<boolean>
    history: Ref<boolean>
    splitMenu: Ref<boolean>
    siteControls: Ref<boolean>
    siteStorage: Ref<boolean>
    bookmarks: Ref<boolean>
  }
  separatePanel: Ref<boolean>
  closePanelsExcept: ReturnType<typeof vi.fn>
  closeAddressSuggestions: ReturnType<typeof vi.fn>
  setToolbarHeight: ReturnType<typeof vi.fn>
  setContentInsets: ReturnType<typeof vi.fn>
  setBrowserContentOccluded: ReturnType<typeof vi.fn>
  setWindowControlsScrim: ReturnType<typeof vi.fn>
}

const mountedWrappers: VueWrapper[] = []

function bounds(height = 105): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: 1200,
    bottom: height,
    left: 0,
    width: 1200,
    height,
    toJSON: () => ({})
  }
}

function createHarness(detachedWindow = false): Harness {
  const dock = ref<PanelDock>('right')
  const dockedPanelOpen = ref(true)
  const tabRailWidth = ref(240)
  const modals = {
    settings: ref(false),
    commandPalette: ref(false),
    helpDialog: ref(false),
    releaseHistory: ref(false),
    workspaceEditor: ref(false),
    credentialPicker: ref(false),
    walletApproval: ref(false)
  }
  const overlays = {
    updateNotice: ref(false),
    find: ref(false),
    zoom: ref(false),
    activePanel: ref<DetachablePanelId | null>(null),
    addressSuggestions: ref(false),
    tabSearch: ref(false),
    downloads: ref(false),
    history: ref(false),
    splitMenu: ref(false),
    siteControls: ref(false),
    siteStorage: ref(false),
    bookmarks: ref(false)
  }
  const separatePanel = ref(false)
  const closePanelsExcept = vi.fn()
  const closeAddressSuggestions = vi.fn()
  const setToolbarHeight = vi.fn()
  const setContentInsets = vi.fn()
  const setBrowserContentOccluded = vi.fn()
  const setWindowControlsScrim = vi.fn()
  let controller!: AppShellLayoutFeatureController
  const wrapper = mount(defineComponent({
    setup() {
      const shell = ref<HTMLElement | null>(null)
      controller = useAppShellLayoutFeatureController({
        layout: {
          dock,
          shell,
          dockedPanelOpen: computed(() => dockedPanelOpen.value),
          tabRailWidth: computed(() => tabRailWidth.value),
          detachedWindow,
          shellApi: { setToolbarHeight, setContentInsets, setBrowserContentOccluded, setWindowControlsScrim }
        },
        modals,
        overlays,
        keepsSeparatePanelOpen: () => separatePanel.value,
        closePanelsExcept,
        closeAddressSuggestions
      })
      return () => h('header', { ref: shell })
    }
  }))
  vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue(bounds())
  mountedWrappers.push(wrapper)
  return {
    controller,
    wrapper,
    dock,
    modals,
    overlays,
    separatePanel,
    closePanelsExcept,
    closeAddressSuggestions,
    setToolbarHeight,
    setContentInsets,
    setBrowserContentOccluded,
    setWindowControlsScrim
  }
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

describe('useAppShellLayoutFeatureController', () => {
  it('owns full-modal state and synchronously clears native address suggestions', () => {
    const harness = createHarness()

    for (const modal of Object.values(harness.modals)) {
      modal.value = true
      expect(harness.controller.fullModalOpen.value).toBe(true)
      expect(harness.closeAddressSuggestions).toHaveBeenCalledOnce()
      modal.value = false
      harness.closeAddressSuggestions.mockClear()
    }

    harness.modals.settings.value = true
    harness.controller.reportShellHeight()
    expect(harness.setToolbarHeight).toHaveBeenLastCalledWith(105)
    expect(harness.setContentInsets).toHaveBeenLastCalledWith({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    })
  })

  it('encodes preserved-panel priority and leaves separate panel windows alone', async () => {
    const harness = createHarness()

    harness.overlays.siteControls.value = true
    await nextTick()
    expect(harness.closePanelsExcept).toHaveBeenLastCalledWith('site-controls')

    harness.overlays.downloads.value = true
    await nextTick()
    expect(harness.closePanelsExcept).toHaveBeenLastCalledWith(null)

    harness.closePanelsExcept.mockClear()
    harness.separatePanel.value = true
    harness.overlays.history.value = true
    await nextTick()
    expect(harness.closePanelsExcept).not.toHaveBeenCalled()
  })

  it('dims the native window controls with the backdrop of a full-window dialog and restores them on close', async () => {
    const harness = createHarness()
    const backdrop = document.createElement('div')
    backdrop.style.position = 'fixed'
    backdrop.style.backgroundColor = 'rgba(4, 7, 12, 0.48)'
    const elementsFromPoint = vi.fn((): Element[] => [])
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: elementsFromPoint })
    try {
      // Search tabs and Create workspace draw their backdrop under the native controls in the top-right corner.
      for (const open of [harness.overlays.tabSearch, harness.modals.workspaceEditor]) {
        document.body.append(backdrop)
        elementsFromPoint.mockReturnValue([backdrop])
        open.value = true
        await nextTick()
        await nextTick()
        expect(harness.setWindowControlsScrim).toHaveBeenLastCalledWith('rgba(4, 7, 12, 0.48)')
        expect(elementsFromPoint).toHaveBeenLastCalledWith(window.innerWidth - 2, 2)

        backdrop.remove()
        elementsFromPoint.mockReturnValue([])
        open.value = false
        await nextTick()
        await nextTick()
        expect(harness.setWindowControlsScrim).toHaveBeenLastCalledWith(null)
      }
      expect(harness.setWindowControlsScrim).toHaveBeenCalledTimes(4)

      const detached = createHarness(true)
      document.body.append(backdrop)
      elementsFromPoint.mockReturnValue([backdrop])
      detached.modals.settings.value = true
      await nextTick()
      await nextTick()
      expect(detached.setWindowControlsScrim).not.toHaveBeenCalled()
    } finally {
      backdrop.remove()
      Reflect.deleteProperty(document, 'elementsFromPoint')
    }
  })

  it('does not send main-window content occlusion from a detached panel window', async () => {
    const harness = createHarness(true)

    harness.modals.walletApproval.value = true
    await nextTick()
    await nextTick()

    expect(harness.setBrowserContentOccluded).not.toHaveBeenCalled()
  })

  it('reports policy-owned layout changes and stops overlay reactions on disposal', async () => {
    const harness = createHarness()

    harness.overlays.updateNotice.value = true
    await nextTick()
    await nextTick()
    expect(harness.setToolbarHeight).toHaveBeenCalledOnce()

    harness.controller.dispose()
    harness.controller.dispose()
    harness.setToolbarHeight.mockClear()
    harness.closePanelsExcept.mockClear()
    harness.closeAddressSuggestions.mockClear()
    harness.overlays.updateNotice.value = false
    harness.overlays.siteStorage.value = true
    harness.modals.workspaceEditor.value = true
    harness.dock.value = 'bottom'
    await nextTick()
    await nextTick()

    expect(harness.setToolbarHeight).not.toHaveBeenCalled()
    expect(harness.closePanelsExcept).not.toHaveBeenCalled()
    expect(harness.closeAddressSuggestions).not.toHaveBeenCalled()
  })

  it('reveals a trusted wallet approval immediately without waiting for a window resize', async () => {
    const harness = createHarness()

    harness.modals.walletApproval.value = true
    await nextTick()
    await nextTick()

    expect(harness.setToolbarHeight).toHaveBeenLastCalledWith(105)
    expect(harness.setContentInsets).toHaveBeenLastCalledWith({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    })
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(true)
  })

  it("reveals What's new immediately above website content without waiting for a window resize", async () => {
    const harness = createHarness()

    harness.modals.releaseHistory.value = true
    await nextTick()
    await nextTick()

    expect(harness.controller.fullModalOpen.value).toBe(true)
    expect(harness.setToolbarHeight).toHaveBeenLastCalledWith(105)
    expect(harness.setContentInsets).toHaveBeenLastCalledWith({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    })
  })

  it('treats tab search as an immediately occluding full modal', async () => {
    const harness = createHarness()

    harness.overlays.addressSuggestions.value = true
    harness.overlays.tabSearch.value = true

    expect(harness.controller.fullModalOpen.value).toBe(true)
    expect(harness.closeAddressSuggestions).toHaveBeenCalledOnce()

    await nextTick()
    await nextTick()

    expect(harness.setToolbarHeight).toHaveBeenLastCalledWith(105)
    expect(harness.setContentInsets).toHaveBeenLastCalledWith({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    })
    expect(harness.setBrowserContentOccluded).toHaveBeenLastCalledWith(true)
  })
})
