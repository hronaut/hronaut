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
type PageContextMenuAccess = import('../src/main/browser/context-menus/page-context-menu-access.js').PageContextMenuAccess<PageTab>

const PAGE = 'https://films.example/watch/7'
const VIDEO = 'https://cdn.example/clips/7.mp4'
const AUDIO = 'https://cdn.example/sounds/7.ogg'

/** The page menu for a right-click on a video or audio, with what its items do. */
function mediaMenu(params: Partial<ContextMenuParams>) {
  const createTab = vi.fn(async () => tab)
  const downloadURL = vi.fn()
  const copyText = vi.fn(async () => undefined)
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    downloadURL
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, mcpGroupId: 'client', webContents }
  const access = {
    findTab: () => tab,
    window: () => ({}),
    options: () => ({ copyText, copyImageAt: async () => undefined }),
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    expectSavedLinkName: vi.fn(),
    createTab
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    mediaFlags: { canSave: true },
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  const item = (id: string) => items.find(entry => entry.id === id)
  const click = (id: string) => (item(id)!.click as () => void)()
  return { items, item, click, createTab, downloadURL, copyText }
}

afterEach(() => {
  built.templates.length = 0
})

describe('the page menu on a video or audio', () => {
  it('opens, saves and copies a video, as Chrome does', () => {
    // A right-click on a video showed only the page's items, so a video could not be saved or opened by itself.
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO })
    expect(menu.items.filter(entry => entry.id?.includes('video')).map(entry => [entry.id, entry.label, entry.enabled ?? true])).toEqual([
      ['open-video-new-tab', 'native.context.openVideo', true],
      ['save-video', 'native.context.saveVideo', true],
      ['copy-video-address', 'native.context.copyVideoAddress', true]
    ])

    menu.click('open-video-new-tab')
    expect(menu.createTab).toHaveBeenCalledExactlyOnceWith({
      url: VIDEO,
      active: false,
      mcpGroupId: 'client',
      openedFrom: { tabId: 'tab', background: true },
      loadOptions: { httpReferrer: { url: PAGE, policy: 'strict-origin-when-cross-origin' } }
    })
    menu.click('save-video')
    expect(menu.downloadURL).toHaveBeenCalledExactlyOnceWith(VIDEO, { headers: { Referer: 'https://films.example/' } })
    menu.click('copy-video-address')
    expect(menu.copyText).toHaveBeenCalledExactlyOnceWith(VIDEO)
  })

  it('names the items for an audio as audio', () => {
    const menu = mediaMenu({ mediaType: 'audio', srcURL: AUDIO })
    expect(menu.items.filter(entry => entry.id?.includes('audio')).map(entry => [entry.id, entry.label])).toEqual([
      ['open-audio-new-tab', 'native.context.openAudio'],
      ['save-audio', 'native.context.saveAudio'],
      ['copy-audio-address', 'native.context.copyAudioAddress']
    ])
    menu.click('save-audio')
    expect(menu.downloadURL).toHaveBeenCalledExactlyOnceWith(AUDIO, { headers: { Referer: 'https://films.example/' } })
    expect(menu.item('save-video')).toBeUndefined()
  })

  it('keeps Open and Save unavailable for a stream Chromium cannot save, and still copies its address', () => {
    const stream = mediaMenu({ mediaType: 'video', srcURL: 'blob:https://films.example/5d1c', mediaFlags: { canSave: false } as ContextMenuParams['mediaFlags'] })
    expect(stream.item('open-video-new-tab')?.enabled).toBe(false)
    expect(stream.item('save-video')?.enabled).toBe(false)
    expect(stream.item('copy-video-address')).toBeDefined()
    expect(stream.item('copy-video-address')!.enabled).not.toBe(false)

    const unsavable = mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: { canSave: false } as ContextMenuParams['mediaFlags'] })
    expect(unsavable.item('open-video-new-tab')?.enabled).toBe(false)
    expect(unsavable.item('save-video')?.enabled).toBe(false)
    expect(unsavable.item('copy-video-address')!.enabled).not.toBe(false)

    const local = mediaMenu({ mediaType: 'audio', srcURL: 'file:///home/user/a.ogg' })
    expect(local.item('open-audio-new-tab')?.enabled).toBe(false)
    expect(local.item('save-audio')?.enabled).toBe(false)
    expect(local.item('copy-audio-address')!.enabled).not.toBe(false)
  })

  it('adds no media items for a camera stream, which has no address', () => {
    const camera = mediaMenu({ mediaType: 'video', srcURL: '' })
    expect(camera.items.some(entry => entry.id?.includes('video'))).toBe(false)
    expect(camera.item('back')).toBeDefined()
  })
})
