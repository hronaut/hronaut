import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron'

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
const { LocalizedError } = await import('../src/main/localized-error.js')
type PageTab = { id: string, url: string, webContents: WebContents }
type PageContextMenuAccess = import('../src/main/browser/context-menus/page-context-menu-access.js').PageContextMenuAccess<PageTab>

const PAGE = 'https://accounts.example/sign-up'

// A password field's menu had no way to make a password, which Chrome's Suggest strong password does.

function menu(
  params: Partial<ContextMenuParams>,
  options: { suggestion?: (() => Promise<boolean>) | null, tabOpen?: () => boolean } = {}
) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, webContents }
  const onActionFailed = vi.fn()
  const suggestion = options.suggestion === undefined ? vi.fn(async () => true) : options.suggestion
  const passwordSuggestion = vi.fn(() => suggestion)
  const access = {
    findTab: () => options.tabOpen?.() === false ? undefined : tab,
    window: () => ({}),
    options: () => ({ copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed }),
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    searchEngine: () => 'google',
    spellCheck: () => true,
    setSpellCheck: async () => undefined,
    offersSpellCheckLanguages: () => true,
    openSpellCheckSettings: () => undefined,
    passwordSuggestion
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: true, mediaType: 'none', editFlags: {},
    misspelledWord: '', dictionarySuggestions: [], formControlType: 'input-password',
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  return {
    ids: items.map(item => item.id ?? item.type),
    item: items.find(item => item.id === 'suggest-strong-password'),
    tab,
    suggestion,
    passwordSuggestion,
    onActionFailed
  }
}

function choose(item: MenuItemConstructorOptions): void {
  ;(item.click as () => void)()
}

afterEach(() => {
  built.templates.length = 0
})

describe('Suggest Strong Password in a password field\'s page menu', () => {
  it('follows the editing commands, bound to the page the menu opened on', () => {
    const { ids, item, tab, passwordSuggestion } = menu({})
    expect(ids.slice(ids.indexOf('select-all'), ids.indexOf('select-all') + 3)).toEqual(['select-all', 'separator', 'suggest-strong-password'])
    expect(item?.label).toBe('native.context.suggestStrongPassword')
    // The suggestion is asked for when the menu opens, so it keeps the page the person right-clicked.
    expect(passwordSuggestion).toHaveBeenCalledExactlyOnceWith(tab)
  })

  it('fills the password when chosen and says nothing when the page took it', async () => {
    const { item, suggestion, onActionFailed } = menu({})
    choose(item!)
    await vi.waitFor(() => expect(suggestion).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(onActionFailed).not.toHaveBeenCalled()
  })

  it('is only for a password field of the page itself, while a password can be suggested there', () => {
    for (const formControlType of ['input-text', 'input-email', 'text-area', 'none'] as const) {
      const other = menu({ formControlType })
      expect(other.item).toBeUndefined()
      expect(other.passwordSuggestion).not.toHaveBeenCalled()
    }
    // A frame inside the page is another document, which a save offer would not see.
    const frame = { parent: {}, origin: 'https://accounts.example' } as unknown as WebFrameMain
    expect(menu({ frame }).item).toBeUndefined()
    // No secure storage, another tab in front, or no website: nothing could keep or take the password.
    expect(menu({}, { suggestion: null }).ids).not.toContain('suggest-strong-password')
    expect(menu({ isEditable: false, formControlType: 'input-password' }).item).toBeUndefined()
  })

  it('tells the person when the page took no password, and reports a failure such as a running agent command', async () => {
    const none = menu({}, { suggestion: async () => false })
    choose(none.item!)
    await vi.waitFor(() => expect(none.onActionFailed).toHaveBeenCalledOnce())
    const [action, error] = none.onActionFailed.mock.calls[0]!
    expect(action).toBe('suggest a strong password')
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as InstanceType<typeof LocalizedError>).key).toBe('appErrors.credentials.suggestFailed')

    const busy = new Error('busy')
    const failed = menu({}, { suggestion: async () => { throw busy } })
    choose(failed.item!)
    await vi.waitFor(() => expect(failed.onActionFailed).toHaveBeenCalledExactlyOnceWith('suggest a strong password', busy))
  })

  it('does nothing in a tab that closed while the menu was open', () => {
    let open = true
    const closed = menu({}, { tabOpen: () => open })
    open = false
    choose(closed.item!)
    expect(closed.suggestion).not.toHaveBeenCalled()
    expect(closed.onActionFailed).toHaveBeenCalledOnce()
  })
})
