import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellTooltipState } from '../../src/shared/shell-tooltip.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  document.body.replaceChildren()
  delete document.documentElement.dataset.theme
})

describe('native tooltip view', () => {
  it('renders the text as plain text in the theme and reports its size while hidden', async () => {
    document.body.innerHTML = '<main id="tooltip-overlay-root"></main>'
    const measured = vi.fn()
    let receive!: (state: ShellTooltipState) => void
    vi.stubGlobal('hronautTooltipOverlayView', {
      onState: (listener: typeof receive) => { receive = listener; return () => undefined },
      measured
    })
    // A hidden view may never produce a frame, so the size is read without waiting for one.
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 95.2, height: 20.4 } as DOMRect)
    await import('../../src/renderer/src/tooltip-overlay.js')

    receive({ id: 4, text: 'Example <b>page</b>\n\nExample workspace', theme: 'sepia' })
    const tooltip = document.querySelector<HTMLElement>('[role=tooltip]')!
    expect(tooltip.textContent).toBe('Example <b>page</b>\n\nExample workspace')
    expect(tooltip.querySelector('b')).toBeNull()
    expect(document.documentElement.dataset.theme).toBe('sepia')
    expect(measured).toHaveBeenCalledExactlyOnceWith({ id: 4, width: 96, height: 21 })
    expect(frame).not.toHaveBeenCalled()

    receive({ id: 5, text: 'Settings', theme: 'dark' })
    expect(measured).toHaveBeenLastCalledWith({ id: 5, width: 96, height: 21 })
    expect(document.querySelectorAll('[role=tooltip]')).toHaveLength(1)
  })
})
