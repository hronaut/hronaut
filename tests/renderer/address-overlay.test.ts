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
    // The row's button does not take focus within the view all the same.
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

describe('Switch to this tab in the address suggestions view', () => {
  // The view scrolls the highlighted row into view, which jsdom does not lay out.
  afterEach(() => { delete (Element.prototype as Partial<Element>).scrollIntoView })

  async function shown(state: Partial<AddressSuggestionOverlayState>) {
    document.body.innerHTML = '<div id="address-overlay-root"></div>'
    Element.prototype.scrollIntoView = vi.fn()
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
      suggestions: [
        { id: 'history:docs', kind: 'history', title: 'Docs', url: 'https://docs.example/', openTabId: 'tab-2' },
        { id: 'tab:tab-3', kind: 'tab', title: 'Dashboard', url: 'https://app.example/', openTabId: 'tab-3' },
        { id: 'bookmark:plain', kind: 'bookmark', title: 'Plain', url: 'https://plain.example/' }
      ],
      selectedIndex: 0,
      theme: 'light',
      locale: 'en-US',
      ...state
    })
    const rows = [...document.querySelectorAll<HTMLButtonElement>('[role=option]')]
    return { select, rows }
  }

  it('offers it on a bookmark or visit open in another tab, and shows when Tab went on to it', async () => {
    const { rows } = await shown({ selectedAction: 'switch-tab' })
    expect(rows.map(row => row.querySelector('.address-suggestion-switch')?.textContent ?? null)).toEqual(['Switch to this tab', null, null])
    expect(rows[0].querySelector('.address-suggestion-switch')!.classList.contains('focused')).toBe(true)
    // An open tab's own row switches to it, and says it is an open tab.
    expect(rows[1].querySelector('small')!.textContent).toBe('Open tab')
    expect(document.querySelector('footer')!.textContent).toContain('@tabs')
  })

  it('draws the button unfocused while the row itself is highlighted', async () => {
    const { rows } = await shown({})
    expect(rows[0].querySelector('.address-suggestion-switch')!.classList.contains('focused')).toBe(false)
  })

  it('switches with a press or click on the button, and opens the row anywhere else on it', async () => {
    const { select, rows } = await shown({})
    const chip = rows[0].querySelector<HTMLElement>('.address-suggestion-switch')!
    chip.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }))
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:docs', action: 'switch-tab' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    chip.click()
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:docs', action: 'switch-tab' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    rows[0].querySelector('strong')!.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }))
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:docs' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A middle-click on the button opens the row in a new tab behind, as on the rest of the row.
    chip.dispatchEvent(new PointerEvent('pointerdown', { button: 1, bubbles: true, cancelable: true }))
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:docs', disposition: 'new-background-tab' })
    expect(select).toHaveBeenCalledTimes(4)
  })
})
