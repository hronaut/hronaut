import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabRailResizeController } from '../../src/renderer/src/composables/useTabRailResizeController.js'

const key = 'hronaut:vertical-tab-rail-width'
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } })
})
afterEach(() => { if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor) })

function harness() {
  const viewportWidth = ref(1200)
  const enabled = ref(true)
  const scope = effectScope()
  const controller = scope.run(() => useTabRailResizeController({ viewportWidth, enabled }))!
  const handle = document.createElement('div')
  handle.tabIndex = 0
  document.body.append(handle)
  let captured = false
  const releasePointerCapture = vi.fn(() => { captured = false })
  Object.assign(handle, {
    setPointerCapture: vi.fn(() => { captured = true }),
    hasPointerCapture: vi.fn(() => captured),
    releasePointerCapture
  })
  const start = (x = 276, pointerId = 1) => controller.startResize({ button: 0, pointerId, clientX: x, currentTarget: handle, preventDefault: vi.fn() } as unknown as PointerEvent)
  const pointer = (type: string, x = 350, pointerId = 1) => {
    const event = new Event(type)
    Object.assign(event, { clientX: x, pointerId })
    window.dispatchEvent(event)
  }
  const keyboard = (key: string, shiftKey = false) => controller.resizeWithKeyboard(new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }))
  const dispose = () => { scope.stop(); handle.remove() }
  return { controller, viewportWidth, enabled, handle, releasePointerCapture, start, pointer, keyboard, dispose }
}

describe('tab rail resizing', () => {
  it.each([['garbage', 280], ['Infinity', 280], ['-1', 280], ['0', 280], ['42', 200], ['99999', 480], ['333.5', 334]])('bounds stored width %s safely', (stored, expected) => {
    values.set(key, stored)
    const h = harness()
    expect(h.controller.width.value).toBe(expected)
    h.dispose()
  })

  it('clamps to the viewport without overwriting the larger saved preference', () => {
    values.set(key, '432')
    const h = harness()
    h.viewportWidth.value = 608
    expect(h.controller.maximum.value).toBe(288)
    expect(h.controller.width.value).toBe(288)
    expect(values.get(key)).toBe('432')
    h.viewportWidth.value = 1200
    expect(h.controller.width.value).toBe(432)
    h.dispose()
  })

  it('updates live, ignores other pointers, and persists only a completed drag', () => {
    const h = harness()
    h.start()
    expect(h.handle).toHaveFocus()
    h.pointer('pointermove', 376, 2)
    expect(h.controller.width.value).toBe(280)
    h.pointer('pointermove', 376)
    expect(h.controller.width.value).toBe(380)
    expect(values.has(key)).toBe(false)
    h.pointer('pointerup')
    expect(values.get(key)).toBe('380')
    expect(h.controller.resizing.value).toBe(false)
    expect(h.releasePointerCapture).toHaveBeenCalledWith(1)
    h.pointer('pointermove', 440)
    expect(h.controller.width.value).toBe(380)
    h.dispose()
  })

  it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'disabled', 'viewport', 'dispose'])('cancels %s and removes the gesture listeners without saving', reason => {
    values.set(key, '360')
    const h = harness()
    h.start()
    h.pointer('pointermove', 390)
    expect(h.controller.width.value).toBe(474)
    if (reason === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    else if (reason === 'lostpointercapture') h.handle.dispatchEvent(new Event(reason))
    else if (reason === 'disabled') h.enabled.value = false
    else if (reason === 'viewport') h.viewportWidth.value = 1100
    else if (reason === 'dispose') h.controller.dispose()
    else h.pointer(reason)
    expect(h.controller.resizing.value).toBe(false)
    expect(h.controller.width.value).toBe(360)
    expect(values.get(key)).toBe('360')
    h.pointer('pointermove', 400)
    h.pointer('pointerup')
    expect(h.controller.width.value).toBe(360)
    h.dispose()
  })

  it('supports keyboard steps, limits and reset without retaining an obsolete preference', () => {
    const h = harness()
    h.keyboard('ArrowRight')
    expect(h.controller.width.value).toBe(296)
    h.keyboard('ArrowLeft', true)
    expect(h.controller.width.value).toBe(248)
    h.keyboard('Home')
    expect(h.controller.width.value).toBe(200)
    h.keyboard('End')
    expect(h.controller.width.value).toBe(480)
    h.controller.resetSize()
    expect(h.controller.width.value).toBe(280)
    expect(values.has(key)).toBe(false)
    h.dispose()
  })

  it('keeps the session usable when preference storage rejects writes', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('Storage unavailable') } })
    const h = harness()
    h.keyboard('ArrowRight')
    expect(h.controller.width.value).toBe(296)
    expect(() => h.controller.resetSize()).not.toThrow()
    h.dispose()
  })
})
