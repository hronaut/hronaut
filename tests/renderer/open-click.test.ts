import { describe, expect, it, vi } from 'vitest'
import { asMiddleClick, openClickTab } from '../../src/renderer/src/open-click.js'

describe('where a click on a bookmark or visit opens it, as Chrome opens a link', () => {
  it('opens it in a new tab behind for a middle-click or Ctrl+click (⌘-click on a Mac), and in front with Shift', () => {
    const middle = (init: MouseEventInit = {}): MouseEvent => new MouseEvent('auxclick', { button: 1, ...init })
    for (const mac of [false, true]) {
      expect(openClickTab(middle(), mac)).toBe('new-background-tab')
      expect(openClickTab(middle({ shiftKey: true }), mac)).toBe('new-tab')
    }
    expect(openClickTab(new MouseEvent('click', { ctrlKey: true }), false)).toBe('new-background-tab')
    expect(openClickTab(new MouseEvent('click', { ctrlKey: true, shiftKey: true }), false)).toBe('new-tab')
    expect(openClickTab(new MouseEvent('click', { metaKey: true }), true)).toBe('new-background-tab')
    // A plain click, Shift+click (a new window in Chrome), Ctrl+click on a Mac (a right-click there) and the Windows or
    // Super key elsewhere open it as a click does.
    for (const [init, mac] of [[{}, false], [{ shiftKey: true }, false], [{ altKey: true }, true], [{ ctrlKey: true }, true], [{ metaKey: true }, false]] as const) {
      expect(openClickTab(new MouseEvent('click', init), mac), JSON.stringify(init)).toBeUndefined()
    }
  })

  it('takes a middle-click on an enabled button as a click, keeping it from scrolling or pasting', () => {
    const button = document.createElement('button')
    const click = vi.fn()
    button.addEventListener('auxclick', event => asMiddleClick(event, click))
    const press = (init: MouseEventInit): MouseEvent => {
      const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, ...init })
      button.dispatchEvent(event)
      return event
    }

    const middle = press({ button: 1 })
    expect(click).toHaveBeenCalledExactlyOnceWith(middle)
    expect(middle.defaultPrevented).toBe(true)
    expect(press({ button: 2 }).defaultPrevented).toBe(false)
    button.disabled = true
    press({ button: 1 })
    expect(click).toHaveBeenCalledOnce()
  })
})
