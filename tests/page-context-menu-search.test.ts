import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'
import { selectionGoToUrl, selectionSearchLabelText, selectionSearchQuery } from '../src/main/browser/selection-search/selection-search.js'
import type { SearchEngineName } from '../src/shared/search-engine.js'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][], closed: false }))

vi.mock('electron', () => ({
  app: { isEmojiPanelSupported: () => false },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.templates.push(template)
      return { popup: () => undefined }
    }
  }
}))

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
type PageTab = { id: string, url: string, mcpGroupId?: string, webContents: WebContents }
type MenuBrowser = Parameters<typeof showContextMenu>[0]

// The page's context menu had no Search for the selected text, as Chrome's has.

const PAGE = 'https://docs.example/guide'

function openMenu(params: Partial<ContextMenuParams>, options: { engine?: SearchEngineName, createTab?: ReturnType<typeof vi.fn>, occluded?: () => boolean, url?: string } = {}) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: options.url ?? PAGE, mcpGroupId: 'client', webContents }
  const createTab = options.createTab ?? vi.fn(async () => tab)
  const onActionFailed = vi.fn()
  const searchEngine = vi.fn(() => options.engine ?? 'google')
  const browser = {
    get tabs() { return new Map(built.closed ? [] : [[tab.id, tab]]) },
    window: {},
    options: {
      copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed,
      getSearchEngine: searchEngine,
      getSpellCheck: () => true,
      setSpellCheck: async () => undefined,
      offersSpellCheckLanguages: () => true,
      openSpellCheckSettings: () => undefined
    },
    text: (key: string, values?: Record<string, string>) => values ? `${key} ${JSON.stringify(values)}` : key,
    isHumanInteractionLocked: () => false,
    createTab,
    get browserContentOccluded() { return (options.occluded ?? (() => false))() }
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  return { tab, createTab, onActionFailed, searchEngine, items, ids: items.map((item) => item.id ?? item.type) }
}

function clickSearch(items: MenuItemConstructorOptions[]): void {
  ;(items.find((item) => item.id === 'search-selection')!.click as () => void)()
}

afterEach(() => {
  built.templates.length = 0
  built.closed = false
})

describe('the selection search query', () => {
  it('searches the selection with its runs of white space made single spaces', () => {
    expect(selectionSearchQuery('  electron\n\tcontext   menu  ', false)).toBe('electron context menu')
  })

  it('searches nothing for white space only or a password field', () => {
    expect(selectionSearchQuery(' \n\t ', false)).toBeUndefined()
    expect(selectionSearchQuery('hunter2', true)).toBeUndefined()
  })

  it('searches half a character a page selected as U+FFFD, as Chrome does, rather than failing', () => {
    expect(selectionSearchQuery('agents \uD800', false)).toBe('agents \uFFFD')
  })

  it('searches at most the first 2,048 characters of a long selection, without half a character', () => {
    // A selection of a whole long document made a search address of megabytes, which the browser cannot open.
    expect(selectionSearchQuery('word '.repeat(100_000), false)).toBe('word '.repeat(410).slice(0, 2048).trim())
    expect(selectionSearchQuery(`${'a'.repeat(2047)}😀 tail`, false)).toBe('a'.repeat(2047))
  })

  it('shows at most 50 characters of the selection in the label, then an ellipsis', () => {
    expect(selectionSearchLabelText('a'.repeat(50))).toBe('a'.repeat(50))
    expect(selectionSearchLabelText(`${'a'.repeat(49)} bcd`)).toBe(`${'a'.repeat(49)}…`)
    // It counts the characters a person sees, so it never splits an emoji, a flag or a letter with its accent.
    expect(selectionSearchLabelText('😀'.repeat(51))).toBe(`${'😀'.repeat(50)}…`)
    expect(selectionSearchLabelText('👩‍💻'.repeat(51))).toBe(`${'👩‍💻'.repeat(50)}…`)
    expect(selectionSearchLabelText(`${'a'.repeat(49)}🇺🇦🇺🇦`)).toBe(`${'a'.repeat(49)}🇺🇦…`)
    expect(selectionSearchLabelText(`${'a'.repeat(49)}e\u0301x`)).toBe(`${'a'.repeat(49)}e\u0301…`)
  })

  it('shows an ampersand in the label rather than taking it as an access key', () => {
    expect(selectionSearchLabelText('R&D & QA')).toBe('R&&D && QA')
  })
})

