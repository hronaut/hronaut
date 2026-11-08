import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, PopupOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({ popups: [] as PopupOptions[] }))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: () => ({ popup: (options: PopupOptions) => { built.popups.push(options) } })
  }
}))

const { attachPageContextMenuEvents, pageMenuPoint } = await import('../src/main/browser/context-menus/page-context-menu-events.js')
type MenuBrowser = Parameters<typeof attachPageContextMenuEvents>[0]
type MenuTab = Parameters<typeof attachPageContextMenuEvents>[1]

// The page's view sits below the toolbar and beside the rail, so a point in the page is not one in the window.
const VIEW = { x: 56, y: 88, width: 900, height: 600 }

function pageWithMenu(locked = false, lockChange?: 'tab' | 'all') {
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  })
  const tab = {
    id: 'tab', url: 'https://docs.example/guide', mcpGroupId: 'client', webContents, view: { getBounds: () => VIEW },
    inputLock: { pendingChanges: lockChange === 'tab' ? 1 : 0 }
  }
  const closed = vi.fn()
  const pageMenuOpened = vi.fn(() => closed)
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: 'tab',
    tabSelectionGeneration: 1,
    splitViewContains: () => false,
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined },
    text: (key: string) => key,
    isHumanInteractionLocked: () => locked,
    globalInputLockChanges: lockChange === 'all' ? 1 : 0,
    mcpActivityFollower: { pageMenuOpened }
  }
  attachPageContextMenuEvents(browser as unknown as MenuBrowser, tab as unknown as MenuTab, webContents as unknown as WebContents)
  const open = (params: Partial<ContextMenuParams>) => {
    const preventDefault = vi.fn()
    webContents.emit('context-menu', { preventDefault }, {
      x: 0, y: 0, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
      menuSourceType: 'mouse', pageURL: tab.url, frameURL: tab.url, referrerPolicy: 'strict-origin-when-cross-origin', ...params
    })
    return preventDefault
  }
  return { open, pageMenuOpened, closed }
}

afterEach(() => {
  built.popups.length = 0
})

describe('where the page menu opens', () => {
  it('opens at the point the page reports, in the window, as the keyboard or mouse that asked for it', () => {
    // Shift+F10 and the Menu key opened the menu at the mouse pointer, wherever it was, instead of at the focused element.
    const page = pageWithMenu()
    expect(page.open({ x: 120, y: 40, menuSourceType: 'keyboard' })).toHaveBeenCalledOnce()
    page.open({ x: 300, y: 210, menuSourceType: 'mouse' })
    expect(built.popups.map(({ x, y, sourceType }) => ({ x, y, sourceType }))).toEqual([
      { x: 176, y: 128, sourceType: 'keyboard' },
      { x: 356, y: 298, sourceType: 'mouse' }
    ])
    // Following still waits while each menu is open.
    expect(page.pageMenuOpened).toHaveBeenCalledTimes(2)
    built.popups[0]!.callback!()
    expect(page.closed).toHaveBeenCalledOnce()
  })

  it('keeps a point the keyboard asked for inside the page\'s view, on whole pixels', () => {
    expect(pageMenuPoint(VIEW, { x: -4, y: 700, menuSourceType: 'keyboard' })).toEqual({ x: 56, y: 687 })
    expect(pageMenuPoint(VIEW, { x: 950.6, y: 12.4, menuSourceType: 'keyboard' })).toEqual({ x: 955, y: 100 })
    expect(pageMenuPoint(VIEW, { x: 449.5, y: 0, menuSourceType: 'longPress' })).toEqual({ x: 506, y: 88 })
  })

  it('keeps a mouse\'s point where the button was let go, also over the toolbar', () => {
    // On Windows the menu opens as the button is let go, which can be after a drag out of the page.
    expect(pageMenuPoint(VIEW, { x: 120.4, y: -30, menuSourceType: 'mouse' })).toEqual({ x: 176, y: 58 })
    expect(pageMenuPoint(VIEW, { x: 1000, y: 650, menuSourceType: 'mouse' })).toEqual({ x: 1056, y: 738 })
  })

  it('opens no menu while the person\'s input to the page is locked', () => {
    const page = pageWithMenu(true)
    expect(page.open({ x: 120, y: 40, menuSourceType: 'keyboard' })).toHaveBeenCalledOnce()
    expect(built.popups).toEqual([])
    expect(page.pageMenuOpened).not.toHaveBeenCalled()
  })

  // An unlock reads as done as soon as it is asked for, while it waits for the page behind an agent's right-click or
  // Shift+F10, which needs the page locked; the page's menu that input opens must not become Hronaut's, with its Paste.
  it.each([['this tab', 'tab'], ['every tab', 'all']] as const)('opens no menu while an unlock for %s waits for the page', (_name, lockChange) => {
    const page = pageWithMenu(false, lockChange)
    expect(page.open({ x: 120, y: 40, menuSourceType: 'mouse' })).toHaveBeenCalledOnce()
    expect(built.popups).toEqual([])
    expect(page.pageMenuOpened).not.toHaveBeenCalled()
  })
})
