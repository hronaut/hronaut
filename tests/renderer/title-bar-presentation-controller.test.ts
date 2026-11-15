import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  for (const property of [
    '--titlebar-area-x-runtime',
    '--titlebar-area-width-runtime',
    '--titlebar-area-height-runtime',
    '--titlebar-controls-left-runtime',
    '--titlebar-controls-right-runtime'
  ]) document.documentElement.style.removeProperty(property)
})

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

  it('keeps the controls\' room while the window narrows or widens and the overlay reports at another moment', () => {
    const overlay = new FakeWindowControlsOverlay()
    overlay.rect = new DOMRect(0, 0, 1_807, 44)
    const resizeTarget = new EventTarget()
    let viewportWidth = 1_920
    const frames = new Map<number, () => void>()
    let nextFrame = 0
    const runFrames = (): void => {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    }
    const rightInset = (): string => document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')
    let time = 0
    const controller = createTitleBarPresentationController(chrome(), {
      documentElement: document.documentElement,
      viewportWidth: () => viewportWidth,
      windowControlsOverlay: overlay,
      resizeTarget,
      requestFrame: (callback) => {
        nextFrame += 1
        frames.set(nextFrame, callback)
        return nextFrame
      },
      cancelFrame: (handle) => { frames.delete(handle) },
      now: () => time
    })
    controller.start()
    expect(rightInset()).toBe('113px')

    // Chromium reports the new window's whole width before the viewport shrinks and before the controls move in; read
    // against the old width, the controls would seem 480 px wide and wrap the toolbar.
    overlay.rect = new DOMRect(0, 0, 1_440, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(rightInset()).toBe('113px')
    viewportWidth = 1_440
    resizeTarget.dispatchEvent(new Event('resize'))
    expect(rightInset()).toBe('113px')
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('1327px')

    overlay.rect = new DOMRect(0, 0, 1_327, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(frames.size).toBe(1)
    runFrames()
    expect(rightInset()).toBe('113px')

    // Widening, the viewport grows before the overlay reports its area for the new width; read with the old area, the
    // controls would seem 593 px wide. A shell resize handler that syncs as well keeps their room too.
    viewportWidth = 1_920
    resizeTarget.dispatchEvent(new Event('resize'))
    expect(rightInset()).toBe('113px')
    controller.syncGeometry()
    expect(rightInset()).toBe('113px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('1807px')
    overlay.rect = new DOMRect(0, 0, 1_807, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')

    // Even a frame later the viewport can still have the old width. Narrowing, the area for the new width read against
    // 1920 px would make the controls 593 px wide; that reading only counts once reads keep finding it for 250 ms, and
    // by then the viewport has caught up.
    overlay.rect = new DOMRect(0, 0, 1_327, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(frames.size).toBe(1)
    viewportWidth = 1_440
    resizeTarget.dispatchEvent(new Event('resize'))
    expect(rightInset()).toBe('113px')
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('1327px')
    expect(frames.size).toBe(0)

    // On a busy machine the viewport can keep the old width for several frames; the resize that brings the new one
    // starts the reading over, so the controls never take the 593 px.
    viewportWidth = 1_920
    resizeTarget.dispatchEvent(new Event('resize'))
    overlay.rect = new DOMRect(0, 0, 1_807, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    overlay.rect = new DOMRect(0, 0, 1_327, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    time += 100
    runFrames()
    time += 100
    runFrames()
    expect(rightInset()).toBe('113px')
    time += 100
    viewportWidth = 1_440
    resizeTarget.dispatchEvent(new Event('resize'))
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(frames.size).toBe(0)

    // Widening with the overlay's area late: the resize alone reads nothing, so the old area never counts against the
    // new viewport, however late the area comes.
    viewportWidth = 1_920
    resizeTarget.dispatchEvent(new Event('resize'))
    runFrames()
    time += 400
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(frames.size).toBe(0)
    overlay.rect = new DOMRect(0, 0, 1_807, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')

    // A size waiting when the overlay hides, as on entering full screen, starts over when it shows again.
    overlay.rect = new DOMRect(0, 0, 1_327, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    overlay.visible = false
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    time += 300
    overlay.visible = true
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    viewportWidth = 1_440
    resizeTarget.dispatchEvent(new Event('resize'))
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(frames.size).toBe(0)

    // A hidden overlay, as in full screen, reports an empty area; the controls keep their room.
    overlay.visible = false
    overlay.rect = new DOMRect(0, 0, 0, 0)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('1327px')
    overlay.visible = true
    overlay.rect = new DOMRect(0, 0, 1_327, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(frames.size).toBe(0)

    // Controls that really change, without a resize, apply once reads have kept finding the new size for 250 ms.
    overlay.rect = new DOMRect(0, 0, 1_296, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(rightInset()).toBe('113px')
    runFrames()
    expect(rightInset()).toBe('113px')
    time += 249
    runFrames()
    expect(rightInset()).toBe('113px')
    time += 1
    runFrames()
    expect(rightInset()).toBe('144px')
    expect(frames.size).toBe(0)

    // A frame still pending when presentation stops changes nothing.
    overlay.rect = new DOMRect(0, 0, 1_000, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    controller.stop()
    expect(frames.size).toBe(0)
    expect(rightInset()).toBe('')
  })

  it('applies the controls\' room for a new zoom at once, so the toolbar moves only with the zoom', () => {
    const overlay = new FakeWindowControlsOverlay()
    overlay.rect = new DOMRect(0, 0, 1_807, 44)
    const resizeTarget = new EventTarget()
    let viewportWidth = 1_920
    let pixelRatio = 1
    const frames = new Map<number, () => void>()
    let nextFrame = 0
    const runFrames = (): void => {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    }
    const rightInset = (): string => document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')
    let time = 0
    const controller = createTitleBarPresentationController(chrome(), {
      documentElement: document.documentElement,
      viewportWidth: () => viewportWidth,
      windowControlsOverlay: overlay,
      resizeTarget,
      requestFrame: (callback) => {
        nextFrame += 1
        frames.set(nextFrame, callback)
        return nextFrame
      },
      cancelFrame: (handle) => { frames.delete(handle) },
      now: () => time,
      pixelRatio: () => pixelRatio
    })
    controller.start()
    expect(rightInset()).toBe('113px')

    // A larger interface size zooms the shell: the viewport and the controls shrink in page pixels together. Chromium
    // first reports the whole new width, then the area beside the controls, which now take 90 page pixels.
    viewportWidth = 1_536
    pixelRatio = 1.25
    overlay.rect = new DOMRect(0, 0, 1_536, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    // Three pixels off the scaled room is more than rounding explains, so that report waits.
    overlay.rect = new DOMRect(0, 0, 1_449, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    overlay.rect = new DOMRect(0, 0, 1_446, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('90px')
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-width-runtime')).toBe('1446px')
    resizeTarget.dispatchEvent(new Event('resize'))
    runFrames()
    expect(rightInset()).toBe('90px')
    expect(frames.size).toBe(0)

    // Back to the normal size, the controls take their 113 pixels again, within a rounding pixel of the scale.
    viewportWidth = 1_920
    pixelRatio = 1
    resizeTarget.dispatchEvent(new Event('resize'))
    overlay.rect = new DOMRect(0, 0, 1_807, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')

    // A report at a new ratio that does not match the zoom's scale is still read against a viewport that may lag, so it
    // counts only once reads keep finding it for 250 ms.
    pixelRatio = 1.5
    overlay.rect = new DOMRect(0, 0, 1_720, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    time += 250
    runFrames()
    expect(rightInset()).toBe('200px')
    expect(frames.size).toBe(0)
    controller.stop()
  })

  it('keeps waiting out a resize race after the window moves to a monitor with another scale', () => {
    const overlay = new FakeWindowControlsOverlay()
    overlay.rect = new DOMRect(0, 0, 1_807, 44)
    const resizeTarget = new EventTarget()
    let viewportWidth = 1_920
    let pixelRatio = 1.5
    const frames = new Map<number, () => void>()
    let nextFrame = 0
    const runFrames = (): void => {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    }
    const rightInset = (): string => document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')
    const controller = createTitleBarPresentationController(chrome(), {
      documentElement: document.documentElement,
      viewportWidth: () => viewportWidth,
      windowControlsOverlay: overlay,
      resizeTarget,
      requestFrame: (callback) => {
        nextFrame += 1
        frames.set(nextFrame, callback)
        return nextFrame
      },
      cancelFrame: (handle) => { frames.delete(handle) },
      now: () => 0,
      pixelRatio: () => pixelRatio
    })
    controller.start()
    expect(rightInset()).toBe('113px')

    // On a 100% monitor the controls keep their page-pixel size, so the overlay reports nothing new. Narrowing the
    // window then, the area for the new width comes before the viewport, and read against the old width the controls
    // seem 170 px wide: the 113 px scaled by the old ratio, but the viewport did not scale, so it is no zoom.
    pixelRatio = 1
    overlay.rect = new DOMRect(0, 0, 1_750, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    runFrames()
    expect(rightInset()).toBe('113px')
    viewportWidth = 1_863
    resizeTarget.dispatchEvent(new Event('resize'))
    runFrames()
    expect(rightInset()).toBe('113px')
    expect(frames.size).toBe(0)
    controller.stop()
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

  it('rolls back partial title-bar listener setup and permits a clean retry', () => {
    const overlay = new FakeWindowControlsOverlay()
    const resizeTarget = new EventTarget()
    const addListener = vi.spyOn(resizeTarget, 'addEventListener')
      .mockImplementationOnce(() => { throw new Error('resize listener unavailable') })
    const controller = createTitleBarPresentationController(chrome(), {
      documentElement: document.documentElement,
      viewportWidth: () => 1_200,
      windowControlsOverlay: overlay,
      resizeTarget
    })

    expect(() => controller.start()).toThrow('resize listener unavailable')
    overlay.rect = new DOMRect(144, 0, 1_056, 44)
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('')

    addListener.mockRestore()
    controller.start()
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('144px')
    controller.stop()
  })

  it('removes later listeners and runtime geometry when one title-bar cleanup fails', () => {
    const overlay = new FakeWindowControlsOverlay()
    const resizeTarget = new EventTarget()
    const controller = createTitleBarPresentationController(chrome(), {
      documentElement: document.documentElement,
      viewportWidth: () => 1_200,
      windowControlsOverlay: overlay,
      resizeTarget
    })
    controller.start()
    vi.spyOn(overlay, 'removeEventListener')
      .mockImplementationOnce(() => { throw new Error('overlay listener already removed') })

    expect(() => controller.stop()).toThrow('overlay listener already removed')

    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('')
    overlay.rect = new DOMRect(200, 0, 1_000, 44)
    resizeTarget.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('')
    overlay.dispatchEvent(new Event('geometrychange'))
    expect(document.documentElement.style.getPropertyValue('--titlebar-area-x-runtime')).toBe('')
  })
})
