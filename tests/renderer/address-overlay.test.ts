import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressSuggestionOverlayState } from '../../src/shared/address-suggestions.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  document.body.replaceChildren()
})

describe('native address overlay renderer', () => {
  it('reports each layout while hidden without waiting for an animation frame', async () => {
    document.body.innerHTML = '<div id="address-overlay-root"></div>'
    const measured = vi.fn()
    let receiveState!: (state: AddressSuggestionOverlayState) => void
    vi.stubGlobal('hronautAddressOverlayView', {
      onState: (listener: typeof receiveState) => { receiveState = listener; return () => undefined },
      select: vi.fn(),
      measured
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(120)
    await import('../../src/renderer/src/address-overlay.js')

    const state: AddressSuggestionOverlayState = {
      suggestions: [{ id: 'history:google', kind: 'history', title: 'Search engine', url: 'https://www.google.com/' }],
      selectedIndex: -1,
      theme: 'light',
      locale: 'en-US'
    }
    receiveState(state)

    expect(document.querySelector('[role=option]')?.textContent).toContain('https://www.google.com/')
    expect(measured).toHaveBeenLastCalledWith(122)
    receiveState({ ...state, suggestions: [] })
    expect(measured).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role=option]')).toBeNull()
  })
})
