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

// Each case sets what opening the split view does, and tells what showing the link's tab beside the page asked for.
const { openSplitViewAndWait } = vi.hoisted(() => ({ openSplitViewAndWait: vi.fn<(browser: unknown, tabId: string, options: unknown) => Promise<unknown>>() }))
vi.mock('../src/main/browser/split-view/split-view.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/split-view/split-view.js')>(),
  openSplitViewAndWait
}))

const { showContextMenu } = await import('../src/main/browser/context-menus/page-context-menu.js')
type PageTab = { id: string, url: string, mcpGroupId?: string, webContents: WebContents }
type MenuBrowser = Parameters<typeof showContextMenu>[0]

// A link's menu had no Open Link in Split View, which Chrome's has to open the link in a new tab beside the page.

const PAGE = 'https://docs.example/guide/start?lang=en#install'

function linkMenu(linkURL: string, options: { page?: string, createTab?: () => Promise<PageTab>, openSplitView?: () => Promise<unknown> } = {}) {
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false }
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: options.page ?? PAGE, mcpGroupId: 'client', webContents }
  const created: PageTab = { id: 'beside', url: linkURL, mcpGroupId: 'client', webContents }
  const createTab = vi.fn(options.createTab ?? (async () => created))
  const openSplitView = openSplitViewAndWait.mockReset().mockImplementation(options.openSplitView ?? (async () => ({})))
  const onActionFailed = vi.fn()
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    window: {},
    options: { copyText: async () => undefined, copyImageAt: async () => undefined, onActionFailed },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    createTab
  } as unknown as MenuBrowser
  showContextMenu(browser, tab as never, {
    x: 10, y: 20, linkURL, srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: tab.url, frameURL: tab.url, referrerPolicy: 'strict-origin-when-cross-origin'
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  const item = items.find(entry => entry.id === 'open-link-split-view')
  return { browser, tab, created, items, item, createTab, openSplitView, onActionFailed, choose: () => (item!.click as () => void)() }
}

afterEach(() => {
  built.templates.length = 0
})

describe('Open Link in Split View in a link\'s page menu', () => {
  it('follows Open Link in New Tab', () => {
    const { items, item } = linkMenu('https://docs.example/guide/api')
    const ids = items.map(entry => entry.id)
    expect(ids.indexOf('open-link-split-view')).toBe(ids.indexOf('open-link-new-tab') + 1)
    expect(item).toMatchObject({ label: 'native.context.openLinkSplit', enabled: true })
  })

  it('opens the link in a background tab as Open Link in New Tab does, then shows it beside the page', async () => {
    const { browser, created, createTab, openSplitView, choose } = linkMenu('https://docs.example/guide/api')
    choose()
    await vi.waitFor(() => expect(openSplitView).toHaveBeenCalledExactlyOnceWith(browser, created.id, { openedBeside: true }))
    expect(createTab).toHaveBeenCalledExactlyOnceWith({
      url: 'https://docs.example/guide/api',
      active: false,
      mcpGroupId: 'client',
      openedFrom: { tabId: 'tab', background: true },
      loadOptions: { httpReferrer: { url: 'https://docs.example/guide/start?lang=en', policy: 'strict-origin-when-cross-origin' } }
    })
  })

  it('reports a tab that could not open or be shown beside the page', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const unopened = new Error('workspace closed')
      const failedOpen = linkMenu('https://docs.example/guide/api', { createTab: async () => { throw unopened } })
      failedOpen.choose()
      await vi.waitFor(() => expect(failedOpen.onActionFailed).toHaveBeenCalledWith('open link in split view', unopened))
      expect(failedOpen.openSplitView).not.toHaveBeenCalled()

      const unshown = new Error('tab closed')
      const failedSplit = linkMenu('https://docs.example/guide/api', { openSplitView: async () => { throw unshown } })
      failedSplit.choose()
      await vi.waitFor(() => expect(failedSplit.onActionFailed).toHaveBeenCalledWith('open link in split view', unshown))
    } finally {
      error.mockRestore()
    }
  })

  it('is unavailable for a link that is not a web address, and left out on Home, which split view never shows', () => {
    expect(linkMenu('mailto:team@docs.example').item?.enabled).toBe(false)
    expect(linkMenu('javascript:void(0)').item?.enabled).toBe(false)
    const home = linkMenu('https://docs.example/guide/api', { page: 'hronaut://home/' })
    expect(home.item).toBeUndefined()
    expect(home.items.map(entry => entry.id)).toContain('open-link-new-tab')
  })
})
