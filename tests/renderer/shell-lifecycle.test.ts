import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useShellWindowLifecycle } from '../../src/renderer/src/composables/useShellWindowLifecycle.js'

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

describe('useShellWindowLifecycle', () => {
  it('registers renderer listeners and removes them when the component unmounts', async () => {
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ResizeObserverStub })
    const onKeyDown = vi.fn()
    const onWindowResize = vi.fn()
    const wrapper = mount(defineComponent({
      setup() {
        const shell = ref<HTMLElement | null>(null)
        useShellWindowLifecycle({ shell, onKeyDown, onWindowResize, onShellResize: vi.fn() })
        return () => h('div', { ref: shell })
      }
    }))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K' }))
    window.dispatchEvent(new Event('resize'))
    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(onWindowResize).toHaveBeenCalledOnce()
    wrapper.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K' }))
    window.dispatchEvent(new Event('resize'))
    expect(onKeyDown).toHaveBeenCalledOnce()
    expect(onWindowResize).toHaveBeenCalledOnce()
  })
})
