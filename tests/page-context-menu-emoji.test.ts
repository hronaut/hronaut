import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({
  templates: [] as MenuItemConstructorOptions[][],
  emojiPanelSupported: true,
  showEmojiPanel: (() => undefined) as () => void
}))

vi.mock('electron', () => ({
  app: {
    isEmojiPanelSupported: () => built.emojiPanelSupported,
    showEmojiPanel: () => built.showEmojiPanel()
  },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.templates.push(template)
      return { popup: () => undefined }
    }
  }
}))

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
type PageTab = { id: string, url: string, webContents: WebContents }
type PageContextMenuAccess = import('../src/main/browser/context-menus/page-context-menu-access.js').PageContextMenuAccess<PageTab>

const PAGE = 'https://chat.example/room/7'

// A text field's menu had no way to open the system's emoji picker, which Chrome's offers on Windows and macOS.

function menu(params: Partial<ContextMenuParams>, tabOpen = true) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, webContents }
  const onActionFailed = vi.fn()
  const access = {
    findTab: () => tabOpen ? tab : undefined,
    window: () => ({}),
    options: () => ({ copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed }),
    text: (key: string) => key === 'native.context.emojiSymbols' ? 'Emoji & Symbols' : key,
    isHumanInteractionLocked: () => false,
    searchEngine: () => 'google',
    spellCheck: () => true,
    setSpellCheck: async () => undefined,
    offersSpellCheckLanguages: () => true,
    openSpellCheckSettings: () => undefined
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    misspelledWord: '', dictionarySuggestions: [], formControlType: 'none',
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  return { items, ids: items.map(item => item.id ?? item.type), onActionFailed }
}

const platform = process.platform
function onPlatform(name: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: name, configurable: true })
}

afterEach(() => {
  onPlatform(platform)
  built.templates.length = 0
  built.emojiPanelSupported = true
  built.showEmojiPanel = () => undefined
})

describe('the emoji picker in a text field\'s page menu', () => {
  it('comes first in a text field and opens the system\'s emoji picker', () => {
    const showEmojiPanel = vi.fn()
    built.showEmojiPanel = showEmojiPanel
    onPlatform('win32')
    const { items, ids } = menu({ isEditable: true, formControlType: 'input-text' })
    expect(ids.slice(0, 3)).toEqual(['emoji', 'separator', 'undo'])
    expect(items[0]?.label).toBe('native.context.emoji')
    ;(items[0]!.click as () => void)()
    expect(showEmojiPanel).toHaveBeenCalledOnce()
  })

  it('says Emoji & Symbols on macOS, with the ampersand doubled so the menu shows it', () => {
    // macOS menus take a single ampersand as an access key and drop it, which showed "Emoji  Symbols".
    onPlatform('darwin')
    expect(menu({ isEditable: true }).items[0]?.label).toBe('Emoji && Symbols')
  })

  it('offers it in the fields Chrome does and leaves it out of number, telephone and date fields', () => {
    for (const field of ['none', 'input-text', 'input-search', 'input-url', 'input-email', 'input-password', 'text-area'] as const) {
      expect(menu({ isEditable: true, formControlType: field }).ids[0], field).toBe('emoji')
    }
    for (const field of ['input-number', 'input-telephone', 'input-date', 'input-time'] as const) {
      expect(menu({ isEditable: true, formControlType: field }).ids, field).not.toContain('emoji')
    }
  })

  it('is left out where the system has no emoji picker, outside a text field, and beside spelling suggestions', () => {
    built.emojiPanelSupported = false
    expect(menu({ isEditable: true }).ids).not.toContain('emoji')
    built.emojiPanelSupported = true
    expect(menu({ selectionText: 'hello' }).ids).not.toContain('emoji')
    expect(menu({}).ids).not.toContain('emoji')
    const misspelled = menu({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the'] }).ids
    expect(misspelled).toContain('spelling-suggestion-0')
    expect(misspelled).not.toContain('emoji')
  })

  it('opens nothing once the tab has closed', () => {
    const showEmojiPanel = vi.fn()
    built.showEmojiPanel = showEmojiPanel
    const { items, onActionFailed } = menu({ isEditable: true }, false)
    ;(items.find(item => item.id === 'emoji')!.click as () => void)()
    expect(showEmojiPanel).not.toHaveBeenCalled()
    expect(onActionFailed).toHaveBeenCalledWith('open the emoji picker', expect.any(Error))
  })
})
