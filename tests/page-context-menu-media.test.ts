import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents, WebFrameMain } from 'electron'

const built = vi.hoisted(() => ({ templates: [] as MenuItemConstructorOptions[][] }))
const player = vi.hoisted(() => ({ act: vi.fn(async (..._args: unknown[]) => true) }))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      built.templates.push(template)
      return { popup: () => undefined }
    }
  }
}))

vi.mock('../src/main/browser/context-menus/media-player-actions.js', () => ({ mediaPlayerActionAt: player.act }))

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
    downloadURL,
    getZoomFactor: () => 1.25
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
  // Electron's params give the frame of the click until it navigates or goes, and then none.
  const menuParams = {
    x: 10, y: 20, linkURL: '', srcURL: '', selectionText: '', isEditable: false, mediaType: 'none', editFlags: {},
    mediaFlags: { canSave: true, inError: false }, frame: mainFrame,
    pageURL: PAGE, frameURL: PAGE, referrerPolicy: 'strict-origin-when-cross-origin', ...params
  } as unknown as ContextMenuParams
  showContextMenu(access, tab, menuParams)
  const items = built.templates.at(-1)!
  const item = (id: string) => items.find(entry => entry.id === id)
  const click = (id: string) => (item(id)!.click as () => void)()
  // The ids in the menu's order, with a dash for each separator, up to the page's own items.
  const order = () => items.slice(0, items.findIndex(entry => entry.id === 'back') - 1).map(entry => entry.type === 'separator' ? '-' : entry.id)
  return { items, item, click, order, webContents, createTab, downloadURL, copyText, copyVideoFrameAt, onClipboardCopyFailed, mainFrame, params: menuParams as { frame: WebFrameMain | null } }
}

afterEach(() => {
  built.templates.length = 0
  player.act.mockClear()
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

  it('copies and saves nothing from a frame the page removed while the menu was open', () => {
    const state = { parent: {}, detached: false }
    const frame = pageFrame(state)
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: frame as unknown as WebFrameMain })
    state.detached = true
    menu.click('copy-video-frame')
    menu.click('save-video-frame')
    expect(menu.copyVideoFrameAt).not.toHaveBeenCalled()
    expect(frame.saveVideoFrameAs).not.toHaveBeenCalled()
    expect(menu.mainFrame.saveVideoFrameAs).not.toHaveBeenCalled()
  })

  it('copies and saves nothing from the page once the frame of the click has navigated, as Chrome does', () => {
    // The menu kept the frame it was opened on, or fell back to the page's own frame, so it could copy a frame of a
    // video in the document that had replaced the one clicked.
    const frame = pageFrame({ parent: {} })
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: frame as unknown as WebFrameMain })
    menu.params.frame = null
    menu.click('copy-video-frame')
    menu.click('save-video-frame')
    expect(menu.copyVideoFrameAt).not.toHaveBeenCalled()
    expect(frame.saveVideoFrameAs).not.toHaveBeenCalled()
    expect(menu.mainFrame.saveVideoFrameAs).not.toHaveBeenCalled()
  })

  it('keeps the frame items unavailable when the frame of the click is already gone', () => {
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: null })
    expect(menu.item('copy-video-frame')?.enabled).toBe(false)
    expect(menu.item('save-video-frame')?.enabled).toBe(false)
    expect(menu.item('copy-video-address')!.enabled).not.toBe(false)
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

  it('offers only the frame items for a camera stream, which has no address, and no address items for an audio without one', () => {
    const camera = mediaMenu({ mediaType: 'video', srcURL: '' })
    expect(camera.items.filter(entry => entry.id?.includes('video')).map(entry => entry.id)).toEqual(['copy-video-frame', 'save-video-frame'])
    camera.click('copy-video-frame')
    expect(camera.copyVideoFrameAt).toHaveBeenCalledExactlyOnceWith(camera.mainFrame, 10, 20)
    expect(camera.item('back')).toBeDefined()
    expect(mediaMenu({ mediaType: 'audio', srcURL: '' }).items.some(entry => entry.id?.includes('audio'))).toBe(false)
  })
})

