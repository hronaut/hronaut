import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({
  templates: [] as MenuItemConstructorOptions[][],
  has: (async () => true) as (type: string) => Promise<boolean>,
  asked: [] as string[]
}))

vi.mock('electron', () => ({
  app: { isEmojiPanelSupported: () => false, showEmojiPanel: () => undefined },
  clipboard: {
    has: (type: string) => {
      built.asked.push(type)
      return built.has(type)
    }
  },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.templates.push(template)
      return { popup: () => undefined }
    }
  }
}))

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
const { attachPageContextMenuEvents } = await import('../src/main/browser/context-menus/page-context-menu-events.js')
type MenuBrowser = Parameters<typeof showContextMenu>[0]
type MenuTab = Parameters<typeof showContextMenu>[1]

const PAGE = 'https://mail.example/compose'
const editable = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: true }
const fieldParams = {
  x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: true, mediaType: 'none', editFlags: editable,
  misspelledWord: '', dictionarySuggestions: [], formControlType: 'text-area', menuSourceType: 'mouse',
  pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin'
}

// A text field's Paste and Match Style was offered with an image on the clipboard, which has no text to paste, and kept
// macOS's name on Windows and Linux; Chrome greys it out without text there and names it Paste as plain text. Electron
// already greys out Paste, as Chrome does, while the clipboard holds nothing: its editFlags.canPaste says so.

function page(options: { locked?: () => boolean } = {}) {
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: (): boolean => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    paste: vi.fn(),
    pasteAndMatchStyle: vi.fn()
  })
  const tab = { id: 'tab', url: PAGE, webContents, view: { getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) } }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: 'tab',
    tabSelectionGeneration: 1,
    splitViewContains: () => false,
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed: vi.fn(), getSearchEngine: () => 'google' },
    text: (key: string) => key,
    isHumanInteractionLocked: options.locked ?? (() => false),
    mcpActivityFollower: { pageMenuOpened: () => () => undefined }
  }
  return { browser: browser as unknown as MenuBrowser, tab: tab as unknown as MenuTab, webContents }
}

function menu(holdsText: boolean | undefined, params: Partial<ContextMenuParams> = {}) {
  const { browser, tab, webContents } = page()
  showContextMenu(browser, tab, { ...fieldParams, ...params } as unknown as ContextMenuParams, {}, holdsText)
  const items = built.templates.at(-1)!
  return { items, item: (id: string) => items.find((entry) => entry.id === id), webContents }
}

const platform = process.platform
function onPlatform(name: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: name, configurable: true })
}

afterEach(() => {
  vi.useRealTimers()
  onPlatform(platform)
  built.templates.length = 0
  built.has = async () => true
  built.asked.length = 0
})

describe('Paste in a text field\'s page menu', () => {
  it('pastes whatever the clipboard holds, and pastes as plain text only text', () => {
    const image = menu(false)
    expect(image.item('paste')?.enabled).toBe(true)
    expect(image.item('paste-and-match-style')?.enabled).toBe(false)

    const text = menu(true)
    expect(text.item('paste-and-match-style')?.enabled).toBe(true)
    ;(text.item('paste')!.click as () => void)()
    ;(text.item('paste-and-match-style')!.click as () => void)()
    expect(text.webContents.paste).toHaveBeenCalledOnce()
    expect(text.webContents.pasteAndMatchStyle).toHaveBeenCalledOnce()
  })

  it('follows the field alone without word of the clipboard, and offers no paste where Electron says there is none', () => {
    expect(menu(undefined).item('paste')?.enabled).toBe(true)
    expect(menu(undefined).item('paste-and-match-style')?.enabled).toBe(true)
    // A field that takes no paste, or a clipboard that holds nothing.
    const refusing = menu(true, { editFlags: { ...editable, canPaste: false } })
    expect(refusing.item('paste')?.enabled).toBe(false)
    expect(refusing.item('paste-and-match-style')?.enabled).toBe(false)
  })

  it('is named Paste as plain text on Windows and Linux, and Paste and Match Style on macOS', () => {
    for (const name of ['win32', 'linux'] as const) {
      onPlatform(name)
      expect(menu(undefined).item('paste-and-match-style')?.label).toBe('native.context.pasteAsPlainText')
    }
    onPlatform('darwin')
    expect(menu(undefined).item('paste-and-match-style')?.label).toBe('native.context.pasteMatchStyle')
  })

  it('leaves Paste as plain text out of a misspelled word\'s menu, as Chrome does, and keeps Paste', () => {
    const { item, items } = menu(true, { misspelledWord: 'helo', dictionarySuggestions: ['hello'] })
    expect(item('paste-and-match-style')).toBeUndefined()
    const ids = items.map((entry) => entry.id)
    expect(ids.indexOf('paste') + 1).toBe(ids.indexOf('delete'))
  })
})

