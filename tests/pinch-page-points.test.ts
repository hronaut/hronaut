// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import {
  assertPageAtNormalScale, assertPageAtNormalScaleBeforeInput, assertPointInsideVisibleViewport, refusesPinchedPage
} from '../src/main/browser/input-targets/target-checks.js'
import { nativeClickProgress, nativeClickTargetScript } from '../src/main/browser/native-click-admission.js'
import type { NativeClickTarget } from '../src/main/browser/native-click-admission.page.js'
import { elementPickerInspectionAtPointScript, elementPickerNativeInputScript } from '../src/main/browser/page-scripts/element-inspection-scripts.js'
import { screenshotAreaNativeInputScript, screenshotAreaScript, type ScreenshotAreaSelection } from '../src/main/browser/page-scripts/screenshot-area-script.js'
import { reproTargetScript } from '../src/main/browser/repro-recorder/repro-page-scripts.js'
import { nativeClickFailureResult } from '../src/main/mcp/tool-results.js'

// A pinch shows part of the page from an offset, larger. Main's points are the view's, so the element picker, the step
// recorder and an area capture took what was at the point of the unpinched page, and Chromium sends an agent's native
// input to the part the pinch shows, away from the point the page measured.

type PickerPage = Window & {
  __hronautElementPicker?: { cancel: () => void; nativeInput: (type: string, x: number, y: number) => boolean }
  __hronautScreenshotArea?: { cancel: () => void; nativeInput: (type: string, x: unknown, y: unknown) => boolean }
}
const page = window as unknown as PickerPage
const run = (script: string): unknown => window.eval(script) as unknown
const cleanups: Array<() => void> = []

/** Sets a property, such as one jsdom lacks, and puts back what was there after the test. */
function stub(owner: object, name: string, value: unknown): void {
  const own = Object.getOwnPropertyDescriptor(owner, name)
  Object.defineProperty(owner, name, { configurable: true, writable: true, value })
  cleanups.push(() => { if (own) Object.defineProperty(owner, name, own); else delete (owner as Record<string, unknown>)[name] })
}

