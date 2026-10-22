import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][], closed: false }))

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
type PageContextMenuAccess = import('../src/main/browser/context-menus/page-context-menu-access.js').PageContextMenuAccess<PageTab>

// The page's context menu had no Print, as Chrome's has.

function openMenu(url: string, print = vi.fn(async () => undefined), onActionFailed = vi.fn()) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url, mcpGroupId: 'client', webContents }
  const access = {
    findTab: () => built.closed ? undefined : tab,
    window: () => ({}),
    options: () => ({ copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed }),
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    print
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: url, frameURL: url, referrerPolicy: 'strict-origin-when-cross-origin'
  } as unknown as ContextMenuParams)
  return { tab, print, onActionFailed, items: built.templates.at(-1)! }
}

afterEach(() => {
  built.templates.length = 0
  built.closed = false
})

describe('Print in the page context menu', () => {
  it('prints the page it opened on, after Copy Page Address and before Inspect', () => {
    const { tab, print, items } = openMenu('https://docs.example/invoice')
    const ids = items.map((item) => item.id ?? item.type)
    expect(ids.slice(ids.indexOf('copy-page-address'))).toEqual(['copy-page-address', 'print', 'inspect-element'])
    const item = items.find((entry) => entry.id === 'print')!
    expect(item.label).toBe('native.context.print')
    ;(item.click as () => void)()
    expect(print).toHaveBeenCalledExactlyOnceWith(tab)
  })

  it('reports a failed print', async () => {
    const failure = new Error('Hronaut could not print this page.')
    const { onActionFailed, items } = openMenu('https://docs.example/invoice', vi.fn(async () => { throw failure }))
    ;(items.find((entry) => entry.id === 'print')!.click as () => void)()
    await vi.waitFor(() => expect(onActionFailed).toHaveBeenCalledExactlyOnceWith('print the page', failure))
  })

  it('reports a tab that closed while the menu was open instead of doing nothing', () => {
    const { print, onActionFailed, items } = openMenu('https://docs.example/invoice')
    built.closed = true
    ;(items.find((entry) => entry.id === 'print')!.click as () => void)()
    expect(print).not.toHaveBeenCalled()
    expect(onActionFailed).toHaveBeenCalledExactlyOnceWith('print the page', expect.objectContaining({ message: 'The tab is no longer available.' }))
  })

  it('is not offered on Hronaut Home', () => {
    const { items } = openMenu('hronaut://home/')
    expect(items.some((entry) => entry.id === 'print')).toBe(false)
  })
})
