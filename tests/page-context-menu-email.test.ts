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

const PAGE = 'https://shop.example/contact'

/** The page menu for a right-click on a link, with its copy item and what that copies. */
function linkMenu(linkURL: string) {
  const copyText = vi.fn(async (_text: string) => undefined)
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, mcpGroupId: 'client', webContents }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    window: {},
    options: { copyText, copyImageAt: async () => undefined },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    downloadController: { expectSavedLinkName: vi.fn() },
    createTab: vi.fn()
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, {
    x: 10, y: 20, linkURL, srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    mediaFlags: {}, pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin'
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  const item = (id: string) => items.find(entry => entry.id === id)
  const copy = item('copy-link-address')!
  ;(copy.click as () => void)()
  return { item, label: copy.label, copied: copyText.mock.calls.at(-1)?.[0] }
}

afterEach(() => {
  built.templates.length = 0
})

describe('the page menu on an email link', () => {
  it('copies the email address alone, as Chrome does', () => {
    const menu = linkMenu('mailto:support@shop.example?subject=Order%2042&body=Hello')

    expect(menu.label).toBe('native.context.copyEmail')
    expect(menu.copied).toBe('support@shop.example')
    // A mail link opens no tab and saves nothing, as before.
    expect(menu.item('open-link-new-tab')?.enabled).toBe(false)
    expect(menu.item('save-link')?.enabled).toBe(false)
  })

  it('writes out escaped characters, but keeps a space, an invisible character or bytes that are not text escaped', () => {
    expect(linkMenu('mailto:sales%40shop.example,ops@shop.example').copied).toBe('sales@shop.example,ops@shop.example')
    expect(linkMenu('mailto:j%C3%BCrgen@shop.example').copied).toBe('jürgen@shop.example')
    expect(linkMenu('mailto:J%C3%BCrgen%20M%E2%80%8B@shop.example').copied).toBe('Jürgen%20M%E2%80%8B@shop.example')
    expect(linkMenu('mailto:a%FFb@shop.example').copied).toBe('a%FFb@shop.example')
    expect(linkMenu('MAILTO:Team@Shop.example').copied).toBe('Team@Shop.example')
    // A bidi override or a Hangul filler could disguise the address, so they stay escaped, as in Chrome.
    expect(linkMenu('mailto:moc.elpmaxe%E2%80%AE@shop.example').copied).toBe('moc.elpmaxe%E2%80%AE@shop.example')
    expect(linkMenu('mailto:a%E3%85%A4b@shop.example').copied).toBe('a%E3%85%A4b@shop.example')
    // One pass: an escaped percent sign stays one, and an escaped "?" is part of the address.
    expect(linkMenu('mailto:a%2540b@shop.example').copied).toBe('a%40b@shop.example')
    expect(linkMenu('mailto:what%3F@shop.example').copied).toBe('what?@shop.example')
    expect(linkMenu('mailto:j%C3%BC%FF@shop.example').copied).toBe('j%C3%BC%FF@shop.example')
  })

  it('reads an email link as Chromium does, with no host or fragment', () => {
    expect(linkMenu('mailto://support@shop.example/').copied).toBe('//support@shop.example/')
    expect(linkMenu('mailto:a@shop.example#b?subject=c').copied).toBe('a@shop.example#b')
  })

  it('copies the whole link when it names no address, and any other link as it is', () => {
    const toField = linkMenu('mailto:?to=support@shop.example')
    expect(toField.label).toBe('native.context.copyLink')
    expect(toField.copied).toBe('mailto:?to=support@shop.example')

    const web = linkMenu('https://shop.example/mailto:support@shop.example')
    expect(web.label).toBe('native.context.copyLink')
    expect(web.copied).toBe('https://shop.example/mailto:support@shop.example')
  })
})
