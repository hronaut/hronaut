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
      sessionId: 1,
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

  it('keeps the original session on a button retained after the popup rerenders', async () => {
    document.body.innerHTML = '<div id="address-overlay-root"></div>'
    const select = vi.fn()
    let receiveState!: (state: AddressSuggestionOverlayState) => void
    vi.stubGlobal('hronautAddressOverlayView', {
      onState: (listener: typeof receiveState) => { receiveState = listener; return () => undefined },
      select,
      measured: vi.fn()
    })
    await import('../../src/renderer/src/address-overlay.js')
    const state: AddressSuggestionOverlayState = {
      sessionId: 1,
      suggestions: [{ id: 'history:google', kind: 'history', title: 'Search engine', url: 'https://www.google.com/' }],
      selectedIndex: -1,
      theme: 'light',
      locale: 'en-US'
    }
    receiveState(state)
    const oldButton = document.querySelector<HTMLButtonElement>('[role=option]')!
    receiveState({ ...state, sessionId: 2 })
    oldButton.click()
    document.querySelector<HTMLButtonElement>('[role=option]')!.click()
    expect(select).toHaveBeenNthCalledWith(1, { sessionId: 1, suggestionId: 'history:google' })
    expect(select).toHaveBeenNthCalledWith(2, { sessionId: 2, suggestionId: 'history:google' })
  })

  it('chooses a row with the primary button, opens it in a new tab behind with the middle one, and ignores the right', async () => {
    // A right or middle click on a row opened it in the tab. In Chrome a right click leaves the tab as it is and a
    // middle-click opens the row in a new tab behind.
    document.body.innerHTML = '<div id="address-overlay-root"></div>'
    const select = vi.fn()
    let receiveState!: (state: AddressSuggestionOverlayState) => void
    vi.stubGlobal('hronautAddressOverlayView', {
      onState: (listener: typeof receiveState) => { receiveState = listener; return () => undefined },
      select,
      measured: vi.fn()
    })
    await import('../../src/renderer/src/address-overlay.js')
    receiveState({
      sessionId: 1,
      suggestions: [{ id: 'history:google', kind: 'history', title: 'Search engine', url: 'https://www.google.com/' }],
      selectedIndex: -1,
      theme: 'light',
      locale: 'en-US'
    })
    const row = document.querySelector<HTMLButtonElement>('[role=option]')!
    const right = new PointerEvent('pointerdown', { button: 2, bubbles: true, cancelable: true })
    row.dispatchEvent(right)
    // Focus stays in the address field all the same.
    expect(right.defaultPrevented).toBe(true)
    expect(select).not.toHaveBeenCalled()
    const middle = new PointerEvent('pointerdown', { button: 1, shiftKey: true, bubbles: true, cancelable: true })
    row.dispatchEvent(middle)
    expect(middle.defaultPrevented).toBe(true)
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:google', disposition: 'new-background-tab' })
    // The same row is picked once for one press, so the next press waits a moment.
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Chrome opens a row in the tab for a click with Ctrl, ⌘ or Shift held, as for a plain one.
    row.dispatchEvent(new PointerEvent('pointerdown', { button: 0, ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:google' })
    expect(select).toHaveBeenCalledTimes(2)
  })
})