/** A 1024 × 768 window, its page 1009 pixels wide beside a scroll bar, shown at the scale and offset given. */
function shown(scale: number, offsetLeft = 0, offsetTop = 0): void {
  stub(window, 'innerWidth', 1024)
  stub(window, 'innerHeight', 768)
  stub(document.documentElement, 'clientWidth', 1009)
  stub(document.body, 'clientWidth', 1009)
  stub(window, 'visualViewport', { scale, offsetLeft, offsetTop, width: 1009 / scale, height: 768 / scale })
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  delete page.__hronautElementPicker
  delete page.__hronautScreenshotArea
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('the person\'s point on a pinched page', () => {
  it('reaches the element picker where the pinch shows it', () => {
    const nativeInput = vi.fn(() => true)
    page.__hronautElementPicker = { cancel: () => undefined, nativeInput }
    shown(2, 200, 150)
    expect(run(elementPickerNativeInputScript('down', 600, 200, 1024, 768))).toBe(true)
    shown(1)
    run(elementPickerNativeInputScript('move', 600, 200, 1024, 768))
    expect(nativeInput.mock.calls).toEqual([['down', 500, 250], ['move', 600, 200]])
  })

  it('inspects the element where the pinch shows it', () => {
    const hit = vi.fn(() => null)
    stub(document, 'elementFromPoint', hit)
    shown(2, 200, 150)
    expect(() => run(elementPickerInspectionAtPointScript(600, 200, 1024, 768))).toThrow('No selectable element')
    expect(hit).toHaveBeenCalledWith(500, 250)
  })

  it('records the element a click hit where the pinch shows it', () => {
    document.body.innerHTML = '<button id="save">Save</button>'
    const hit = vi.fn(() => document.getElementById('save'))
    stub(document, 'elementFromPoint', hit)
    shown(2, 200, 150)
    expect(run(reproTargetScript({ x: 600, y: 200, viewportWidth: 1024, viewportHeight: 768 }))).toMatchObject({ selector: 'button' })
    expect(hit).toHaveBeenCalledWith(500, 250)
  })

  it('drags out an area where the pinch shows it and captures it as the view shows it', async () => {
    stub(window, 'requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
    const selection = run(screenshotAreaScript()) as Promise<ScreenshotAreaSelection>
    const picker = page.__hronautScreenshotArea!
    const nativeInput = vi.spyOn(picker, 'nativeInput')
    shown(2, 200, 150)
    run(screenshotAreaNativeInputScript('down', 200, 200, 1024, 768))
    run(screenshotAreaNativeInputScript('up', 400, 300, 1024, 768))
    expect(nativeInput.mock.calls).toEqual([['down', 300, 250], ['up', 400, 300]])
    await expect(selection).resolves.toEqual({
      canceled: false,
      clip: { x: 200, y: 200, width: 200, height: 100 },
      pageClip: { x: 300, y: 250, width: 100, height: 50 },
      viewport: { width: 1024, height: 768 },
      url: location.href
    })
  })
})

describe('an agent\'s native input on a pinched page', () => {
  let loading = false
  const webContents = {
    getURL: () => location.href,
    isLoadingMainFrame: () => loading,
    executeJavaScript: async (script: string) => run(script)
  } as unknown as WebContents

  it('is refused until the page is at its normal scale', async () => {
    shown(2, 200, 150)
    await expect(assertPageAtNormalScale(webContents, 'hover')).rejects.toThrow(
      'Hover with native input needs the page at its normal scale, and it is pinched larger. Reset it with browser_zoom (action reset), then try again.')
    await expect(assertPointInsideVisibleViewport(webContents, { x: 10, y: 10 }, 'click')).rejects.toThrow('Click with native input needs the page')
    // Pinched larger in place, with no offset yet, it still shows only part of the page.
    shown(1.5)
    await expect(assertPageAtNormalScale(webContents, 'drag')).rejects.toThrow('Drag with native input needs the page')
    shown(1)
    await expect(assertPageAtNormalScale(webContents, 'click')).resolves.toBeUndefined()
    await expect(assertPointInsideVisibleViewport(webContents, { x: 10, y: 10 }, 'click')).resolves.toBeUndefined()
    // A page emulating a phone is shown smaller to fit, not pinched.
    stub(window, 'visualViewport', { scale: 0.4, offsetLeft: 0, offsetTop: 0, width: 1009, height: 768 })
    await expect(assertPageAtNormalScale(webContents, 'click')).resolves.toBeUndefined()
    // A page going to another document is not asked, as the check would wait for that document, which opens at its
    // normal scale.
    shown(2, 200, 150)
    loading = true
    try {
      await expect(assertPageAtNormalScale(webContents, 'click')).resolves.toBeUndefined()
    } finally {
      loading = false
    }
  })

  // The check's own refusal answered a native click on a page's source or on a page whose renderer exited, in place of
  // the click's outcome, which says that nothing was pressed and nothing is left to clean up.
  it('leaves a page no script runs in to the input, which reports its own outcome there', async () => {
    const unscriptable = {
      getURL: () => 'view-source:https://example.com/',
      isLoadingMainFrame: () => false,
      executeJavaScript: vi.fn(async () => { throw new Error('This tab shows a page\'s source (a view-source: address)') })
    } as unknown as WebContents
    await expect(assertPageAtNormalScale(unscriptable, 'click')).resolves.toBeUndefined()
    await expect(assertPageAtNormalScale(unscriptable, 'hover')).resolves.toBeUndefined()
    expect(unscriptable.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  // A phone viewport the agent emulates sets its own scale and can show its page panned at it, and a zoom reset leaves
  // that scale as it is, so its tab is not refused.
  it('is not refused in a phone viewport the agent emulates', async () => {
    const phone = { viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true } }
    expect(refusesPinchedPage({ emulation: phone } as never)).toBe(false)
    expect(refusesPinchedPage({ emulation: { viewport: { ...phone.viewport, mobile: false } } } as never)).toBe(true)
    expect(refusesPinchedPage({ emulation: {} } as never)).toBe(true)
    shown(2, 200, 150)
    await expect(assertPointInsideVisibleViewport(webContents, { x: 10, y: 10 }, 'click', false)).resolves.toBeUndefined()
    document.body.innerHTML = '<button id="go">Go</button>'
    stub(Document.prototype, 'elementFromPoint', vi.fn(() => document.getElementById('go')))
    const admission = run(nativeClickTargetScript({ selector: '#go', refusePinch: false })) as NativeClickTarget
    expect(admission.sample(5, 5, false)).toBe('ADMITTED')
    expect(admission.sample(5, 5, true)).toBe('ADMITTED')
  })

  it('is refused at the press when the page was pinched after the point was measured', () => {
    document.body.innerHTML = '<button id="go">Go</button>'
    stub(Document.prototype, 'elementFromPoint', vi.fn(() => document.getElementById('go')))
    shown(1)
    const admission = run(nativeClickTargetScript({ selector: '#go', refusePinch: true })) as NativeClickTarget
    expect(admission.sample(5, 5, false)).toBe('ADMITTED')
    shown(2, 200, 150)
    expect(admission.sample(5, 5, true)).toBe('PAGE_PINCHED')
    expect(nativeClickFailureResult(nativeClickProgress(), 'PAGE_PINCHED').structuredContent).toMatchObject({
      status: 'NOT_DISPATCHED', reason: 'PAGE_PINCHED',
      message: 'The page is pinched larger, so the press was not sent. Reset it with browser_zoom (action reset) first.'
    })
  })

  // The page's width is a whole number and the part shown a fraction at a page zoom such as 125%, so a page at its
  // normal scale looked pinched by a fraction of a pixel.
  it('takes a page zoomed to 125% for one at its normal scale', async () => {
    stub(window, 'innerWidth', 390)
    stub(window, 'innerHeight', 600)
    stub(document.documentElement, 'clientWidth', 390)
    stub(window, 'visualViewport', { scale: 1, offsetLeft: 0, offsetTop: 0, width: 389.6, height: 600 })
    await expect(assertPageAtNormalScale(webContents, 'hover')).resolves.toBeUndefined()
    document.body.innerHTML = '<button id="go">Go</button>'
    stub(Document.prototype, 'elementFromPoint', vi.fn(() => document.getElementById('go')))
    const admission = run(nativeClickTargetScript({ selector: '#go', refusePinch: true })) as NativeClickTarget
    expect(admission.sample(5, 5, false)).toBe('ADMITTED')
  })

  // A page still reading its document, or going to another, is not asked before the input, so the input checks again
  // with Chromium's own viewports right before it is sent.
  // Chromium's scale is the pinch alone, whatever the page zoom. A phone viewport emulated in Developer Tools has a
  // scale of 1 or less while not pinched, and a layout viewport as wide as its page shown whole, which is wider than
  // the part shown.
  it('is refused right before it is sent, from Chromium\'s viewports', async () => {
    const metrics = (scale: number, layout: number, visual: number, offsetX = 0) => ({
      debugger: { sendCommand: vi.fn(async () => ({
        cssLayoutViewport: { clientWidth: layout }, cssVisualViewport: { clientWidth: visual, scale, offsetX, offsetY: 0 }
      })) }
    }) as unknown as WebContents
    await expect(assertPageAtNormalScaleBeforeInput(metrics(2, 1009, 504.5), 'hover')).rejects.toThrow(
      'Hover with native input needs the page at its normal scale, and it is pinched larger.')
    await expect(assertPageAtNormalScaleBeforeInput(metrics(1, 1009, 1009, 12), 'drag')).rejects.toThrow('Drag with native input needs')
    await expect(assertPageAtNormalScaleBeforeInput(metrics(1.5, 1009, 672.7), 'click')).rejects.toThrow('Click with native input needs')
    await expect(assertPageAtNormalScaleBeforeInput(metrics(1, 390, 389.6), 'drag')).resolves.toBeUndefined()
    await expect(assertPageAtNormalScaleBeforeInput(metrics(1, 1560, 390), 'hover')).resolves.toBeUndefined()
    await expect(assertPageAtNormalScaleBeforeInput(metrics(0.4, 980, 980), 'hover')).resolves.toBeUndefined()
  })
})
