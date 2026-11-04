import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, PopupOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({
  templates: [] as MenuItemConstructorOptions[][],
  popups: [] as PopupOptions[],
  popupFailure: undefined as Error | undefined
}))

vi.mock('electron', () => ({
  app: { isEmojiPanelSupported: () => false },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.templates.push(template)
      return {
        popup: (options: PopupOptions) => {
          if (built.popupFailure) throw built.popupFailure
          built.popups.push(options)
        }
      }
    }
  }
}))

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
type MenuBrowser = Parameters<typeof showContextMenu>[0]

// Following an agent could bring another tab into view while the page's menu was open, after the few seconds it waits
// once the person right-clicks, and Paste or any other item then acted on the page that had left the view.

function openMenu(whileOpen?: () => () => void) {
  const paste = vi.fn()
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    paste,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab = { id: 'tab', url: 'https://mail.example/compose', mcpGroupId: 'client', webContents }
  const onActionFailed = vi.fn()
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: 'tab',
    tabSelectionGeneration: 4,
    splitTabIds: [] as string[],
    splitViewContains(tabId: string) { return this.splitTabIds.includes(tabId) },
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false
  }
  showContextMenu(browser as unknown as MenuBrowser, tab as never, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: true, formControlType: 'none', mediaType: 'none',
    misspelledWord: '', dictionarySuggestions: [], editFlags: { canPaste: true },
    pageURL: tab.url, frameURL: tab.url, referrerPolicy: 'strict-origin-when-cross-origin'
  } as unknown as ContextMenuParams, whileOpen)
  const template = built.templates.at(-1)!
  const choose = (id: string) => (template.find((item) => item.id === id)!.click as () => void)()
  return { browser, paste, onActionFailed, choose, choosePaste: () => choose('paste') }
}

afterEach(() => {
  built.templates.length = 0
  built.popups.length = 0
  built.popupFailure = undefined
})

describe('the page menu while another tab comes into view', () => {
  it('acts on its page while that page is still shown, also after it was selected again or shares a split view', () => {
    const { browser, paste, onActionFailed, choosePaste } = openMenu()
    choosePaste()
    browser.tabSelectionGeneration += 1
    choosePaste()
    browser.activeTabId = 'other'
    browser.splitTabIds = ['other', 'tab']
    choosePaste()
    expect(paste).toHaveBeenCalledTimes(3)
    expect(onActionFailed).not.toHaveBeenCalled()
  })

  it('refuses an item once another tab took its page\'s place, instead of acting on the hidden page', () => {
    const { browser, paste, onActionFailed, choosePaste } = openMenu()
    browser.activeTabId = 'other'
    browser.tabSelectionGeneration += 1
    choosePaste()
    expect(paste).not.toHaveBeenCalled()
    expect(onActionFailed).toHaveBeenCalledExactlyOnceWith('paste', expect.objectContaining({ message: 'The tab is no longer shown.' }))
  })

  it('refuses the items that act on the page without checking its tab, such as Reload, the same way', () => {
    const { browser, onActionFailed, choose } = openMenu()
    browser.activeTabId = 'other'
    browser.tabSelectionGeneration += 1
    choose('reload')
    choose('inspect-element')
    expect(onActionFailed.mock.calls.map(([action, error]) => [action, (error as Error).message])).toEqual([
      ['reload', 'The tab is no longer shown.'],
      ['inspect element', 'The tab is no longer shown.']
    ])
  })

  it('tells following that it opened, and that it closed once the menu closes', () => {
    const closed = vi.fn()
    const whileOpen = vi.fn(() => closed)
    openMenu(whileOpen)
    expect(whileOpen).toHaveBeenCalledOnce()
    expect(built.popups).toHaveLength(1)
    expect(closed).not.toHaveBeenCalled()
    built.popups[0]!.callback!()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('tells following that it closed when the menu cannot open', () => {
    const closed = vi.fn()
    built.popupFailure = new Error('No window to show the menu in')
    expect(() => openMenu(() => closed)).toThrow('No window to show the menu in')
    expect(closed).toHaveBeenCalledOnce()
  })
})