describe('the address a selection goes to', () => {
  it('is a web address written with its scheme or starting with www., as the address bar opens it', () => {
    expect(selectionGoToUrl('https://docs.example/guide?step=2#setup')).toBe('https://docs.example/guide?step=2#setup')
    expect(selectionGoToUrl('HTTP://127.0.0.1:3000/dashboard')).toBe('HTTP://127.0.0.1:3000/dashboard')
    expect(selectionGoToUrl('www.example.com/pricing')).toBe('https://www.example.com/pricing')
  })

  it('is the whole selected address, however long, never the part a search reads', () => {
    // A long signed link opened cut to the search's first 2,048 characters.
    const signed = `https://bucket.example/report.pdf?signature=${'a'.repeat(3000)}`
    expect(selectionGoToUrl(`  ${signed}\n`)).toBe(signed)
    expect(selectionGoToUrl(`https://bucket.example/${'a'.repeat(2 * 1024 * 1024)}`)).toBeUndefined()
  })

  it('is none for a word with a dot, other text, or an address of another kind', () => {
    for (const query of ['Node.js', 'example.com', 'https://docs.example and more', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://', 'www.']) {
      expect(selectionGoToUrl(query), query).toBeUndefined()
    }
  })
})

describe('Search for the selection in the page context menu', () => {
  it('goes to a selected address instead, in front beside the page, without asking for the search engine', () => {
    const { tab, createTab, searchEngine, ids, items } = openMenu({ selectionText: ' https://docs.example/guide\n' })
    expect(ids.slice(0, 4)).toEqual(['copy-selection', 'copy-link-to-highlight', 'go-to-selection', 'separator'])
    expect(ids).not.toContain('search-selection')
    const item = items.find((entry) => entry.id === 'go-to-selection')!
    expect(item.label).toBe('native.context.goTo {"text":"https://docs.example/guide"}')
    ;(item.click as () => void)()
    expect(createTab).toHaveBeenCalledExactlyOnceWith({
      url: 'https://docs.example/guide',
      active: true,
      mcpGroupId: 'client',
      openedFrom: { tabId: tab.id, background: false }
    })
    expect(searchEngine).not.toHaveBeenCalled()
  })

  it('goes nowhere behind a Hronaut dialog that opened while the menu was open, and reports an address that would not open', async () => {
    let occluded = false
    const { createTab, onActionFailed, items } = openMenu({ selectionText: 'www.example.com' }, { occluded: () => occluded })
    occluded = true
    ;(items.find((entry) => entry.id === 'go-to-selection')!.click as () => void)()
    expect(createTab).not.toHaveBeenCalled()
    expect(onActionFailed).not.toHaveBeenCalled()

    const refused = openMenu({ selectionText: 'https://blocked.example/' }, { createTab: vi.fn(async () => { throw new Error('Blocked by the workspace') }) })
    ;(refused.items.find((entry) => entry.id === 'go-to-selection')!.click as () => void)()
    await vi.waitFor(() => expect(refused.onActionFailed).toHaveBeenCalledExactlyOnceWith('go to the selected address', expect.objectContaining({ message: 'Blocked by the workspace' })))
  })

  it('offers neither for a link\'s own address, an address with a sign-in, or on Hronaut Home', () => {
    const link = openMenu({ selectionText: 'https://docs.example/guide', linkURL: 'https://docs.example/guide' })
    expect(link.ids).toContain('open-link-new-tab')
    const signIn = openMenu({ selectionText: 'https://admin:hunter2@router.example/' })
    const home = openMenu({ selectionText: 'Release notes' }, { url: 'hronaut://home/' })
    for (const { ids } of [link, signIn, home]) {
      expect(ids).not.toContain('go-to-selection')
      expect(ids).not.toContain('search-selection')
    }
    // Another address than the link's still has Go to.
    expect(openMenu({ selectionText: 'https://docs.example/other', linkURL: 'https://docs.example/guide' }).ids).toContain('go-to-selection')
  })

  it('builds the menu for a selection with half a character, searching it as U+FFFD', () => {
    const { createTab, items } = openMenu({ selectionText: 'agents \uD800' })
    clickSearch(items)
    expect(createTab.mock.calls[0]?.[0]).toMatchObject({ url: 'https://www.google.com/search?q=agents%20%EF%BF%BD' })
  })

  it('follows Copy for selected text, named for the address bar\'s search engine', () => {
    const { ids, items } = openMenu({ selectionText: 'Hronaut   browser' }, { engine: 'duckduckgo' })
    expect(ids.slice(0, 4)).toEqual(['copy-selection', 'copy-link-to-highlight', 'search-selection', 'separator'])
    expect(items[2]?.label).toBe('native.context.searchFor {"engine":"DuckDuckGo","text":"Hronaut browser"}')
  })

  it('opens the results in front, beside the page and in its workspace', () => {
    const { tab, createTab, items } = openMenu({ selectionText: 'R&D: what is CDP?' })
    clickSearch(items)
    expect(createTab).toHaveBeenCalledExactlyOnceWith({
      url: 'https://www.google.com/search?q=R%26D%3A%20what%20is%20CDP%3F',
      active: true,
      mcpGroupId: 'client',
      openedFrom: { tabId: tab.id, background: false }
    })
  })

  it('searches with the engine its label names, even if the setting changes while the menu is open', () => {
    const { createTab, searchEngine, items } = openMenu({ selectionText: 'agents' }, { engine: 'bing' })
    searchEngine.mockReturnValue('brave')
    clickSearch(items)
    expect(createTab.mock.calls[0]?.[0]).toMatchObject({ url: 'https://www.bing.com/search?q=agents' })
    expect(searchEngine).toHaveBeenCalledTimes(1)
  })

  it('follows the editing commands in a field with selected text, in a group of its own', () => {
    const { ids } = openMenu({ isEditable: true, selectionText: 'draft title', editFlags: { canCopy: true } as ContextMenuParams['editFlags'] })
    const selectAll = ids.indexOf('select-all')
    expect(ids.slice(selectAll, selectAll + 3)).toEqual(['select-all', 'separator', 'search-selection'])
  })

  it('is not offered for a misspelled word, as in Chrome, whose menu offers its spellings', () => {
    const { ids } = openMenu({ isEditable: true, selectionText: 'teh', misspelledWord: 'teh', dictionarySuggestions: ['the'], editFlags: {} as ContextMenuParams['editFlags'] })
    expect(ids).toContain('add-to-dictionary')
    expect(ids).not.toContain('search-selection')
  })

  it('opens nothing behind a Hronaut dialog that opened while the menu was open', () => {
    let occluded = false
    const { createTab, onActionFailed, items } = openMenu({ selectionText: 'agents' }, { occluded: () => occluded })
    occluded = true
    clickSearch(items)
    expect(createTab).not.toHaveBeenCalled()
    expect(onActionFailed).not.toHaveBeenCalled()
  })

  it('is not offered for a password field, white space only, or no selection', () => {
    expect(openMenu({ isEditable: true, formControlType: 'input-password', selectionText: 'hunter2' } as Partial<ContextMenuParams>).ids).not.toContain('search-selection')
    expect(openMenu({ selectionText: ' \n ' }).ids).not.toContain('search-selection')
    const none = openMenu({})
    expect(none.ids).not.toContain('search-selection')
    expect(none.searchEngine).not.toHaveBeenCalled()
  })

  it('reports a search that could not open, and a tab that closed while the menu was open', async () => {
    const createTab = vi.fn(async () => { throw new Error('Workspace closed') })
    const failed = openMenu({ selectionText: 'agents' }, { createTab })
    clickSearch(failed.items)
    await vi.waitFor(() => expect(failed.onActionFailed).toHaveBeenCalledExactlyOnceWith('search for the selection', expect.objectContaining({ message: 'Workspace closed' })))

    const closed = openMenu({ selectionText: 'agents' })
    built.closed = true
    clickSearch(closed.items)
    expect(closed.createTab).not.toHaveBeenCalled()
    expect(closed.onActionFailed).toHaveBeenCalledExactlyOnceWith('search for the selection', expect.objectContaining({ message: 'The tab is no longer available.' }))
  })
})
