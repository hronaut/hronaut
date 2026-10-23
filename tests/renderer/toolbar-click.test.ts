import { describe, expect, it } from 'vitest'
import { toolbarClickAction } from '../../src/renderer/src/toolbar-click.js'

// The toolbar's Back, Forward and Reload took every click as a plain one, where Chrome opens their page in a new tab
// for a middle-click or Ctrl+click, and reloads without the cache for Shift+click or Ctrl+click on Reload.

const click = (init: MouseEventInit = {}): MouseEvent => new MouseEvent('click', init)
const middle = (init: MouseEventInit = {}): MouseEvent => new MouseEvent('auxclick', { button: 1, ...init })

describe('what a click on Back, Forward or Reload does, as in Chrome', () => {
  it('opens Back\'s or Forward\'s page in a new tab for a middle-click or Ctrl+click, in front with Shift', () => {
    for (const button of ['back', 'forward'] as const) {
      expect(toolbarClickAction(button, middle(), false)).toBe('new-background-tab')
      expect(toolbarClickAction(button, middle({ shiftKey: true }), false)).toBe('new-tab')
      expect(toolbarClickAction(button, click({ ctrlKey: true }), false)).toBe('new-background-tab')
      expect(toolbarClickAction(button, click({ ctrlKey: true, shiftKey: true }), false)).toBe('new-tab')
      // ⌘ on a Mac, where Ctrl+click is a right-click; the Windows or Super key elsewhere is the system's.
      expect(toolbarClickAction(button, click({ metaKey: true }), true)).toBe('new-background-tab')
      expect(toolbarClickAction(button, click({ metaKey: true, shiftKey: true }), true)).toBe('new-tab')
      expect(toolbarClickAction(button, click({ ctrlKey: true }), true)).toBeUndefined()
      expect(toolbarClickAction(button, click({ metaKey: true }), false)).toBeUndefined()
    }
  })

  it('reloads without the cache for Shift+click or Ctrl+click on Reload, and opens its page in a new tab behind for a middle-click', () => {
    for (const mac of [false, true]) {
      expect(toolbarClickAction('reload', click({ shiftKey: true }), mac)).toBe('reload-ignoring-cache')
      expect(toolbarClickAction('reload', click({ ctrlKey: true }), mac)).toBe('reload-ignoring-cache')
      // Chrome takes Shift on Reload for the cache, so it never brings the new tab in front.
      expect(toolbarClickAction('reload', middle(), mac)).toBe('new-background-tab')
      expect(toolbarClickAction('reload', middle({ shiftKey: true }), mac)).toBe('new-background-tab')
    }
    expect(toolbarClickAction('reload', click({ metaKey: true }), true)).toBe('new-background-tab')
    expect(toolbarClickAction('reload', click({ metaKey: true }), false)).toBeUndefined()
  })

  it('leaves a plain click, Alt+click, and Shift+click on Back or Forward, which opens a window in Chrome, as a plain click', () => {
    for (const button of ['back', 'forward', 'reload'] as const) {
      expect(toolbarClickAction(button, click(), false)).toBeUndefined()
      expect(toolbarClickAction(button, click({ altKey: true }), true)).toBeUndefined()
    }
    expect(toolbarClickAction('back', click({ shiftKey: true }), false)).toBeUndefined()
    expect(toolbarClickAction('forward', click({ shiftKey: true }), true)).toBeUndefined()
  })
})
