import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))

vi.mock('electron', () => ({
  app: { isEmojiPanelSupported: () => false },
  clipboard: { readText: async () => '' },
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

// Hronaut had no Create QR Code for this Page or for this Image, as Chrome's page menu has.

function openMenu(params: Partial<ContextMenuParams>, url = 'https://docs.example/guide') {
  let destroyed = false
  const webContents = { id: 7, isDestroyed: () => destroyed, navigationHistory: { canGoBack: () => false, canGoForward: () => false } } as unknown as WebContents
  const tab: PageTab = { id: 'tab-7', url, mcpGroupId: 'client', webContents }
  const send = vi.fn()
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    window: { webContents: { send } },
    options: {
      copyText: async () => undefined, copyImageAt: async () => undefined,
      getSearchEngine: () => 'google'
    },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    browserContentOccluded: false
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {}, mediaFlags: { canSave: true },
    pageURL: url, frameURL: url, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  const ids = items.map((item) => item.id ?? item.type)
  const click = (id: string) => (items.find((item) => item.id === id)!.click as () => void)()
  return { ids, items, click, send, closeTab: () => { destroyed = true } }
}

afterEach(() => {
  built.templates.length = 0
})

describe('Create QR Code in the page context menu', () => {
  it('offers the page\'s address after Print, and asks the shell for the dialog', () => {
    const menu = openMenu({})
    expect(menu.ids.slice(menu.ids.indexOf('print'), menu.ids.indexOf('print') + 3)).toEqual(['print', 'create-qr-code-page', 'view-page-source'])
    expect(menu.items.find((item) => item.id === 'create-qr-code-page')!.label).toBe('native.context.createQrCodePage')
    menu.click('create-qr-code-page')
    expect(menu.send).toHaveBeenCalledExactlyOnceWith('browser:qr-code-requested', { tabId: 'tab-7', address: 'https://docs.example/guide' })
  })

  it('offers an image\'s address after Copy Image Address, for an image that is not a link', () => {
    const image = 'https://cdn.example/chart.png'
    const menu = openMenu({ mediaType: 'image', srcURL: image, hasImageContents: true })
    expect(menu.ids.slice(menu.ids.indexOf('copy-image-address'), menu.ids.indexOf('copy-image-address') + 3)).toEqual(['copy-image-address', 'create-qr-code-image', 'save-image'])
    expect(menu.items.find((item) => item.id === 'create-qr-code-image')!.label).toBe('native.context.createQrCodeImage')
    menu.click('create-qr-code-image')
    expect(menu.send).toHaveBeenCalledExactlyOnceWith('browser:qr-code-requested', { tabId: 'tab-7', address: image })
    expect(openMenu({ mediaType: 'image', srcURL: image, hasImageContents: true, linkURL: 'https://docs.example/next' }).ids).not.toContain('create-qr-code-image')
    expect(openMenu({ mediaType: 'image', srcURL: 'data:image/png;base64,iVBORw0KGgo=', hasImageContents: true }).ids).not.toContain('create-qr-code-image')
  })

  it('asks for nothing once its tab is gone', () => {
    const menu = openMenu({})
    menu.closeTab()
    menu.click('create-qr-code-page')
    expect(menu.send).not.toHaveBeenCalled()
  })

  it('offers nothing for a page that is not a web page', () => {
    for (const url of ['file:///home/me/notes.html', 'about:blank']) expect(openMenu({}, url).ids, url).not.toContain('create-qr-code-page')
  })
})
