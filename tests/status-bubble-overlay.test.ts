import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBubbleOverlay, type StatusBubblePane, type StatusBubbleSurface } from '../src/main/overlays/status-bubble-overlay.js'
import type { StatusBubbleState } from '../src/shared/status-bubble.js'

// Pointing at a link showed nothing of where it goes. Chrome shows its address at the page's bottom left corner, after
// a short pause, and moves it out of the pointer's way.

function setup() {
  const panes = new Map<string, StatusBubblePane>([['page', { bounds: { x: 100, y: 80, width: 900, height: 600 }, corner: 12 }]])
  const zoom = { value: 1 }
  const focus = { owner: null as unknown }
  let destroyed = false
  const surface = {
    send: vi.fn<(state: StatusBubbleState) => void>(),
    setZoomFactor: vi.fn(),
    setBounds: vi.fn(),
    present: vi.fn(),
    withdraw: vi.fn(),
    isDestroyed: () => destroyed
  } satisfies StatusBubbleSurface
  const restoreFocus = vi.fn()
  const bubble = new StatusBubbleOverlay({
    surface: async () => surface,
    pane: (tabId) => panes.get(tabId) ?? null,
    zoom: () => zoom.value,
    theme: () => 'cyberpunk',
    focusOwner: () => focus.owner,
    restoreFocus
  })
  const state = () => surface.send.mock.calls.at(-1)?.[0]
  // The view lays out the state it got last and reports its size.
  const measure = (width = 180, height = 22, shortened = false) => bubble.measured({ id: state()!.id, width, height, shortened })
  return { bubble, surface, panes, zoom, focus, restoreFocus, state, measure, destroy: () => { destroyed = true } }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the status bubble', () => {
  it('shows the link\'s address at the page\'s bottom left corner after a short pause, a third of the page wide at most', async () => {
    const h = setup()
    h.bubble.targetUrl('page', 'https://example.com/docs')
    await vi.advanceTimersByTimeAsync(79)
    expect(h.surface.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.state()).toEqual({ id: 1, text: { scheme: 'https://', host: 'example.com', rest: '/docs' }, theme: 'cyberpunk', side: 'left', maxWidth: 300, corner: 12, opening: true })
    expect(h.surface.present).not.toHaveBeenCalled()
    h.measure(180, 22)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 180, height: 22 })
    expect(h.surface.present).toHaveBeenCalledOnce()
    // A page view attached later would cover it; it goes back above the pages.
    h.bubble.restack()
    expect(h.surface.present).toHaveBeenCalledTimes(2)
    // Another link while it shows changes it at once, without fading in again.
    h.bubble.targetUrl('page', 'https://example.com/blog')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()).toMatchObject({ text: { rest: '/blog' }, opening: false })
  })

  it('shows none on a page too small for it', async () => {
    const h = setup()
    h.panes.set('page', { bounds: { x: 100, y: 80, width: 900, height: 18 }, corner: 12 })
    h.bubble.targetUrl('page', 'https://example.com/docs')
    await vi.advanceTimersByTimeAsync(80)
    h.measure(180, 22)
    expect(h.surface.present).not.toHaveBeenCalled()
    h.panes.set('page', { bounds: { x: 100, y: 80, width: 900, height: 600 }, corner: 12 })
    h.bubble.layoutChanged()
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 180, height: 22 })
  })

  it('shows nothing for a sweep across links, and stays a moment after the link is left', async () => {
    const h = setup()
    h.bubble.targetUrl('page', 'https://example.com/a')
    await vi.advanceTimersByTimeAsync(40)
    h.bubble.targetUrl('page', '')
    await vi.advanceTimersByTimeAsync(500)
    expect(h.surface.send).not.toHaveBeenCalled()
    h.bubble.targetUrl('page', 'https://example.com/b')
    await vi.advanceTimersByTimeAsync(80)
    h.measure()
    h.bubble.targetUrl('page', '')
    await vi.advanceTimersByTimeAsync(249)
    expect(h.surface.withdraw).not.toHaveBeenCalled()
    // Back on a link meanwhile, it stays without a pause.
    h.bubble.targetUrl('page', 'https://example.com/b')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.surface.withdraw).not.toHaveBeenCalled()
    h.bubble.targetUrl('page', '')
    await vi.advanceTimersByTimeAsync(250)
    expect(h.surface.withdraw).toHaveBeenCalledOnce()
  })

  it('moves to the bottom right corner while the pointer comes near, and waits out of sight while it is near both', async () => {
    const h = setup()
    h.bubble.pointerMoved('page', 400, 300)
    h.bubble.targetUrl('page', 'https://example.com/docs')
    await vi.advanceTimersByTimeAsync(80)
    h.measure(180, 22)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 180, height: 22 })
    // 20 px from the bubble, in the page's coordinates.
    h.bubble.pointerMoved('page', 199, 560)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 820, y: 658, width: 180, height: 22 })
    // The corner that meets the page's corner changes with it.
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()).toMatchObject({ side: 'right' })
    h.measure(180, 22)
    expect(h.surface.setBounds).toHaveBeenCalledTimes(2)
    h.bubble.pointerMoved('page', 400, 300)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 180, height: 22 })
    // Widened across most of the page's bottom edge, neither corner is out of the pointer's way.
    h.bubble.targetUrl('page', 'https://example.com/a/very/long/path')
    await vi.advanceTimersByTimeAsync(0)
    h.measure(300, 22, true)
    await vi.advanceTimersByTimeAsync(1_600)
    h.measure(600, 22)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 600, height: 22 })
    h.bubble.pointerMoved('page', 450, 590)
    expect(h.surface.withdraw).toHaveBeenCalledOnce()
    const presented = h.surface.present.mock.calls.length
    h.bubble.pointerMoved('page', 450, 100)
    expect(h.surface.present).toHaveBeenCalledTimes(presented + 1)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 600, height: 22 })
  })

  it('moves out of the pointer\'s way at once when the pointer comes onto it, and gives back the keyboard a click there took', async () => {
    const h = setup()
    h.bubble.targetUrl('page', 'https://example.com/docs')
    await vi.advanceTimersByTimeAsync(80)
    h.measure(180, 22)
    h.focus.owner = 'the page'
    h.bubble.pointerOnBubble(30, 10)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 820, y: 658, width: 180, height: 22 })
    h.focus.owner = null
    h.bubble.viewFocused()
    expect(h.restoreFocus).toHaveBeenCalledExactlyOnceWith('the page')
    // Once it is gone, neither the pointer read from its view nor who had the keyboard then is kept.
    h.bubble.hide()
    h.bubble.viewFocused()
    expect(h.restoreFocus).toHaveBeenLastCalledWith(null)
    h.bubble.targetUrl('page', 'https://example.com/docs')
    await vi.advanceTimersByTimeAsync(80)
    h.measure(180, 22)
    expect(h.state()).toMatchObject({ side: 'left', opening: true })
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 180, height: 22 })
  })

  it('widens to the whole address after resting on one it had to shorten', async () => {
    const h = setup()
    h.bubble.targetUrl('page', 'https://example.com/a/very/long/path')
    await vi.advanceTimersByTimeAsync(80)
    h.measure(300, 22, true)
    await vi.advanceTimersByTimeAsync(1_599)
    expect(h.state()).toMatchObject({ maxWidth: 300 })
    // Another address starts the wait again.
    h.bubble.targetUrl('page', 'https://example.com/another/long/path')
    await vi.advanceTimersByTimeAsync(0)
    h.measure(300, 22, true)
    await vi.advanceTimersByTimeAsync(1_599)
    expect(h.state()).toMatchObject({ maxWidth: 300 })
    await vi.advanceTimersByTimeAsync(1)
    expect(h.state()).toMatchObject({ maxWidth: 900, text: { rest: '/another/long/path' } })
    h.measure(520, 22, false)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 658, width: 520, height: 22 })
    // An address that fits never widens.
    h.bubble.hide()
    h.bubble.targetUrl('page', 'https://example.com/')
    await vi.advanceTimersByTimeAsync(80)
    h.measure(140, 22, false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.state()).toMatchObject({ maxWidth: 300 })
  })

  it('belongs to the page that reported the link: another split pane leaving a link keeps it, and a page out of view shows none', async () => {
    const h = setup()
    h.panes.set('other', { bounds: { x: 1010, y: 80, width: 600, height: 600 }, corner: 12 })
    h.bubble.targetUrl('page', 'https://example.com/a')
    await vi.advanceTimersByTimeAsync(80)
    h.measure()
    h.bubble.targetUrl('other', '')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.surface.withdraw).not.toHaveBeenCalled()
    h.bubble.targetUrl('other', 'https://example.com/b')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()).toMatchObject({ maxWidth: 200, text: { rest: '/b' } })
    h.measure(150, 22)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 1010, y: 658, width: 150, height: 22 })
    h.bubble.hide()
    const sent = h.surface.send.mock.calls.length
    h.bubble.targetUrl('hidden', 'https://example.com/c')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.surface.send.mock.calls.length).toBe(sent)
  })

  it('follows its page as the pages are laid out again, and goes with it', async () => {
    const h = setup()
    h.bubble.targetUrl('page', 'https://example.com/a')
    await vi.advanceTimersByTimeAsync(80)
    h.measure(180, 22)
    h.panes.set('page', { bounds: { x: 300, y: 80, width: 900, height: 500 }, corner: 12 })
    h.bubble.layoutChanged()
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 300, y: 558, width: 180, height: 22 })
    // A narrower page lays it out again at its new width.
    h.panes.set('page', { bounds: { x: 300, y: 80, width: 600, height: 500 }, corner: 0 })
    h.bubble.layoutChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()).toMatchObject({ maxWidth: 200, corner: 0 })
    // Trusted chrome, another tab or a hidden window takes the page out of view, and the bubble with it.
    const presented = h.surface.present.mock.calls.length
    h.panes.delete('page')
    h.bubble.layoutChanged()
    expect(h.surface.withdraw).toHaveBeenCalledOnce()
    h.panes.set('page', { bounds: { x: 300, y: 80, width: 600, height: 500 }, corner: 0 })
    h.bubble.layoutChanged()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.surface.present).toHaveBeenCalledTimes(presented)
  })

  it('scales with the shell, keeps to its largest box and drops a stale measurement', async () => {
    const h = setup()
    h.zoom.value = 1.25
    h.bubble.targetUrl('page', 'https://example.com/a')
    await vi.advanceTimersByTimeAsync(80)
    expect(h.state()).toMatchObject({ maxWidth: 240, corner: 10 })
    expect(h.surface.setZoomFactor).toHaveBeenLastCalledWith(1.25)
    const first = h.state()!.id
    h.bubble.targetUrl('page', 'https://example.com/b')
    await vi.advanceTimersByTimeAsync(0)
    h.bubble.measured({ id: first, width: 100, height: 20, shortened: false })
    expect(h.surface.setBounds).not.toHaveBeenCalled()
    h.measure(5_000, 500)
    expect(h.surface.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 630, width: 300, height: 50 })
  })

  it('starts again with a new view after its view is gone', async () => {
    const h = setup()
    h.bubble.targetUrl('page', 'https://example.com/a')
    await vi.advanceTimersByTimeAsync(80)
    h.measure()
    h.destroy()
    h.bubble.surfaceLost()
    h.bubble.pointerMoved('page', 10, 590)
    expect(h.surface.setBounds).toHaveBeenCalledOnce()
    h.bubble.targetUrl('page', 'https://example.com/b')
    await vi.advanceTimersByTimeAsync(80)
    expect(h.state()?.text.rest).toBe('/a')
  })
})
