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

// The browser below stubs savePageAs, which the menu reaches through this.
vi.mock('../src/main/browser/page-save/page-save.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/page-save/page-save.js')>(),
  savePageAs: (browser: { savePageAs: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.savePageAs(...args)
}))

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
type PageTab = { id: string, url: string, mcpGroupId?: string, webContents: WebContents }
type MenuBrowser = Parameters<typeof showContextMenu>[0]

// The page's context menu had no Save As, as Chrome's has.

function openMenu(url: string, savePage = vi.fn(async () => true), onActionFailed = vi.fn()) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url, mcpGroupId: 'client', webContents }
  const browser = {
    get tabs() { return new Map(built.closed ? [] : [[tab.id, tab]]) },
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    savePageAs: savePage
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: url, frameURL: url, referrerPolicy: 'strict-origin-when-cross-origin'
  } as unknown as ContextMenuParams)
  return { tab, savePage, onActionFailed, items: built.templates.at(-1)! }
}

function clickSave(items: MenuItemConstructorOptions[]): void {
  ;(items.find((entry) => entry.id === 'save-page')!.click as () => void)()
}

afterEach(() => {
  built.templates.length = 0
  built.closed = false
})

describe('Save As in the page context menu', () => {
  it('saves the page it opened on, just before Print', () => {
    const { tab, savePage, items } = openMenu('https://docs.example/guide')
    const ids = items.map((item) => item.id ?? item.type)
    expect(ids[ids.indexOf('save-page') + 1]).toBe('print')
    expect(items.find((entry) => entry.id === 'save-page')!.label).toBe('native.context.savePage')
    clickSave(items)
    expect(savePage).toHaveBeenCalledExactlyOnceWith(tab)
  })

  it('reports a failed save, and a tab that closed while the menu was open', async () => {
    const failure = new Error('Hronaut could not save this page.')
    const failed = openMenu('https://docs.example/guide', vi.fn(async () => { throw failure }))
    clickSave(failed.items)
    await vi.waitFor(() => expect(failed.onActionFailed).toHaveBeenCalledExactlyOnceWith('save the page', failure))

    const closed = openMenu('https://docs.example/guide')
    built.closed = true
    clickSave(closed.items)
    expect(closed.savePage).not.toHaveBeenCalled()
    expect(closed.onActionFailed).toHaveBeenCalledExactlyOnceWith('save the page', expect.objectContaining({ message: 'The tab is no longer available.' }))
  })

  it('is not offered on Hronaut Home', () => {
    const { items } = openMenu('hronaut://home/')
    expect(items.some((entry) => entry.id === 'save-page')).toBe(false)
  })
})
