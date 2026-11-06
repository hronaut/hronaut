import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({
  templates: [] as MenuItemConstructorOptions[][],
  read: (async () => []) as () => Promise<{ types: string[] }[]>,
  reads: 0
}))

vi.mock('electron', () => ({
  app: { isEmojiPanelSupported: () => false, showEmojiPanel: () => undefined },
  clipboard: {
    read: () => {
      built.reads++
      return built.read()
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
type Held = Parameters<typeof showContextMenu>[4]

const PAGE = 'https://mail.example/compose'
const editable = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: true }
const fieldParams = {
  x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: true, mediaType: 'none', editFlags: editable,
  misspelledWord: '', dictionarySuggestions: [], formControlType: 'text-area', menuSourceType: 'mouse',
  pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin'
}

// A text field's Paste and Paste and Match Style were offered with nothing on the clipboard, where they do nothing, and
// Paste and Match Style kept macOS's name on Windows and Linux; Chrome greys them out and names it Paste as plain text.

function page(options: { locked?: () => boolean } = {}) {
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
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

function menu(held: Held, params: Partial<ContextMenuParams> = {}) {
  const { browser, tab, webContents } = page()
  showContextMenu(browser, tab, { ...fieldParams, ...params } as unknown as ContextMenuParams, {}, held)
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
  built.read = async () => []
  built.reads = 0
})

describe('Paste in a text field\'s page menu', () => {
  it('is greyed out, as Paste and Match Style is, while the clipboard holds nothing', () => {
    const { item } = menu({ holdsAnything: false, holdsText: false })
    expect(item('paste')?.enabled).toBe(false)
    expect(item('paste-and-match-style')?.enabled).toBe(false)
  })

  it('pastes whatever the clipboard holds, and pastes as plain text only text', () => {
    const image = menu({ holdsAnything: true, holdsText: false })
    expect(image.item('paste')?.enabled).toBe(true)
    expect(image.item('paste-and-match-style')?.enabled).toBe(false)

    const text = menu({ holdsAnything: true, holdsText: true })
    expect(text.item('paste-and-match-style')?.enabled).toBe(true)
    ;(text.item('paste')!.click as () => void)()
    ;(text.item('paste-and-match-style')!.click as () => void)()
    expect(text.webContents.paste).toHaveBeenCalledOnce()
    expect(text.webContents.pasteAndMatchStyle).toHaveBeenCalledOnce()
  })

  it('follows the field alone without word of the clipboard, and never offers a paste the field does not take', () => {
    expect(menu(undefined).item('paste')?.enabled).toBe(true)
    expect(menu(undefined).item('paste-and-match-style')?.enabled).toBe(true)
    const refusing = menu({ holdsAnything: true, holdsText: true }, { editFlags: { ...editable, canPaste: false } })
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
    const { item, items } = menu({ holdsAnything: true, holdsText: true }, { misspelledWord: 'helo', dictionarySuggestions: ['hello'] })
    expect(item('paste-and-match-style')).toBeUndefined()
    const ids = items.map((entry) => entry.id)
    expect(ids.indexOf('paste') + 1).toBe(ids.indexOf('delete'))
  })
})

describe('a text field\'s menu as it opens', () => {
  const open = (webContents: EventEmitter, params: Partial<ContextMenuParams> = {}) => {
    webContents.emit('context-menu', { preventDefault: () => undefined }, { ...fieldParams, ...params })
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  const pasteItems = () => built.templates.map((template) => template.filter((entry) => entry.id?.startsWith('paste')).map((entry) => entry.enabled))

  it('learns what the clipboard holds first, by the types it offers', async () => {
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    built.read = async () => [{ types: [] }]
    open(webContents)
    expect(built.templates).toHaveLength(0)
    await settle()
    built.read = async () => [{ types: ['image/png'] }]
    open(webContents)
    await settle()
    built.read = async () => [{ types: ['text/html', 'text/plain'] }]
    open(webContents)
    await settle()
    built.read = async () => { throw new Error('The clipboard is busy') }
    open(webContents)
    await settle()
    expect(pasteItems()).toEqual([[false, false], [true, false], [true, true], [false, false]])
  })

  it('reads nothing for a menu with no paste, which opens at once', () => {
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    open(webContents, { editFlags: { ...editable, canPaste: false } })
    open(webContents, { isEditable: false, editFlags: { ...editable, canPaste: false, canCut: false } })
    expect(built.templates).toHaveLength(2)
    expect(built.reads).toBe(0)
  })

  it('opens without knowing once the clipboard is slow to say, and only once', async () => {
    vi.useFakeTimers()
    const { browser, tab, webContents } = page()
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    let answer: (items: { types: string[] }[]) => void = () => undefined
    built.read = () => new Promise((resolve) => { answer = resolve })
    open(webContents)
    await vi.advanceTimersByTimeAsync(499)
    expect(built.templates).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(pasteItems()).toEqual([[true, true]])
    answer([{ types: [] }])
    await vi.advanceTimersByTimeAsync(0)
    expect(built.templates).toHaveLength(1)
  })

  it('opens only the newer of two right-clicks, and none once the tab was locked meanwhile', async () => {
    let locked = false
    const { browser, tab, webContents } = page({ locked: () => locked })
    attachPageContextMenuEvents(browser, tab, webContents as unknown as WebContents)
    let first: (items: { types: string[] }[]) => void = () => undefined
    built.read = () => new Promise((resolve) => { first = resolve })
    open(webContents)
    built.read = async () => [{ types: ['text/plain'] }]
    open(webContents)
    await settle()
    first([{ types: [] }])
    await settle()
    expect(pasteItems()).toEqual([[true, true]])

    built.read = async () => [{ types: ['text/plain'] }]
    open(webContents)
    locked = true
    await settle()
    expect(built.templates).toHaveLength(1)
  })
})
