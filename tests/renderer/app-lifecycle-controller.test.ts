import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useAppLifecycleController } from '../../src/renderer/src/composables/useAppLifecycleController.js'

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

describe('useAppLifecycleController', () => {
  it('starts once and disposes each resource once even when registrations repeat', () => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverStub
    })
    const start = vi.fn()
    const sharedDisposer = vi.fn()
    const otherDisposer = vi.fn()
    let dispose = (): void => undefined
    const wrapper = mount(defineComponent({
      setup() {
        const shell = ref<HTMLElement | null>(null)
        dispose = useAppLifecycleController({
          shell,
          onKeyDown: vi.fn(),
          onWindowResize: vi.fn(),
          onShellResize: vi.fn(),
          start,
          disposers: [sharedDisposer, sharedDisposer, otherDisposer]
        }).dispose
        return () => h('div', { ref: shell })
      }
    }))

    expect(start).toHaveBeenCalledOnce()
    dispose()
    dispose()
    wrapper.unmount()
    expect(sharedDisposer).toHaveBeenCalledOnce()
    expect(otherDisposer).toHaveBeenCalledOnce()
  })

  it('continues disposing later resources when an earlier disposer throws', () => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverStub
    })
    const failure = new Error('native listener removal failed')
    const failingDisposer = vi.fn(() => { throw failure })
    const laterDisposer = vi.fn()
    let dispose = (): void => undefined
    const wrapper = mount(defineComponent({
      setup() {
        const shell = ref<HTMLElement | null>(null)
        dispose = useAppLifecycleController({
          shell,
          onKeyDown: vi.fn(),
          onWindowResize: vi.fn(),
          onShellResize: vi.fn(),
          start: vi.fn(),
          disposers: [failingDisposer, laterDisposer]
        }).dispose
        return () => h('div', { ref: shell })
      }
    }))

    expect(dispose).toThrow(failure)
    expect(failingDisposer).toHaveBeenCalledOnce()
    expect(laterDisposer).toHaveBeenCalledOnce()
    expect(() => wrapper.unmount()).not.toThrow()
  })
})
