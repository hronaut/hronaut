import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron'

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
type MenuBrowser = Parameters<typeof showContextMenu>[0]

const PAGE = 'https://charts.example/report'

/** The page menu for a right-click on a canvas, with what Copy Image does. */
function canvasMenu(params: Partial<ContextMenuParams>, copyImageAt = vi.fn(async (_contents: WebContents, _x: number, _y: number, _picture?: string) => undefined)) {
  const onClipboardCopyFailed = vi.fn()
  const mainFrame = pageFrame(null, 4)
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    mainFrame
  } as unknown as WebContents
  const tab = { id: 'tab', url: PAGE, webContents }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    window: {},
    options: { copyText: async () => undefined, copyImageAt, onClipboardCopyFailed },
    text: (key: string) => key,
    isHumanInteractionLocked: () => false
  } as unknown as MenuBrowser
  const menuParams = {
    x: 140, y: 90, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'canvas', hasImageContents: false, editFlags: {},
    mediaFlags: {}, frame: mainFrame, pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams
  showContextMenu(browser, tab as never, menuParams)
  const items = built.templates.at(-1)!
  const item = (id: string) => items.find(entry => entry.id === id)
  // The ids in the menu's order, with a dash for each separator, up to the page's own items.
  const order = () => items.slice(0, items.findIndex(entry => entry.id === 'back') - 1).map(entry => entry.type === 'separator' ? '-' : entry.id)
  return { items, item, order, webContents, mainFrame, copyImageAt, onClipboardCopyFailed }
}

/** A frame of the page, in the render process given. */
function pageFrame(parent: unknown, processId: number) {
  return { parent, processId, origin: 'https://charts.example', isDestroyed: () => false, detached: false }
}

afterEach(() => {
  built.templates.length = 0
  vi.restoreAllMocks()
})

describe('the page menu on a canvas', () => {
  it('copies the picture the canvas shows, from the point of the click, as Chrome does', () => {
    // A right-click on a canvas, such as a chart, showed only the page's items, so its picture could not be copied.
    // Electron says whether there is a picture only for an image, so a canvas reports none.
    const menu = canvasMenu({ hasImageContents: false })
    expect([menu.item('copy-canvas-image')?.label, menu.item('copy-canvas-image')?.enabled ?? true]).toEqual(['native.context.copyImage', true])
    expect(menu.order()).toEqual(['copy-canvas-image'])

    ;(menu.item('copy-canvas-image')!.click as () => void)()
    expect(menu.copyImageAt).toHaveBeenCalledExactlyOnceWith(menu.webContents, 140, 90, 'canvas')
  })

  it('comes after the link items for a canvas inside a link, as in Chrome', () => {
    const menu = canvasMenu({ linkURL: 'https://charts.example/report/full' })
    expect(menu.order()).toEqual(['open-link-new-tab', 'open-link-split-view', 'copy-link-address', 'save-link', '-', 'copy-canvas-image'])
  })

  it('copies from a frame in the page\'s own process, and is unavailable in a frame another process runs', () => {
    // The copy hit-tests from the page's own frame, so in a frame of another site it always failed.
    const page = pageFrame(null, 4)
    const sameSite = pageFrame(page, 4)
    expect(canvasMenu({ frame: sameSite as unknown as WebFrameMain }).item('copy-canvas-image')?.enabled ?? true).toBe(true)
    const otherSite = pageFrame(page, 9)
    expect(canvasMenu({ frame: otherSite as unknown as WebFrameMain }).item('copy-canvas-image')?.enabled).toBe(false)
    // Also a frame of the same site inside one of another site, whose process the page's frame does not reach into.
    expect(canvasMenu({ frame: pageFrame(otherSite, 4) as unknown as WebFrameMain }).item('copy-canvas-image')?.enabled).toBe(false)
    const gone = { get parent(): never { throw new Error('Render frame was disposed') }, processId: 4 }
    expect(canvasMenu({ frame: gone as unknown as WebFrameMain }).item('copy-canvas-image')?.enabled).toBe(false)
    expect(canvasMenu({ frame: null as unknown as WebFrameMain }).item('copy-canvas-image')?.enabled).toBe(false)
  })

  it('offers no canvas item for the page itself or an image', () => {
    expect(canvasMenu({ mediaType: 'none' }).item('copy-canvas-image')).toBeUndefined()
    const image = canvasMenu({ mediaType: 'image', srcURL: 'https://charts.example/chart.png' })
    expect(image.item('copy-canvas-image')).toBeUndefined()
    expect(image.item('copy-image')).toBeDefined()
  })

  it('reports a copy that failed', async () => {
    const error = new Error('clipboard unavailable')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const menu = canvasMenu({}, vi.fn(async () => { throw error }))
    ;(menu.item('copy-canvas-image')!.click as () => void)()
    await vi.waitFor(() => expect(menu.onClipboardCopyFailed).toHaveBeenCalledExactlyOnceWith(error))
    expect(logged).toHaveBeenCalledExactlyOnceWith('[browser] Could not copy context-menu image:', error)
  })
})
