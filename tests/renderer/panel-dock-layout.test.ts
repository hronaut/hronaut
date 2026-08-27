import { computed, defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelDock } from '../../src/shared/types.js'
import { usePanelDockLayout } from '../../src/renderer/src/composables/usePanelDockLayout.js'

type Controller = ReturnType<typeof usePanelDockLayout>

interface Harness {
  controller: Controller
  dock: Ref<PanelDock>
  modalOpen: Ref<boolean>
  setToolbarHeight: ReturnType<typeof vi.fn>
  setContentInsets: ReturnType<typeof vi.fn>
  wrapper: VueWrapper
}

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight
const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

function bounds(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: 1200,
    bottom: 105,
    left: 0,
    width: 1200,
    height: 105,
    toJSON: () => ({}),
    ...overrides
  }
}

function mountHarness(initialDock: PanelDock = 'right', tabRailWidth = 0): Harness {
  const dock = ref<PanelDock>(initialDock)
  const modalOpen = ref(false)
  const panelOpen = ref(true)
  const setToolbarHeight = vi.fn()
  const setContentInsets = vi.fn()
  let controller!: Controller
  const wrapper = mount(defineComponent({
    setup() {
      const shell = ref<HTMLElement | null>(null)
      controller = usePanelDockLayout({
        dock,
        shell,
        dockedPanelOpen: computed(() => panelOpen.value),
        fullModalOpen: computed(() => modalOpen.value),
        tabRailWidth: computed(() => tabRailWidth),
        detachedWindow: false,
        shellApi: { setToolbarHeight, setContentInsets }
      })
      return () => h('header', { ref: shell })
    }
  }))
  vi.spyOn(wrapper.element, 'getBoundingClientRect').mockReturnValue(bounds())
  return { controller, dock, modalOpen, setToolbarHeight, setContentInsets, wrapper }
}

function resizeHandle() {
  const captured = new Set<number>()
  const handle = document.createElement('div')
  const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId))
  const releasePointerCapture = vi.fn((pointerId: number) => captured.delete(pointerId))
  Object.defineProperties(handle, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: (pointerId: number) => captured.has(pointerId) },
    releasePointerCapture: { configurable: true, value: releasePointerCapture }
  })
  return { handle, setPointerCapture, releasePointerCapture }
}

function pointerEvent(handle: HTMLElement, details: Partial<PointerEvent>): PointerEvent {
  return {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    currentTarget: handle,
    preventDefault: vi.fn(),
    ...details
  } as unknown as PointerEvent
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
})

describe('usePanelDockLayout', () => {
  it('composes a vertical tab rail with docked panel insets', async () => {
    const right = mountHarness('right', 280)
    right.controller.reportShellHeight()
    expect(right.setContentInsets).toHaveBeenLastCalledWith({ top: 0, right: 480, bottom: 0, left: 280 })
    right.wrapper.unmount()

    const left = mountHarness('left', 280)
    left.controller.reportShellHeight()
    expect(left.setContentInsets).toHaveBeenLastCalledWith({ top: 0, right: 0, bottom: 0, left: 760 })
    left.wrapper.unmount()
  })

  it('restores independent dock sizes and removes page insets while a full modal is open', async () => {
    window.localStorage.setItem('hronaut:panel-dock-size-horizontal', '530')
    window.localStorage.setItem('hronaut:panel-dock-size-vertical', '290')
    const harness = mountHarness()

    harness.controller.reportShellHeight()
    expect(harness.controller.size.value).toBe(530)
    expect(harness.setToolbarHeight).toHaveBeenLastCalledWith(105)
    expect(harness.setContentInsets).toHaveBeenLastCalledWith({ top: 0, right: 530, bottom: 0, left: 0 })

    harness.dock.value = 'bottom'
    await nextTick()
    await nextTick()
    expect(harness.controller.size.value).toBe(290)
    expect(harness.setContentInsets).toHaveBeenLastCalledWith({ top: 0, right: 0, bottom: 290, left: 0 })

    harness.modalOpen.value = true
    harness.controller.reportShellHeight()
    expect(harness.setToolbarHeight).toHaveBeenLastCalledWith(800)
    expect(harness.setContentInsets).toHaveBeenLastCalledWith({ top: 0, right: 0, bottom: 0, left: 0 })
    harness.wrapper.unmount()
  })

  it('falls back to default dock sizes when local preference storage cannot be read', () => {
    const storage = memoryStorage()
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('local preferences unavailable')
    })
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })

    let harness: Harness | undefined
    expect(() => {
      harness = mountHarness()
    }).not.toThrow()
    harness?.controller.reportShellHeight()
    expect(harness?.controller.size.value).toBe(480)
    harness?.wrapper.unmount()
  })

  it('finishes resize and reset actions when local preference storage cannot be written', () => {
    const storage = memoryStorage()
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('local preferences unavailable')
    })
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new Error('local preferences unavailable')
    })
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
    const harness = mountHarness()
    harness.controller.reportShellHeight()
    const { handle } = resizeHandle()

    harness.controller.startResize(pointerEvent(handle, { pointerId: 9, clientX: 700 }))
    expect(() => {
      harness.controller.finishResize(pointerEvent(handle, { pointerId: 9, clientX: 620 }))
    }).not.toThrow()
    expect(harness.controller.resizeGesture.value).toBeNull()
    expect(() => harness.controller.resetSize()).not.toThrow()
    harness.wrapper.unmount()
  })

  it('finishes a resize against its starting axis when the panel is redocked mid-gesture', async () => {
    const harness = mountHarness()
    harness.controller.reportShellHeight()
    const { handle, releasePointerCapture } = resizeHandle()

    harness.controller.startResize(pointerEvent(handle, { pointerId: 7, clientX: 700 }))
    harness.controller.moveResize(pointerEvent(handle, { pointerId: 7, clientX: 620 }))
    expect(harness.controller.size.value).toBe(560)

    harness.dock.value = 'bottom'
    await nextTick()
    expect(harness.controller.resizeGesture.value).toBeNull()
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(window.localStorage.getItem('hronaut:panel-dock-size-horizontal')).toBe('560')
    expect(window.localStorage.getItem('hronaut:panel-dock-size-vertical')).toBeNull()
    expect(harness.controller.size.value).toBe(360)

    harness.controller.moveResize(pointerEvent(handle, { pointerId: 7, clientY: 500 }))
    expect(window.localStorage.getItem('hronaut:panel-dock-size-vertical')).toBeNull()
    harness.wrapper.unmount()
  })

  it('cleans up on lost pointer capture and on component disposal', () => {
    const harness = mountHarness()
    harness.controller.reportShellHeight()
    const first = resizeHandle()
    harness.controller.startResize(pointerEvent(first.handle, { pointerId: 11, clientX: 700 }))
    const lostCapture = new Event('lostpointercapture')
    Object.defineProperty(lostCapture, 'pointerId', { value: 11 })
    first.handle.dispatchEvent(lostCapture)
    expect(harness.controller.resizeGesture.value).toBeNull()
    expect(window.localStorage.getItem('hronaut:panel-dock-size-horizontal')).toBe('480')

    const second = resizeHandle()
    harness.controller.startResize(pointerEvent(second.handle, { pointerId: 12, clientX: 700 }))
    harness.wrapper.unmount()
    expect(harness.controller.resizeGesture.value).toBeNull()
    expect(second.releasePointerCapture).toHaveBeenCalledWith(12)
  })
})