describe('Loop, Show controls and Picture in picture in the page menu', () => {
  const flags = (set: Partial<ContextMenuParams['mediaFlags']> = {}) => ({
    canSave: true, inError: false, canLoop: true, isLooping: false, canToggleControls: true, isControlsVisible: false,
    canShowPictureInPicture: true, isShowingPictureInPicture: false, ...set
  }) as ContextMenuParams['mediaFlags']

  it('offers them for a video where Chrome does: Loop and Show controls first, Picture in picture after the frame items', () => {
    // A video's menu had neither, so a clip could not be looped, its controls shown or watched in a window of its own.
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: flags() })
    expect(menu.order()).toEqual([
      'media-loop', 'media-controls', '-',
      'open-video-new-tab', 'save-video', 'copy-video-address', 'copy-video-frame', 'save-video-frame', 'picture-in-picture'
    ])
    expect(['media-loop', 'media-controls', 'picture-in-picture'].map(id => {
      const entry = menu.item(id)!
      return [entry.type, entry.label, entry.checked, entry.enabled]
    })).toEqual([
      ['checkbox', 'native.context.loop', false, true],
      ['checkbox', 'native.context.showControls', false, true],
      ['checkbox', 'native.context.pictureInPicture', false, true]
    ])
  })

  it('turns on what is off and off what is on, for the element at the click, with the page’s zoom', () => {
    const off = mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: flags() })
    off.click('media-loop')
    off.click('media-controls')
    off.click('picture-in-picture')
    expect(player.act.mock.calls).toEqual([
      [off.webContents, off.mainFrame, { x: 10, y: 20, zoom: 1.25 }, 'loop', true],
      [off.webContents, off.mainFrame, { x: 10, y: 20, zoom: 1.25 }, 'controls', true],
      [off.webContents, off.mainFrame, { x: 10, y: 20, zoom: 1.25 }, 'picture-in-picture', true]
    ])
    player.act.mockClear()

    const on = mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: flags({ isLooping: true, isControlsVisible: true, isShowingPictureInPicture: true }) })
    expect(['media-loop', 'media-controls', 'picture-in-picture'].map(id => on.item(id)!.checked)).toEqual([true, true, true])
    on.click('media-loop')
    on.click('media-controls')
    on.click('picture-in-picture')
    expect(player.act.mock.calls.map(call => [call[3], call[4]])).toEqual([['loop', false], ['controls', false], ['picture-in-picture', false]])
  })

  it('acts in the frame of the page the video is in', () => {
    const frame = pageFrame({ parent: {} })
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: frame as unknown as WebFrameMain, x: 300, y: 150, mediaFlags: flags() })
    menu.click('media-loop')
    expect(player.act).toHaveBeenCalledExactlyOnceWith(menu.webContents, frame, { x: 300, y: 150, zoom: 1.25 }, 'loop', true)
  })

  it('keeps each unavailable where Chromium says so, or once the frame of the click is gone', () => {
    const live = mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: flags({ canLoop: false, canToggleControls: false, canShowPictureInPicture: false }) })
    expect(['media-loop', 'media-controls', 'picture-in-picture'].map(id => live.item(id)!.enabled)).toEqual([false, false, false])
    const gone = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: null, mediaFlags: flags() })
    expect(['media-loop', 'media-controls', 'picture-in-picture'].map(id => gone.item(id)!.enabled)).toEqual([false, false, false])
  })

  it('does nothing in a frame that navigated or went while the menu was open', () => {
    const state = { parent: {}, detached: false }
    const frame = pageFrame(state)
    const menu = mediaMenu({ mediaType: 'video', srcURL: VIDEO, frame: frame as unknown as WebFrameMain, mediaFlags: flags() })
    state.detached = true
    menu.click('media-loop')
    const navigated = mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: flags() })
    navigated.params.frame = null
    navigated.click('picture-in-picture')
    expect(player.act).not.toHaveBeenCalled()
  })

  it('offers Loop and Show controls for an audio, with or without an address, and no Picture in picture', () => {
    // Chromium lets no audio's controls be hidden, which would hide the audio, so its Show controls is shown as it is.
    const audio = mediaMenu({ mediaType: 'audio', srcURL: AUDIO, mediaFlags: flags({ canToggleControls: false, isControlsVisible: true }) })
    expect(audio.order()).toEqual(['media-loop', 'media-controls', '-', 'open-audio-new-tab', 'save-audio', 'copy-audio-address'])
    expect([audio.item('media-controls')!.checked, audio.item('media-controls')!.enabled]).toEqual([true, false])
    audio.click('media-loop')
    expect(player.act).toHaveBeenCalledExactlyOnceWith(audio.webContents, audio.mainFrame, { x: 10, y: 20, zoom: 1.25 }, 'loop', true)
    // Chrome offers them for an audio a page plays from a stream too, which has no address.
    expect(mediaMenu({ mediaType: 'audio', srcURL: '', mediaFlags: flags() }).order()).toEqual(['media-loop', 'media-controls'])
  })

  it('logs a failure without the page’s words', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      player.act.mockRejectedValueOnce(new Error('secret page text'))
      mediaMenu({ mediaType: 'video', srcURL: VIDEO, mediaFlags: flags() }).click('media-loop')
      await vi.waitFor(() => expect(error).toHaveBeenCalledExactlyOnceWith('[browser] Could not turn loop on from page context menu.'))
    } finally {
      error.mockRestore()
    }
  })
})
