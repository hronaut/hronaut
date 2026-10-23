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
      platform: 'linux',
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
      platform: 'linux',
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

  it('chooses a row with the primary button, opens it in a new tab with the middle one, and ignores a right click', async () => {
    // A right or middle click on a row opened it in the tab, where Chrome leaves the tab as it is; a middle-click
    // opens the row in a new tab behind, as in Chrome.
    document.body.innerHTML = '<div id="address-overlay-root"></div>'
    const select = vi.fn()
    let receiveState!: (state: AddressSuggestionOverlayState) => void
    vi.stubGlobal('hronautAddressOverlayView', {
      platform: 'linux',
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
    const press = new PointerEvent('pointerdown', { button: 2, bubbles: true, cancelable: true })
    row.dispatchEvent(press)
    // Focus stays in the address field all the same.
    expect(press.defaultPrevented).toBe(true)
    expect(select).not.toHaveBeenCalled()
    const middle = new PointerEvent('pointerdown', { button: 1, bubbles: true, cancelable: true })
    row.dispatchEvent(middle)
    expect(middle.defaultPrevented).toBe(true)
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:google', disposition: 'new-background-tab' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    row.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }))
    expect(select).toHaveBeenLastCalledWith({ sessionId: 1, suggestionId: 'history:google' })
  })

  for (const platform of ['linux', 'darwin'] as const) {
    it(`opens a row in a new tab for ${platform === 'darwin' ? '⌘' : 'Ctrl'}+click, in front with Shift, as Chrome does on ${platform}`, async () => {
      document.body.innerHTML = '<div id="address-overlay-root"></div>'
      const select = vi.fn()
      let receiveState!: (state: AddressSuggestionOverlayState) => void
      vi.stubGlobal('hronautAddressOverlayView', {
        platform,
        onState: (listener: typeof receiveState) => { receiveState = listener; return () => undefined },
        select,
        measured: vi.fn()
      })
      await import('../../src/renderer/src/address-overlay.js')
      receiveState({
        sessionId: 3,
        suggestions: [{ id: 'bookmark:docs', kind: 'bookmark', title: 'Docs', url: 'https://docs.example/' }],
        selectedIndex: -1,
        theme: 'dark',
        locale: 'en-US'
      })
      const row = document.querySelector<HTMLButtonElement>('[role=option]')!
      const tabKey = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true }
      const otherKey = platform === 'darwin' ? { ctrlKey: true } : { metaKey: true }
      const pick = async (init: PointerEventInit): Promise<unknown> => {
        row.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true, ...init }))
        // A pick of the same row is sent once per moment, as its click follows its press.
        await new Promise((resolve) => setTimeout(resolve, 0))
        return select.mock.calls.at(-1)?.[0] as unknown
      }
      expect(await pick(tabKey)).toEqual({ sessionId: 3, suggestionId: 'bookmark:docs', disposition: 'new-background-tab' })
      expect(await pick({ ...tabKey, shiftKey: true })).toEqual({ sessionId: 3, suggestionId: 'bookmark:docs', disposition: 'new-tab' })
      // The other platform's key, and Shift alone, which opens a new window in Chrome, choose the row as a plain click does.
      expect(await pick(otherKey)).toEqual({ sessionId: 3, suggestionId: 'bookmark:docs' })
      expect(await pick({ shiftKey: true })).toEqual({ sessionId: 3, suggestionId: 'bookmark:docs' })
      // A click from the keyboard carries its keys too.
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, ...tabKey }))
      expect(select.mock.calls.at(-1)?.[0]).toEqual({ sessionId: 3, suggestionId: 'bookmark:docs', disposition: 'new-background-tab' })
    })
  }
})
