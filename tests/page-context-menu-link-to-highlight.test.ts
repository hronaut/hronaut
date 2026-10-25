import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))

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
type PageContextMenuAccess = import('../src/main/browser/context-menus/page-context-menu-access.js').PageContextMenuAccess<PageTab>

// The page's context menu had no Copy link to highlight, as Chrome's has: the link that scrolls to the selected text
// and highlights it when it is opened.

const PAGE = 'https://docs.example/guide#install'

function openMenu(params: Partial<ContextMenuParams>, url = PAGE, pageText?: () => Promise<unknown>) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    ...(pageText ? { executeJavaScriptInIsolatedWorld: vi.fn(pageText) } : {})
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url, mcpGroupId: 'client', webContents }
  const copyText = vi.fn(async (_text: string) => undefined)
  const access = {
    findTab: () => tab,
    window: () => ({}),
    options: () => ({ copyText, copyImageAt: async () => undefined }),
    text: (key: string, values?: Record<string, string>) => values ? `${key} ${JSON.stringify(values)}` : key,
    isHumanInteractionLocked: () => false,
    createTab: vi.fn(async () => tab),
    searchEngine: () => 'google',
    browserContentOccluded: () => false
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: url, frameURL: url, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  return { copyText, items, ids: items.map((item) => item.id ?? item.type) }
}

afterEach(() => {
  built.templates.length = 0
})

describe('Copy link to highlight in the page context menu', () => {
  it('follows Copy for text selected in the page, and copies the page\'s address with a text fragment', async () => {
    const menu = openMenu({ selectionText: 'npm ci --ignore-scripts' })
    expect(menu.ids.slice(0, 4)).toEqual(['copy-selection', 'copy-link-to-highlight', 'search-selection', 'separator'])
    const item = menu.items.find((candidate) => candidate.id === 'copy-link-to-highlight')!
    expect(item.label).toBe('native.context.copyLinkToHighlight')
    ;(item.click as () => void)()
    await vi.waitFor(() => expect(menu.copyText).toHaveBeenCalledExactlyOnceWith('https://docs.example/guide#install:~:text=npm%20ci%20%2D%2Dignore%2Dscripts'))
  })

  it('makes the link from the page\'s text when the page gives it, as a whole word', async () => {
    const menu = openMenu({ selectionText: 'ighlight the te' }, PAGE, async () => ({ runs: ['H\uFDD0ighlight the te\uFDD1xt here'] }))
    ;(menu.items.find((candidate) => candidate.id === 'copy-link-to-highlight')!.click as () => void)()
    await vi.waitFor(() => expect(menu.copyText).toHaveBeenCalledExactlyOnceWith('https://docs.example/guide#install:~:text=Highlight%20the%20text'))
  })

  it('copies only the link chosen last, however the page reads answer', async () => {
    const answers: Array<(value: unknown) => void> = []
    const menu = openMenu({ selectionText: 'apple' }, PAGE, () => new Promise((resolve) => answers.push(resolve)))
    const click = menu.items.find((candidate) => candidate.id === 'copy-link-to-highlight')!.click as () => void
    click()
    click()
    await vi.waitFor(() => expect(answers).toHaveLength(2))
    answers[1]!({ runs: ['apple pie', 'Then \uFDD0apple\uFDD1 again'] })
    await vi.waitFor(() => expect(menu.copyText).toHaveBeenCalledOnce())
    answers[0]!({ runs: ['\uFDD0apple\uFDD1'] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(menu.copyText).toHaveBeenCalledExactlyOnceWith('https://docs.example/guide#install:~:text=Then-,apple,-again')
  })

  it('links to a selected address too, beside its Go to', () => {
    expect(openMenu({ selectionText: 'https://docs.example/other' }).ids.slice(0, 3)).toEqual(['copy-selection', 'copy-link-to-highlight', 'go-to-selection'])
  })

  it('offers nothing for text in a frame inside the page, or when the frame is not the page', () => {
    const frame = { parent: {}, origin: 'https://embed.example' } as unknown as WebFrameMain
    expect(openMenu({ selectionText: 'framed', frame, frameURL: 'https://embed.example/widget' }).ids).not.toContain('copy-link-to-highlight')
    // A frame showing the page's own address is still a frame inside it.
    expect(openMenu({ selectionText: 'framed', frame }).ids).not.toContain('copy-link-to-highlight')
    // A frame that is already gone shows no parent, but its address is still not the page's.
    expect(openMenu({ selectionText: 'framed', frame: null, frameURL: 'https://embed.example/widget' }).ids).not.toContain('copy-link-to-highlight')
    const main = { parent: null, origin: 'https://docs.example' } as unknown as WebFrameMain
    expect(openMenu({ selectionText: 'page text', frame: main }).ids).toContain('copy-link-to-highlight')
  })

  it('offers nothing in a text field, for spaces alone, or on a page that is not a web page', () => {
    expect(openMenu({ isEditable: true, selectionText: 'typed text', editFlags: { canCopy: true } } as Partial<ContextMenuParams>).ids).not.toContain('copy-link-to-highlight')
    expect(openMenu({ selectionText: ' \n ' }).ids).not.toContain('copy-link-to-highlight')
    for (const url of ['hronaut://home/', 'file:///home/me/notes.html', 'about:blank']) {
      expect(openMenu({ selectionText: 'text' }, url).ids, url).not.toContain('copy-link-to-highlight')
    }
    expect(openMenu({}).ids).not.toContain('copy-link-to-highlight')
  })
})
