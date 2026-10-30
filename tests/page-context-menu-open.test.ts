import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))

vi.mock('electron', () => ({
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

const PAGE = 'https://user:secret@gallery.example/album/7?sort=new#photo-3'

function openFromMenu(itemId: 'open-link-new-tab' | 'open-image-new-tab', params: Partial<ContextMenuParams>): ReturnType<typeof vi.fn> {
  const createTab = vi.fn(async () => tab)
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, mcpGroupId: 'client', webContents }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    createTab
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const item = built.templates.at(-1)!.find(entry => entry.id === itemId)!
  ;(item.click as () => void)()
  return createTab
}

afterEach(() => {
  built.templates.length = 0
})

describe('opening a link or image in a new tab from the page menu', () => {
  it('sends the frame\'s address under its referrer policy, without its sign-in or fragment', () => {
    // Both opened the address with no referrer, so a site that serves a page or image only to its own pages refused it.
    const referrer = { url: 'https://gallery.example/album/7?sort=new', policy: 'strict-origin-when-cross-origin' }
    const link = openFromMenu('open-link-new-tab', { linkURL: 'https://gallery.example/photos/3' })
    expect(link).toHaveBeenCalledExactlyOnceWith({ url: 'https://gallery.example/photos/3', active: false, mcpGroupId: 'client', openedFrom: { tabId: 'tab', background: true }, loadOptions: { httpReferrer: referrer } })
    const image = openFromMenu('open-image-new-tab', { mediaType: 'image', srcURL: 'https://images.example/3.png', hasImageContents: true })
    expect(image).toHaveBeenCalledExactlyOnceWith({ url: 'https://images.example/3.png', active: false, mcpGroupId: 'client', openedFrom: { tabId: 'tab', background: true }, loadOptions: { httpReferrer: referrer } })
  })

  it('reads the policy when Electron reports it as a referrer object', () => {
    const link = openFromMenu('open-link-new-tab', {
      linkURL: 'https://files.example/a',
      referrerPolicy: { url: PAGE, policy: 'origin' } as ContextMenuParams['referrerPolicy']
    })
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ loadOptions: { httpReferrer: { url: 'https://gallery.example/album/7?sort=new', policy: 'origin' } } }))
  })

  it('sends no referrer from a sandboxed frame, under no-referrer, or from a frame not on the web', () => {
    const expected = { url: 'https://files.example/a', active: false, mcpGroupId: 'client', openedFrom: { tabId: 'tab', background: true } }
    const sandboxed = openFromMenu('open-link-new-tab', {
      linkURL: 'https://files.example/a',
      frame: { origin: 'null' } as unknown as ContextMenuParams['frame']
    })
    expect(sandboxed).toHaveBeenCalledExactlyOnceWith(expected)
    const refused = openFromMenu('open-link-new-tab', { linkURL: 'https://files.example/a', referrerPolicy: 'no-referrer' as unknown as ContextMenuParams['referrerPolicy'] })
    expect(refused).toHaveBeenCalledExactlyOnceWith(expected)
    const local = openFromMenu('open-link-new-tab', { linkURL: 'https://files.example/a', frameURL: 'file:///home/user/page.html' })
    expect(local).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('takes the referrer from the frame that was right-clicked, not the top-level page', () => {
    const link = openFromMenu('open-link-new-tab', { linkURL: 'https://files.example/a', frameURL: 'https://embed.example/player?v=1' })
    expect(link).toHaveBeenCalledWith(expect.objectContaining({ loadOptions: { httpReferrer: { url: 'https://embed.example/player?v=1', policy: 'strict-origin-when-cross-origin' } } }))
  })
})
