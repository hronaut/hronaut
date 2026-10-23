import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron'

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

// A right-click inside a frame of the page offered nothing for the frame, where Chrome offers View Frame Source and
// Reload Frame.

const PAGE = 'https://shop.example/checkout'
const FRAME = 'https://pay.example/card?order=7'

/** A frame of the page; its parent is the page's own frame. */
function childFrame(options: { reload?: () => boolean; destroyed?: boolean; detached?: boolean } = {}) {
  return {
    parent: {},
    isDestroyed: () => options.destroyed ?? false,
    detached: options.detached ?? false,
    reload: vi.fn(options.reload ?? (() => true))
  }
}

function openMenu(options: { url?: string; frame?: object | null; frameURL?: string } = {}) {
  const url = options.url ?? PAGE
  const viewFrameSource = vi.fn(async () => true)
  const onActionFailed = vi.fn()
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
    viewSource: vi.fn(async () => true),
    viewFrameSource
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    pageURL: url, frameURL: options.frameURL ?? FRAME, referrerPolicy: 'strict-origin-when-cross-origin',
    frame: (options.frame === undefined ? childFrame() : options.frame) as WebFrameMain | null
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  const click = (id: string) => (items.find(entry => entry.id === id)!.click as () => void)()
  return { tab, items, click, viewFrameSource, onActionFailed }
}

afterEach(() => {
  built.templates.length = 0
  built.closed = false
})

describe('the frame items of the page context menu', () => {
  it('offers the frame\'s source and a reload of the frame between View Page Source and Inspect, as Chrome does', () => {
    const frame = childFrame()
    const menu = openMenu({ frame })
    const ids = menu.items.map(item => item.id ?? item.type)
    expect(ids.slice(ids.indexOf('view-page-source'))).toEqual(['view-page-source', 'view-frame-source', 'reload-frame', 'inspect-element'])
    expect(menu.items.find(item => item.id === 'view-frame-source')?.label).toBe('native.context.viewFrameSource')
    expect(menu.items.find(item => item.id === 'reload-frame')?.label).toBe('native.context.reloadFrame')

    menu.click('view-frame-source')
    expect(menu.viewFrameSource).toHaveBeenCalledExactlyOnceWith(menu.tab, FRAME)
    menu.click('reload-frame')
    expect(frame.reload).toHaveBeenCalledOnce()
  })

  it('offers neither on the page itself nor on Home, and no source for a frame that shows no web page', () => {
    for (const frame of [null, { parent: null }]) {
      const ids = openMenu({ frame }).items.map(item => item.id)
      expect(ids).not.toContain('view-frame-source')
      expect(ids).not.toContain('reload-frame')
    }
    expect(openMenu({ url: 'hronaut://home/' }).items.map(item => item.id)).not.toContain('reload-frame')

    const ids = openMenu({ frameURL: 'about:srcdoc' }).items.map(item => item.id)
    expect(ids).not.toContain('view-frame-source')
    expect(ids).toContain('reload-frame')
  })

  it('reloads nothing for a frame removed while the menu was open, and reports a tab that closed or a failed reload', () => {
    const gone = Object.defineProperty({}, 'parent', { get: () => { throw new Error('Render frame was disposed') } })
    expect(openMenu({ frame: gone }).items.map(item => item.id)).not.toContain('reload-frame')

    for (const frame of [childFrame({ destroyed: true }), childFrame({ detached: true })]) {
      const removed = openMenu({ frame })
      removed.click('reload-frame')
      expect(frame.reload).not.toHaveBeenCalled()
      expect(removed.onActionFailed).not.toHaveBeenCalled()
    }

    const failure = new Error('The frame could not reload')
    const failing = openMenu({ frame: childFrame({ reload: () => { throw failure } }) })
    failing.click('reload-frame')
    expect(failing.onActionFailed).toHaveBeenCalledExactlyOnceWith('reload the frame', failure)

    const closing = openMenu()
    built.closed = true
    closing.click('view-frame-source')
    expect(closing.viewFrameSource).not.toHaveBeenCalled()
    expect(closing.onActionFailed).toHaveBeenCalledExactlyOnceWith('view frame source', expect.objectContaining({ message: 'The tab is no longer available.' }))
  })
})
