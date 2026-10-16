import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readWindowControlsScrim,
  useWindowControlsScrim
} from '../../src/renderer/src/composables/useWindowControlsScrim.js'

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'elementsFromPoint')
})

function stubElementsFromPoint(elements: Element[]) {
  const elementsFromPoint = vi.fn(() => elements)
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: elementsFromPoint })
  return elementsFromPoint
}

function layer(background: string, position = 'fixed'): HTMLElement {
  const element = document.createElement('div')
  element.style.position = position
  element.style.backgroundColor = background
  document.body.append(element)
  return element
}

describe('window controls scrim', () => {
  it('reads the translucent backdrop of a fixed layer under the top-right corner', () => {
    const backdrop = layer('rgba(4, 7, 12, 0.48)')
    const label = document.createElement('span')
    backdrop.append(label)
    const shell = layer('rgb(255, 255, 255)', 'static')
    const elementsFromPoint = stubElementsFromPoint([label, backdrop, shell, document.body])

    expect(readWindowControlsScrim()).toBe('rgba(4, 7, 12, 0.48)')
    expect(elementsFromPoint).toHaveBeenCalledWith(window.innerWidth - 2, 2)

    // An opaque surface on top, or a fixed layer without a backdrop, leaves the controls alone.
    stubElementsFromPoint([shell, backdrop])
    expect(readWindowControlsScrim()).toBeNull()
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0)'
    stubElementsFromPoint([label, backdrop, shell])
    expect(readWindowControlsScrim()).toBeNull()
    backdrop.style.backgroundColor = 'rgba(4, 7, 12, 0.48)'
    backdrop.style.position = 'static'
    expect(readWindowControlsScrim()).toBeNull()
    stubElementsFromPoint([])
    expect(readWindowControlsScrim()).toBeNull()
  })

  it('dims by every stacked backdrop, as they composite over the shell', () => {
    // A wallet approval over Commands darkens the window by both backdrops.
    const wallet = layer('rgba(4, 5, 10, 0.76)')
    const commands = layer('rgba(18, 18, 24, 0.38)')
    stubElementsFromPoint([wallet, commands, layer('rgb(255, 255, 255)', 'static')])
    // alpha = .76 + .38 × .24 = .8512; green = (5 × .76 + 18 × .38 × .24) / .8512 ≈ 6.39
    expect(readWindowControlsScrim()).toBe('rgba(6, 6, 12, 0.851)')
  })

  it('reports each change once after the dialog renders and clears on dispose', async () => {
    const open = ref(false)
    const report = vi.fn()
    let current: string | null = null
    const read = vi.fn(() => current)
    const scope = effectScope()
    const controller = scope.run(() => useWindowControlsScrim({ sources: [open], report, read }))!

    open.value = true
    current = 'rgba(4, 7, 12, 0.48)'
    // The backdrop is read after the DOM update, not when the state flips.
    expect(read).not.toHaveBeenCalled()
    await nextTick()
    await nextTick()
    expect(report).toHaveBeenCalledExactlyOnceWith('rgba(4, 7, 12, 0.48)')

    // Switching from one dialog to another keeps the same backdrop without another report.
    open.value = false
    current = null
    await Promise.resolve()
    open.value = true
    current = 'rgba(4, 7, 12, 0.48)'
    await nextTick()
    await nextTick()
    expect(report).toHaveBeenCalledOnce()

    open.value = false
    current = null
    await nextTick()
    await nextTick()
    expect(report).toHaveBeenLastCalledWith(null)

    open.value = true
    current = 'rgba(4, 7, 12, 0.48)'
    await nextTick()
    await nextTick()
    scope.stop()
    expect(report).toHaveBeenLastCalledWith(null)
    report.mockClear()
    controller.dispose()
    open.value = false
    await nextTick()
    expect(report).not.toHaveBeenCalled()
  })
})
