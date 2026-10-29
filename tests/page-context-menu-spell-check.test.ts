import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItem, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))

vi.mock('electron', () => ({
  app: { isEmojiPanelSupported: () => false, showEmojiPanel: () => undefined },
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

const PAGE = 'https://mail.example/compose'

// A text field's menu had no Spell check submenu, which Chrome's has to turn checking on or off for every website.

function menu(
  params: Partial<ContextMenuParams>,
  options: { spellCheck?: boolean, setSpellCheck?: (enabled: boolean) => Promise<void>, offersLanguages?: boolean } = {}
) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, webContents }
  const onActionFailed = vi.fn()
  const setSpellCheck = vi.fn(options.setSpellCheck ?? (async () => undefined))
  const openSpellCheckSettings = vi.fn()
  const access = {
    findTab: () => tab,
    window: () => ({}),
    options: () => ({ copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed }),
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    searchEngine: () => 'google',
    spellCheck: () => options.spellCheck ?? true,
    setSpellCheck,
    offersSpellCheckLanguages: () => options.offersLanguages ?? true,
    openSpellCheckSettings
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    misspelledWord: '', dictionarySuggestions: [], formControlType: 'none',
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  const spellCheck = items.find(item => item.id === 'spell-check')
  return { items, ids: items.map(item => item.id ?? item.type), spellCheck, setSpellCheck, openSpellCheckSettings, onActionFailed }
}

function choose(item: MenuItemConstructorOptions, checked: boolean): void {
  ;(item.click as (menuItem: MenuItem) => void)({ checked } as MenuItem)
}

afterEach(() => {
  built.templates.length = 0
})

describe('Spell check in a text field\'s page menu', () => {
  it('follows the editing commands with a submenu whose checkbox shows the setting', () => {
    const { ids, spellCheck } = menu({ isEditable: true, formControlType: 'input-text' })
    expect(ids.slice(ids.indexOf('select-all'), ids.indexOf('select-all') + 3)).toEqual(['select-all', 'separator', 'spell-check'])
    expect(spellCheck?.label).toBe('native.context.spellCheck')
    const [check] = spellCheck!.submenu as MenuItemConstructorOptions[]
    expect(check).toMatchObject({ id: 'check-spelling', type: 'checkbox', label: 'native.context.checkSpelling', checked: true })

    const off = menu({ isEditable: true, formControlType: 'text-area' }, { spellCheck: false })
    expect((off.spellCheck!.submenu as MenuItemConstructorOptions[])[0]!.checked).toBe(false)
  })

  it('comes after a search for the selected text and after spelling suggestions, as in Chrome', () => {
    const selected = menu({ isEditable: true, formControlType: 'input-text', selectionText: 'quarterly report' })
    const search = selected.ids.indexOf('search-selection')
    expect(selected.ids.slice(search, search + 3)).toEqual(['search-selection', 'separator', 'spell-check'])

    const misspelled = menu({ isEditable: true, formControlType: 'text-area', misspelledWord: 'teh', dictionarySuggestions: ['the'] })
    expect(misspelled.ids.indexOf('add-to-dictionary')).toBeLessThan(misspelled.ids.indexOf('spell-check'))
  })

  it('opens the settings with the spell check languages from Language settings, as Chrome\'s submenu does', () => {
    const { spellCheck, openSpellCheckSettings, setSpellCheck } = menu({ isEditable: true, formControlType: 'input-text' })
    const items = spellCheck!.submenu as MenuItemConstructorOptions[]
    expect(items.map((item) => item.id)).toEqual(['check-spelling', 'spell-check-language-settings'])
    expect(items[1]).toMatchObject({ label: 'native.context.spellCheckLanguageSettings' })
    ;(items[1]!.click as () => void)()
    expect(openSpellCheckSettings).toHaveBeenCalledOnce()
    expect(setSpellCheck).not.toHaveBeenCalled()
  })

  it('has no Language settings where Settings has no spell check languages, as on macOS', () => {
    const { spellCheck } = menu({ isEditable: true, formControlType: 'input-text' }, { offersLanguages: false })
    expect((spellCheck!.submenu as MenuItemConstructorOptions[]).map((item) => item.id)).toEqual(['check-spelling'])
  })

  it('turns spell checking off or on as the checkbox now shows', () => {
    const { spellCheck, setSpellCheck } = menu({ isEditable: true, formControlType: 'input-search' })
    const [check] = spellCheck!.submenu as MenuItemConstructorOptions[]
    choose(check!, false)
    expect(setSpellCheck).toHaveBeenLastCalledWith(false)
    choose(check!, true)
    expect(setSpellCheck).toHaveBeenLastCalledWith(true)
  })

  it('reports a change that could not be saved', async () => {
    const failure = new Error('disk full')
    const { spellCheck, onActionFailed } = menu({ isEditable: true, formControlType: 'input-text' }, { setSpellCheck: async () => { throw failure } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      choose((spellCheck!.submenu as MenuItemConstructorOptions[])[0]!, false)
      await vi.waitFor(() => expect(onActionFailed).toHaveBeenCalledWith('change spell check', failure))
    } finally {
      error.mockRestore()
    }
  })

  it('is left out of a password field, which is never checked, and out of menus outside a text field', () => {
    expect(menu({ isEditable: true, formControlType: 'input-password' }).ids).not.toContain('spell-check')
    expect(menu({ selectionText: 'quarterly report' }).ids).not.toContain('spell-check')
    expect(menu({}).ids).not.toContain('spell-check')
  })
})
