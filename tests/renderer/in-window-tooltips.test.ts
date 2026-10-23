import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInWindowTooltipPort } from '../../src/renderer/src/composables/in-window-tooltips.js'
import type { ShellTooltipRequest } from '../../src/shared/shell-tooltip.js'

function request(overrides: Partial<ShellTooltipRequest> = {}): ShellTooltipRequest {
  return { id: 1, text: 'Clear console', anchor: { x: 600, y: 8, width: 32, height: 32 }, placement: 'bottom', theme: 'dark', ...overrides }
}

function shown(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.shell-window-tooltip')]
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 24 } as DOMRect)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('in-window tooltips', () => {
  it('draws the tooltip beside its control, out of the accessibility tree and the pointer\'s way', () => {
    createInWindowTooltipPort().showTooltip(request({ text: 'Line one\nLine two' }))
    const [tooltip] = shown()
    expect(tooltip.textContent).toBe('Line one\nLine two')
    expect(tooltip.getAttribute('aria-hidden')).toBe('true')
    expect(tooltip.style).toMatchObject({ left: '566px', top: '46px', visibility: '' })
  })

  it('flips to the other side where the window has no room, and stays unseen where neither side has', () => {
    const port = createInWindowTooltipPort()
    port.showTooltip(request({ anchor: { x: 600, y: 730, width: 32, height: 32 } }))
    expect(shown()[0].style).toMatchObject({ top: '700px', visibility: '' })
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(40)
    port.showTooltip(request({ id: 2 }))
    expect(shown()).toHaveLength(1)
    expect(shown()[0].style.visibility).toBe('hidden')
  })

  it('shows one tooltip at a time and hides only the one it is asked to', () => {
    const port = createInWindowTooltipPort()
    port.showTooltip(request())
    port.showTooltip(request({ id: 2, text: 'Search tabs' }))
    expect(shown().map((tooltip) => tooltip.textContent)).toEqual(['Search tabs'])
    port.hideTooltip(1)
    expect(shown()).toHaveLength(1)
    port.hideTooltip(2)
    expect(shown()).toEqual([])
    port.showTooltip(request({ id: 3 }))
    port.hideTooltip()
    expect(shown()).toEqual([])
  })
})
