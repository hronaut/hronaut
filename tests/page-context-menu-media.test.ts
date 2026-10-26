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
type PageTab = { id: string, url: string, mcpGroupId?: string, webContents: WebContents }
type PageContextMenuAccess = import('../src/main/browser/context-menus/page-context-menu-access.js').PageContextMenuAccess<PageTab>

const PAGE = 'https://films.example/watch/7'
const VIDEO = 'https://cdn.example/clips/7.mp4'
const AUDIO = 'https://cdn.example/sounds/7.ogg'

/** A frame of the page, which copies and saves the frame of a video in it. */
function pageFrame(state: { destroyed?: boolean, detached?: boolean, parent?: unknown } = {}) {
  return {
    parent: state.parent ?? null,
    origin: 'https://films.example',
    isDestroyed: () => state.destroyed ?? false,
    get detached() { return state.detached ?? false },
    copyVideoFrameAt: vi.fn(),
    saveVideoFrameAs: vi.fn()
  }
}

/** The page menu for a right-click on a video or audio, with what its items do. */
function mediaMenu(params: Partial<ContextMenuParams>) {
  const createTab = vi.fn(async () => tab)
  const downloadURL = vi.fn()
  const copyText = vi.fn(async () => undefined)
  const copyVideoFrameAt = vi.fn(async (_frame: WebFrameMain, _x: number, _y: number) => undefined)
  const onClipboardCopyFailed = vi.fn()
  const mainFrame = pageFrame()
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    mainFrame,
    downloadURL
  } as unknown as WebContents
  const tab: PageTab = { id: 'tab', url: PAGE, mcpGroupId: 'client', webContents }
  const access = {
    findTab: () => tab,
    window: () => ({}),
    options: () => ({ copyText, copyImageAt: async () => undefined, copyVideoFrameAt, onClipboardCopyFailed }),
    text: (key: string) => key,
    isHumanInteractionLocked: () => false,
    expectSavedLinkName: vi.fn(),
    createTab
  } as unknown as PageContextMenuAccess
  showContextMenu(access, tab, {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    mediaFlags: { canSave: true, inError: false },
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams)
  const items = built.templates.at(-1)!
  const item = (id: string) => items.find(entry => entry.id === id)
  const click = (id: string) => (item(id)!.click as () => void)()
  return { items, item, click, createTab, downloadURL, copyText, copyVideoFrameAt, onClipboardCopyFailed, mainFrame }
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
      ['copy-video-address', 'native.context.copyVideoAddress', true],
      ['copy-video-frame', 'native.context.copyVideoFrame', true],
      ['save-video-frame', 'native.context.saveVideoFrame', true]
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

  it('copies and saves the frame a video shows, from the page at the click, as Chrome does', async () => {
    // The menu had no frame items, so a still of a video could be had only from a screenshot of the page.
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO })
    menu.click('copy-video-frame')
    expect(menu.copyVideoFrameAt).toHaveBeenCalledExactlyOnceWith(menu.mainFrame, 10, 20)
    menu.click('save-video-frame')
    expect(menu.mainFrame.saveVideoFrameAs).toHaveBeenCalledExactlyOnceWith(10, 20)
    expect(menu.downloadURL).not.toHaveBeenCalled()

    menu.copyVideoFrameAt.mockRejectedValueOnce(new Error('no frame'))
    menu.click('copy-video-frame')
    await vi.waitFor(() => expect(menu.onClipboardCopyFailed).toHaveBeenCalledExactlyOnceWith(new Error('no frame')))
  })

  it('takes the frame of a video inside a frame of the page from that frame, with the page coordinates', () => {
    const frame = pageFrame({ parent: {} })
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: frame as unknown as WebFrameMain, x: 300, y: 150 })
    menu.click('copy-video-frame')
    expect(menu.copyVideoFrameAt).toHaveBeenCalledExactlyOnceWith(frame, 300, 150)
    menu.click('save-video-frame')
    expect(frame.saveVideoFrameAs).toHaveBeenCalledExactlyOnceWith(300, 150)
    expect(menu.mainFrame.saveVideoFrameAs).not.toHaveBeenCalled()
  })

  it('saves nothing from a frame the page removed while the menu was open', () => {
    const state = { parent: {}, detached: false }
    const frame = pageFrame(state)
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: frame as unknown as WebFrameMain })
    state.detached = true
    menu.click('save-video-frame')
    expect(frame.saveVideoFrameAs).not.toHaveBeenCalled()
    expect(menu.mainFrame.saveVideoFrameAs).not.toHaveBeenCalled()
  })

  it('keeps the frame items unavailable for a video in error, and offers none for an audio', () => {
    const broken = mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: { canSave: true, inError: true } as ContextMenuParams['mediaFlags'] })
    expect(broken.item('copy-video-frame')?.enabled).toBe(false)
    expect(broken.item('save-video-frame')?.enabled).toBe(false)
    expect(mediaMenu({ mediaType: 'audio', srcURL: AUDIO }).items.some(entry => entry.id?.includes('frame'))).toBe(false)
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

  it('offers only the frame items for a camera stream, which has no address, and nothing for an audio without one', () => {
    const camera = mediaMenu({ mediaType: 'video', srcURL: '' })
    expect(camera.items.filter(entry => entry.id?.includes('video')).map(entry => entry.id)).toEqual(['copy-video-frame', 'save-video-frame'])
    camera.click('copy-video-frame')
    expect(camera.copyVideoFrameAt).toHaveBeenCalledExactlyOnceWith(camera.mainFrame, 10, 20)
    expect(camera.item('back')).toBeDefined()
    expect(mediaMenu({ mediaType: 'audio', srcURL: '' }).items.some(entry => entry.id?.includes('audio'))).toBe(false)
  })
})
