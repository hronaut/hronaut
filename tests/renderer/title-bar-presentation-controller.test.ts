import { describe, expect, it } from 'vitest'
import {
  createTitleBarPresentationController,
  titleBarDragSurface
} from '../../src/renderer/src/composables/useTitleBarPresentationController.js'
import type { WindowChromeState } from '../../src/shared/types.js'

class FakeWindowControlsOverlay extends EventTarget {
  visible = true
  rect = new DOMRect(120, 0, 1_080, 44)

  getTitlebarAreaRect(): DOMRect {
    return this.rect
  }
}

function chrome(overrides: Partial<WindowChromeState> = {}): WindowChromeState {
  return { platform: 'linux', mode: 'overlay', mainWindow: true, ...overrides }
}

describe('title bar presentation controller', () => {
  it('maps horizontal, vertical website, and vertical Home layouts to focused drag surfaces', () => {
    expect(titleBarDragSurface('horizontal', false)).toBe('tabs')
    expect(titleBarDragSurface('horizontal', true)).toBe('tabs')
    expect(titleBarDragSurface('vertical', false)).toBe('toolbar')
    expect(titleBarDragSurface('vertical', true)).toBe('home')
  })

  it('publishes left- and right-side native-control safe areas and follows geometry changes', () => {
    const overlay = new FakeWindowControlsOverlay()
    const resizeTarget = new EventTarget()
    let viewportWidth = 1_200
    const controller = createTitleBarPresentationController(chrome(), {
      documentElement: document.documentElement,
      viewportWidth: () => viewportWidth,
      windowControlsOverlay: overlay,
      resizeTarget
    })

    controller.start()
    expect(document.documentElement.dataset.titleBarMode).toBe('overlay')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('120px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('1080px')

    overlay.rect = new DOMRect(0, 0, 1_056, 44)
    overlay.dispatchEvent(new Event('geometrychange'))

    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('0px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('1056px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')).toBe('144px')

    viewportWidth = 760
    overlay.visible = false
    overlay.rect = new DOMRect(0, 0, 760, 44)
    resizeTarget.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('616px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')).toBe('144px')

    overlay.visible = true
    overlay.rect = new DOMRect(0, 0, 616, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('616px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')).toBe('144px')

    controller.stop()
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('')
  })

  it.each([
    chrome({ mode: 'system' }),
    chrome({ mainWindow: false })
  ])('does not apply overlay presentation outside an overlay main window', (windowChrome) => {
    const overlay = new FakeWindowControlsOverlay()
    const controller = createTitleBarPresentationController(windowChrome, {
      documentElement: document.documentElement,
      viewportWidth: () => 1_200,
      windowControlsOverlay: overlay
    })

    controller.start()

    expect(controller.overlayEnabled).toBe(false)
    expect(document.documentElement.dataset.titleBarMode).toBe('system')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('')
    controller.stop()
  })
})