describe('a text field\'s menu as it opens', () => {
  // Windows and Linux ask the clipboard; the last case says why macOS does not.
  beforeEach(() => { onPlatform('linux') })
  const open = (webContents: EventEmitter, params: Partial<ContextMenuParams> = {}) => {
    webContents.emit('context-menu', { preventDefault: () => undefined }, { ...fieldParams, ...params })
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  const pasteItems = () => built.templates.map((template) => template.filter((entry) => entry.id?.startsWith('paste')).map((entry) => entry.enabled))

  it('learns whether the clipboard holds text first, by the types it offers', async () => {
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    built.has = async () => false
    open(webContents)
    expect(built.templates).toHaveLength(0)
    await settle()
    built.has = async () => true
    open(webContents)
    await settle()
    built.has = async () => { throw new Error('The clipboard is busy') }
    open(webContents)
    await settle()
    expect(pasteItems()).toEqual([[true, false], [true, true], [true, true]])
    expect(built.asked).toEqual(['text/plain', 'text/plain', 'text/plain'])
  })

  it('reads nothing for a menu with no paste or no Paste as plain text, which opens at once', () => {
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    open(webContents, { editFlags: { ...editable, canPaste: false } })
    open(webContents, { isEditable: false, editFlags: { ...editable, canPaste: false, canCut: false } })
    open(webContents, { misspelledWord: 'helo', dictionarySuggestions: ['hello'] })
    expect(built.templates).toHaveLength(3)
    expect(built.asked).toEqual([])
  })

  it('asks nothing on macOS, where Electron\'s answer also reads the pasteboard, and leaves Paste and Match Style to the field', () => {
    onPlatform('darwin')
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    open(webContents)
    expect(built.asked).toEqual([])
    expect(pasteItems()).toEqual([[true, true]])
  })

  it('opens without knowing once the clipboard is slow to say, and only once', async () => {
    vi.useFakeTimers()
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    let answer: (holdsText: boolean) => void = () => undefined
    built.has = () => new Promise((resolve) => { answer = resolve })
    open(webContents)
    await vi.advanceTimersByTimeAsync(499)
    expect(built.templates).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(pasteItems()).toEqual([[true, true]])
    answer(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(built.templates).toHaveLength(1)
  })

  it('opens only the newer of two right-clicks, and none once the tab was locked meanwhile', async () => {
    let locked = false
    const { browser, tab, webContents } = page({ locked: () => locked })
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    let first: (holdsText: boolean) => void = () => undefined
    built.has = () => new Promise((resolve) => { first = resolve })
    open(webContents)
    built.has = async () => true
    open(webContents)
    await settle()
    first(false)
    await settle()
    expect(pasteItems()).toEqual([[true, true]])

    open(webContents)
    locked = true
    await settle()
    expect(built.templates).toHaveLength(1)
  })

  it('opens none once another tab took its place in view, or the tab closed, meanwhile', async () => {
    const { browser, tab, webContents } = page()
    type Shell = { activeTabId: string, tabSelectionGeneration: number, tabs: Map<string, unknown>, splitViewContains: (id: string) => boolean }
    const shell = browser as unknown as Shell
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)

    // Selected again, it is still in view.
    open(webContents)
    shell.tabSelectionGeneration++
    await settle()
    expect(built.templates).toHaveLength(1)

    // An agent's tool or a tray click brought another tab into view.
    open(webContents)
    shell.tabSelectionGeneration++
    shell.activeTabId = 'other'
    await settle()
    expect(built.templates).toHaveLength(1)

    // Its split view partner became the active pane: it is still in view beside it.
    shell.splitViewContains = (id) => id === 'tab'
    open(webContents)
    shell.tabSelectionGeneration++
    await settle()
    expect(built.templates).toHaveLength(2)

    // The partner's page filled the window, which hides this pane.
    const partner = { id: 'partner', pageFullscreen: true, sleeping: false }
    Object.assign(shell, { splitView: { firstTabId: 'tab', secondTabId: 'partner' } })
    shell.tabs.set('partner', partner)
    open(webContents)
    await settle()
    expect(built.templates).toHaveLength(2)
    // This pane's own page fills it.
    Object.assign(partner, { pageFullscreen: false })
    Object.assign(tab, { pageFullscreen: true })
    open(webContents)
    await settle()
    expect(built.templates).toHaveLength(3)
    Object.assign(tab, { pageFullscreen: false })
    Object.assign(shell, { splitView: null })
    shell.splitViewContains = () => false
    shell.activeTabId = 'tab'

    open(webContents)
    shell.tabs.delete('tab')
    await settle()
    expect(built.templates).toHaveLength(3)
  })

  it('opens none over trusted chrome, or once the page was destroyed meanwhile', async () => {
    const { browser, tab, webContents } = page()
    const shell = browser as unknown as { browserContentOccluded: boolean }
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)

    // An agent's approval came up over the page while the clipboard answered.
    open(webContents)
    shell.browserContentOccluded = true
    await settle()
    expect(built.templates).toHaveLength(0)
    // Nor does one that reaches Hronaut after the cover came up, waited or opening at once with no paste.
    open(webContents)
    await settle()
    expect(built.templates).toHaveLength(0)
    open(webContents, { isEditable: false })
    await settle()
    expect(built.templates).toHaveLength(0)
    shell.browserContentOccluded = false
    open(webContents)
    await settle()
    expect(built.templates).toHaveLength(1)

    open(webContents)
    webContents.isDestroyed = () => true
    await settle()
    expect(built.templates).toHaveLength(1)
  })

  it('opens none once its frame was replaced or removed meanwhile, and one for a frame that stayed', async () => {
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    // Electron finds the frame again on each read, and none once it is gone.
    const openIn = (frame: { isDestroyed: () => boolean, detached: boolean }, later: () => unknown) => {
      let read = 0
      const params = Object.defineProperty({ ...fieldParams }, 'frame', { get: () => read++ === 0 ? frame : later(), enumerable: true })
      webContents.emit('context-menu', { preventDefault: () => undefined }, params)
    }
    const live = () => ({ isDestroyed: () => false, detached: false })

    const stayed = live()
    openIn(stayed, () => stayed)
    await settle()
    expect(built.templates).toHaveLength(1)

    // Another site's page replaced it, or the iframe was removed.
    openIn(live(), () => null)
    await settle()
    // Its page is unloading, or it is gone.
    const unloading = live()
    openIn(unloading, () => unloading)
    unloading.detached = true
    await settle()
    const gone = live()
    openIn(gone, () => gone)
    gone.isDestroyed = () => true
    await settle()
    expect(built.templates).toHaveLength(1)
  })
})
