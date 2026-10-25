import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StatusBubbleMeasurement, StatusBubbleState } from '../../src/shared/status-bubble.js'

// Pointing at a link showed nothing of where it goes. Chrome shows its address at the page's bottom left corner, and
// shortens a long one as it does.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  document.body.replaceChildren()
  delete document.documentElement.dataset.theme
  Reflect.deleteProperty(document, 'fonts')
})

function state(overrides: Partial<StatusBubbleState> = {}): StatusBubbleState {
  return { id: 1, text: { scheme: 'https://', host: 'example.com', rest: '/docs' }, theme: 'cyberpunk', side: 'left', maxWidth: 300, corner: 12, opening: false, ...overrides }
}

/** Lays out the bubble as given: how wide the whole bubble's and the rest's content is, against their boxes. */
function layout(widths: { bubble: [number, number]; rest: [number, number] }) {
  const sizes = (element: HTMLElement): [number, number] => {
    if (element.classList.contains('status-bubble')) return element.classList.contains('status-bubble--long-host') ? [widths.bubble[1], widths.bubble[1]] : widths.bubble
    if (element.classList.contains('status-bubble__rest')) return widths.rest
    return [0, 0]
  }
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return sizes(this)[0] })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return sizes(this)[1] })
}

async function load() {
  document.body.innerHTML = '<div id="status-bubble-root" aria-hidden="true"></div>'
  const measured = vi.fn<(measurement: StatusBubbleMeasurement) => void>()
  let receive!: (state: StatusBubbleState) => void
  vi.stubGlobal('hronautStatusBubbleView', {
    onState: (listener: typeof receive) => { receive = listener; return () => undefined },
    measured
  })
  await import('../../src/renderer/src/status-bubble.js')
  return { measured, receive: (value: StatusBubbleState) => receive(value), bubble: () => document.querySelector<HTMLElement>('.status-bubble')! }
}

describe('the status bubble view', () => {
  it('writes the address as plain text, left to right, in the theme and corner it is given, and reports its size while hidden', async () => {
    layout({ bubble: [180, 180], rest: [40, 40] })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 179.2, height: 21.4 } as DOMRect)
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    const view = await load()

    view.receive(state({ text: { scheme: '', host: 'localhost:5173', rest: '/<b>app</b>' }, opening: true }))
    const bubble = view.bubble()
    // Coming into sight, it fades in.
    expect(bubble.dataset.opening).toBe('true')
    expect(bubble.textContent).toBe('localhost:5173/<b>app</b>')
    expect(bubble.querySelector('b')).toBeNull()
    expect(bubble.dir).toBe('ltr')
    expect(bubble.querySelector<HTMLElement>('.status-bubble__host-text')?.dir).toBe('ltr')
    expect(bubble.dataset.side).toBe('left')
    expect(bubble.style.getPropertyValue('--status-bubble-max-width')).toBe('300px')
    expect(bubble.style.getPropertyValue('--status-bubble-corner')).toBe('12px')
    expect(document.documentElement.dataset.theme).toBe('cyberpunk')
    expect(view.measured).toHaveBeenCalledExactlyOnceWith({ id: 1, width: 180, height: 22, shortened: false })
    expect(frame).not.toHaveBeenCalled()

    // The other corner and theme replace it, at once.
    view.receive(state({ id: 2, side: 'right', theme: 'light', corner: 0 }))
    expect(document.querySelectorAll('.status-bubble')).toHaveLength(1)
    expect(view.bubble().dataset.opening).toBeUndefined()
    expect(view.bubble().dataset.side).toBe('right')
    expect(view.bubble().style.getPropertyValue('--status-bubble-corner')).toBe('0px')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(view.measured).toHaveBeenLastCalledWith({ id: 2, width: 180, height: 22, shortened: false })
    // A view made again starts its ids over; the same id and size is reported again.
    view.receive(state({ id: 2 }))
    expect(view.measured).toHaveBeenCalledTimes(3)
  })

  it('says when it shortened the path, and shows only the end of a host too long to fit', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 22 } as DOMRect)
    layout({ bubble: [300, 300], rest: [420, 200] })
    const view = await load()
    view.receive(state({ text: { scheme: 'https://', host: 'example.com', rest: '/a/very/long/path' } }))
    expect(view.bubble().classList.contains('status-bubble--long-host')).toBe(false)
    expect(view.measured).toHaveBeenLastCalledWith({ id: 1, width: 300, height: 22, shortened: true })

    vi.restoreAllMocks()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 22 } as DOMRect)
    layout({ bubble: [900, 300], rest: [40, 40] })
    view.receive(state({ id: 2, text: { scheme: 'https://', host: `${'sub.'.repeat(60)}example.com`, rest: '/' } }))
    expect(view.bubble().classList.contains('status-bubble--long-host')).toBe(true)
    expect(view.measured).toHaveBeenLastCalledWith({ id: 2, width: 300, height: 22, shortened: true })
  })

  it('reports its size again once the font has loaded, and only when it changed', async () => {
    layout({ bubble: [180, 180], rest: [40, 40] })
    const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 170, height: 20 } as DOMRect)
    let loadFont!: () => void
    const fonts = { ready: new Promise<void>((resolve) => { loadFont = resolve }) }
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    const view = await load()
    view.receive(state())
    expect(view.measured).toHaveBeenLastCalledWith({ id: 1, width: 170, height: 20, shortened: false })
    box.mockReturnValue({ width: 182, height: 22 } as DOMRect)
    loadFont()
    await fonts.ready
    await Promise.resolve()
    expect(view.measured).toHaveBeenCalledTimes(2)
    expect(view.measured).toHaveBeenLastCalledWith({ id: 1, width: 182, height: 22, shortened: false })

    // A state replaced meanwhile is not measured for the font; the same size is not reported twice.
    view.receive(state({ id: 2 }))
    view.receive(state({ id: 3 }))
    await Promise.resolve()
    await Promise.resolve()
    expect(view.measured.mock.calls.map(([measurement]) => measurement.id)).toEqual([1, 1, 2, 3])
  })
})
