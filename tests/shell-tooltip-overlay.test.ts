import { describe, expect, it, vi } from 'vitest'
import { ShellTooltipOverlay, type ShellTooltipSurface } from '../src/main/shell-tooltip-overlay.js'
import type { ShellTooltipRequest } from '../src/shared/shell-tooltip.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function surface() {
  let destroyed = false
  const value = {
    send: vi.fn(),
    setZoomFactor: vi.fn(),
    setBounds: vi.fn(),
    present: vi.fn(),
    withdraw: vi.fn(),
    isDestroyed: () => destroyed
  } satisfies ShellTooltipSurface
  return Object.assign(value, { destroy: () => { destroyed = true } })
}

const request = (id: number, overrides: Partial<ShellTooltipRequest> = {}): ShellTooltipRequest => ({
  id,
  text: `Tooltip ${id}`,
  anchor: { x: 600, y: 8, width: 32, height: 32 },
  placement: 'bottom',
  theme: 'dark',
  ...overrides
})

function setup() {
  const view = surface()
  const loaded = deferred<ShellTooltipSurface>()
  let size: { width: number; height: number } | null = { width: 1400, height: 900 }
  const overlay = new ShellTooltipOverlay({ surface: () => loaded.promise, windowSize: () => size })
  return { overlay, view, load: () => loaded.resolve(view), setSize: (next: typeof size) => { size = next } }
}

describe('shell tooltip overlay', () => {
  it('shows the measured tooltip beside its control, above the page views, at the shell zoom', async () => {
    const { overlay, view, load } = setup()
    overlay.show(request(1), 1.25)
    load()
    await vi.waitFor(() => expect(view.send).toHaveBeenCalledWith({ id: 1, text: 'Tooltip 1', theme: 'dark' }))
    expect(view.setZoomFactor).toHaveBeenCalledWith(1.25)
    // Nothing is drawn until the view knows the text's size.
    expect(view.present).not.toHaveBeenCalled()

    overlay.measured({ id: 1, width: 96, height: 20 })
    // 96 × 20 CSS pixels at 125% is 120 × 25, centred 7.5 px under the control's 40 × 40 box at (750, 10), with 5 px of shadow room.
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 705, y: 53, width: 130, height: 35 })
    expect(view.present).toHaveBeenCalledOnce()
    expect(view.setBounds.mock.invocationCallOrder[0]).toBeLessThan(view.present.mock.invocationCallOrder[0]!)
  })

  it('ignores a late measurement or load for a tooltip that was replaced or hidden', async () => {
    const { overlay, view, load } = setup()
    overlay.show(request(1), 1)
    overlay.show(request(2), 1)
    load()
    await vi.waitFor(() => expect(view.send).toHaveBeenCalledOnce())
    expect(view.send).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    overlay.measured({ id: 1, width: 96, height: 20 })
    expect(view.setBounds).not.toHaveBeenCalled()

    // Hiding an older id leaves the current tooltip alone; hiding the current one clears it.
    overlay.hide(1)
    overlay.measured({ id: 2, width: 96, height: 20 })
    expect(view.present).toHaveBeenCalledOnce()
    expect(view.withdraw).not.toHaveBeenCalled()
    // Hiding takes the view out of the window, so it never stays above the page views unseen.
    overlay.hide(2)
    expect(view.withdraw).toHaveBeenCalledOnce()
    overlay.measured({ id: 2, width: 96, height: 20 })
    expect(view.setBounds).toHaveBeenCalledOnce()
    expect(view.present).toHaveBeenCalledOnce()
  })

  it('places a remeasured tooltip again, and shows nothing while the window cannot', async () => {
    const { overlay, view, load, setSize } = setup()
    overlay.show(request(1), 1)
    load()
    await vi.waitFor(() => expect(view.send).toHaveBeenCalledOnce())
    overlay.measured({ id: 1, width: 90, height: 20 })
    // The bundled font loaded after the first layout.
    overlay.measured({ id: 1, width: 96, height: 20 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 564, y: 42, width: 104, height: 28 })

    expect(view.present).toHaveBeenCalledTimes(2)

    // The next tooltip withdraws the shown one until it is measured.
    overlay.show(request(2), 1)
    expect(view.withdraw).toHaveBeenCalledOnce()
    setSize(null)
    await vi.waitFor(() => expect(view.send).toHaveBeenCalledTimes(2))
    overlay.measured({ id: 2, width: 96, height: 20 })
    expect(view.present).toHaveBeenCalledTimes(2)
  })

  it('never draws more than the largest tooltip, and nothing that would cover its control', async () => {
    const { overlay, view, load, setSize } = setup()
    overlay.show(request(1), 1)
    load()
    await vi.waitFor(() => expect(view.send).toHaveBeenCalledOnce())
    // A view that reports an oversized box still gets at most 320 × 240 plus its shadow room.
    overlay.measured({ id: 1, width: 5000, height: 5000 })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 452, y: 42, width: 328, height: 248 })

    // In a short window, a tall tooltip for a control in the middle fits neither above nor below it.
    setSize({ width: 1400, height: 400 })
    overlay.show(request(2, { anchor: { x: 600, y: 150, width: 120, height: 32 } }), 1)
    await vi.waitFor(() => expect(view.send).toHaveBeenCalledTimes(2))
    overlay.measured({ id: 2, width: 320, height: 240 })
    expect(view.present).toHaveBeenCalledOnce()
    expect(view.withdraw).toHaveBeenCalledTimes(2)
  })

  it('starts over with a new view once the old one is gone, and stops after dispose', async () => {
    const { overlay, view, load } = setup()
    overlay.show(request(1), 1)
    load()
    await vi.waitFor(() => expect(view.send).toHaveBeenCalledOnce())
    view.destroy()
    overlay.surfaceLost()
    overlay.measured({ id: 1, width: 96, height: 20 })
    expect(view.setBounds).not.toHaveBeenCalled()

    overlay.dispose()
    overlay.show(request(2), 1)
    await Promise.resolve()
    expect(view.send).toHaveBeenCalledOnce()
  })
})
