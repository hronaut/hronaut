import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents, WebFrameMain } from 'electron'
import { mediaPlayerActionAt } from '../src/main/browser/context-menus/media-player-actions.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

/** A document or shadow root, whose elements are where `elementFromPoint` puts them. */
interface Root {
  elementFromPoint: ReturnType<typeof vi.fn>
  pictureInPictureElement: unknown
}

class HTMLMediaElement {
  loop = false
  controls = false
  shadowRoot: Root | null = null
  constructor(private readonly root: Root) {}
  getRootNode(): Root {
    return this.root
  }
}
class HTMLAudioElement extends HTMLMediaElement {}
class HTMLVideoElement extends HTMLMediaElement {
  requestPictureInPicture = vi.fn(async () => {
    this.getRootNode().pictureInPictureElement = this
  })
}
class HTMLIFrameElement {
  shadowRoot: Root | null = null
  contentWindow: unknown = {}
  constructor(
    readonly rect: { left: number; top: number; width: number; height: number },
    readonly offsetWidth: number,
    readonly offsetHeight: number,
    readonly clientLeft: number,
    readonly clientTop: number,
    readonly padding: { left: number; top: number }
  ) {}
  getBoundingClientRect() {
    return this.rect
  }
}
class HTMLFrameElement extends HTMLIFrameElement {}
class HTMLObjectElement extends HTMLIFrameElement {}
class HTMLEmbedElement {}
/** A custom element, such as a player, that keeps what it shows in its shadow root. */
class CustomElement {
  constructor(readonly shadowRoot: Root) {}
}

function root(): Root {
  return { elementFromPoint: vi.fn(() => null), pictureInPictureElement: null }
}

/** A frame's page. Its visual viewport is where a pinch shows the page from. */
interface FramePage {
  innerWidth: number
  innerHeight: number
  visualViewport: { scale: number; offsetLeft: number; offsetTop: number }
  document: Root & { exitPictureInPicture: ReturnType<typeof vi.fn> }
}

function framePage(): FramePage {
  const document: FramePage['document'] = {
    ...root(),
    exitPictureInPicture: vi.fn(async () => {
      document.pictureInPictureElement = null
    })
  }
  return { innerWidth: 800, innerHeight: 600, visualViewport: { scale: 1, offsetLeft: 0, offsetTop: 0 }, document }
}

/** Runs a script in a frame's page, as Electron does, recording whether it had the person's click. */
function runner(page: FramePage) {
  const gestures: boolean[] = []
  const run = async (code: string, userGesture: boolean): Promise<unknown> => {
    gestures.push(userGesture)
    return await (runInNewContext(code, {
      ...page,
      HTMLMediaElement,
      HTMLVideoElement,
      HTMLIFrameElement,
      HTMLFrameElement,
      HTMLObjectElement,
      HTMLEmbedElement,
      getComputedStyle: (element: HTMLIFrameElement) => ({ paddingLeft: `${element.padding.left}px`, paddingTop: `${element.padding.top}px` })
    }) as Promise<unknown>)
  }
  return { gestures, run }
}

/** A frame inside the page, which runs scripts only in its page's own world. */
function subframe(page: FramePage, parent: unknown, state: { detached?: boolean; destroyed?: boolean } = {}) {
  const { gestures, run } = runner(page)
  return {
    parent,
    get detached() { return state.detached ?? false },
    isDestroyed: () => state.destroyed ?? false,
    gestures,
    executeJavaScript: vi.fn(run)
  }
}

/** The page's own frame and its web contents, which run its scripts in a world of their own. */
function tabPage(page: FramePage) {
  const { gestures, run } = runner(page)
  const frame = { parent: null, detached: false, isDestroyed: () => false, executeJavaScript: vi.fn(run) }
  const webContents = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, scripts: Array<{ code: string }>, userGesture: boolean) => await run(scripts[0]!.code, userGesture))
  }
  return { frame, webContents, gestures }
}

const act = (tab: { webContents: unknown }, frame: unknown, point: { x: number; y: number; zoom?: number }, action: 'loop' | 'controls' | 'picture-in-picture', enable: boolean) =>
  mediaPlayerActionAt(tab.webContents as WebContents, frame as WebFrameMain, { zoom: 1, ...point }, action, enable)

describe('Loop, Show controls and Picture in picture from the page menu', () => {
  it('turns on Loop for the video at the click in the page, in a world of its own, in the page’s zoomed pixels', async () => {
    const page = framePage()
    const video = new HTMLVideoElement(page.document)
    page.document.elementFromPoint.mockReturnValue(video)
    const tab = tabPage(page)
    expect(await act(tab, tab.frame, { x: 300, y: 150, zoom: 1.5 }, 'loop', true)).toBe(true)
    expect(video.loop).toBe(true)
    expect(page.document.elementFromPoint).toHaveBeenCalledWith(200, 100)
    expect(tab.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(ISOLATED_WORLDS.mediaPlayerAction, [{ code: expect.any(String) }], false)
    // The page's own world never sees the script.
    expect(tab.frame.executeJavaScript).not.toHaveBeenCalled()

    expect(await act(tab, tab.frame, { x: 300, y: 150, zoom: 1.5 }, 'loop', false)).toBe(true)
    expect(video.loop).toBe(false)
  })

  it('finds the point in a pinched page from where the pinch shows it, and in a page emulating another size from the view’s corner', async () => {
    const page = framePage()
    page.visualViewport = { scale: 2, offsetLeft: 50, offsetTop: 20 }
    page.document.elementFromPoint.mockReturnValue(new HTMLVideoElement(page.document))
    const pinched = tabPage(page)
    expect(await act(pinched, pinched.frame, { x: 300, y: 150, zoom: 1.5 }, 'loop', true)).toBe(true)
    // 50 + 300 / (1.5 × 2) and 20 + 150 / 3.
    expect(page.document.elementFromPoint).toHaveBeenCalledWith(150, 70)

    // An emulated phone is 390 pixels wide in a wider view, drawn from its corner, so its width plays no part.
    const phone = framePage()
    phone.innerWidth = 390
    phone.innerHeight = 844
    phone.document.elementFromPoint.mockReturnValue(new HTMLVideoElement(phone.document))
    const tab = tabPage(phone)
    expect(await act(tab, tab.frame, { x: 200, y: 300 }, 'loop', true)).toBe(true)
    expect(phone.document.elementFromPoint).toHaveBeenCalledWith(200, 300)
  })

  it('shows and hides the controls of an audio', async () => {
    const page = framePage()
    const audio = new HTMLAudioElement(page.document)
    page.document.elementFromPoint.mockReturnValue(audio)
    const tab = tabPage(page)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'controls', true)).toBe(true)
    expect(audio.controls).toBe(true)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'controls', false)).toBe(true)
    expect(audio.controls).toBe(false)
  })

  it('shows a video in picture in picture with the person’s click, which it needs, and takes it back without', async () => {
    const page = framePage()
    const video = new HTMLVideoElement(page.document)
    page.document.elementFromPoint.mockReturnValue(video)
    const tab = tabPage(page)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'picture-in-picture', true)).toBe(true)
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce()
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'picture-in-picture', false)).toBe(true)
    expect(page.document.exitPictureInPicture).toHaveBeenCalledOnce()
    expect(page.document.pictureInPictureElement).toBeNull()
    expect(tab.gestures).toEqual([true, false])
  })

  it('leaves another video’s picture in picture alone when this one shows none', async () => {
    const page = framePage()
    const video = new HTMLVideoElement(page.document)
    page.document.pictureInPictureElement = new HTMLVideoElement(page.document)
    page.document.elementFromPoint.mockReturnValue(video)
    const tab = tabPage(page)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'picture-in-picture', false)).toBe(true)
    expect(page.document.exitPictureInPicture).not.toHaveBeenCalled()
  })

  it('reports a picture in picture the page refused, and offers none for an audio', async () => {
    const page = framePage()
    const video = new HTMLVideoElement(page.document)
    video.requestPictureInPicture.mockRejectedValueOnce(new Error('NotAllowedError'))
    page.document.elementFromPoint.mockReturnValue(video)
    const tab = tabPage(page)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'picture-in-picture', true)).toBe(false)

    page.document.elementFromPoint.mockReturnValue(new HTMLAudioElement(page.document))
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'picture-in-picture', true)).toBe(false)
  })

  it('finds a video a player keeps in its shadow root, and takes its picture in picture back', async () => {
    // Players such as Reddit's or Mux's keep the video in a shadow root, which the page's own hit test stops at.
    const page = framePage()
    const shadow = root()
    const video = new HTMLVideoElement(shadow)
    shadow.elementFromPoint.mockReturnValue(video)
    page.document.elementFromPoint.mockReturnValue(new CustomElement(shadow))
    const tab = tabPage(page)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'picture-in-picture', true)).toBe(true)
    expect(shadow.pictureInPictureElement).toBe(video)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'picture-in-picture', false)).toBe(true)
    expect(page.document.exitPictureInPicture).toHaveBeenCalledOnce()
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'loop', true)).toBe(true)
    expect(video.loop).toBe(true)
  })

  it('does nothing where no video or audio is by now, as in Chrome', async () => {
    const page = framePage()
    page.document.elementFromPoint.mockReturnValue({ loop: false })
    const tab = tabPage(page)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'loop', true)).toBe(false)
    page.document.elementFromPoint.mockReturnValue(null)
    expect(await act(tab, tab.frame, { x: 10, y: 10 }, 'controls', true)).toBe(false)
  })

  it('finds the video inside a frame of another site through each frame element on the way', async () => {
    // The page shows the frame at (100, 50), past a 2-pixel border and 3 pixels of padding, scaled to half its size.
    const page = framePage()
    const iframe = new HTMLIFrameElement({ left: 100, top: 50, width: 200, height: 150 }, 400, 300, 2, 2, { left: 3, top: 3 })
    page.document.elementFromPoint.mockReturnValue(iframe)
    const tab = tabPage(page)
    // The frame holds another frame at its own (20, 10), inside a web component's shadow root.
    const middlePage = framePage()
    const shadow = root()
    shadow.elementFromPoint.mockReturnValue(new HTMLIFrameElement({ left: 20, top: 10, width: 300, height: 200 }, 300, 200, 0, 0, { left: 0, top: 0 }))
    middlePage.document.elementFromPoint.mockReturnValue(new CustomElement(shadow))
    const middle = subframe(middlePage, tab.frame)
    const videoPage = framePage()
    // A pinch or a frame's own visual viewport plays no part below the page's own frame.
    videoPage.visualViewport = { scale: 3, offsetLeft: 40, offsetTop: 40 }
    const video = new HTMLVideoElement(videoPage.document)
    videoPage.document.elementFromPoint.mockReturnValue(video)
    const target = subframe(videoPage, middle)

    expect(await act(tab, target, { x: 160, y: 100 }, 'picture-in-picture', true)).toBe(true)
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce()
    expect(page.document.elementFromPoint).toHaveBeenCalledWith(160, 100)
    // (160 - 100) / 0.5 - 2 - 3 and (100 - 50) / 0.5 - 2 - 3.
    expect(middlePage.document.elementFromPoint).toHaveBeenCalledWith(115, 95)
    expect(videoPage.document.elementFromPoint).toHaveBeenCalledWith(95, 85)
    // Only the video's frame gets the person's click.
    expect([tab.gestures, middle.gestures, target.gestures]).toEqual([[false], [false], [true]])
  })

  it('stops when the click falls on no frame element showing a page on the way, or a frame on the way is gone', async () => {
    const page = framePage()
    page.document.elementFromPoint.mockReturnValue({})
    const tab = tabPage(page)
    const videoPage = framePage()
    const video = new HTMLVideoElement(videoPage.document)
    videoPage.document.elementFromPoint.mockReturnValue(video)
    const target = subframe(videoPage, tab.frame)
    expect(await act(tab, target, { x: 10, y: 10 }, 'loop', true)).toBe(false)
    expect(target.executeJavaScript).not.toHaveBeenCalled()

    // An object showing its fallback holds no page.
    const fallback = new HTMLObjectElement({ left: 0, top: 0, width: 100, height: 100 }, 100, 100, 0, 0, { left: 0, top: 0 })
    fallback.contentWindow = null
    page.document.elementFromPoint.mockReturnValue(fallback)
    expect(await act(tab, target, { x: 10, y: 10 }, 'loop', true)).toBe(false)
    expect(target.executeJavaScript).not.toHaveBeenCalled()

    const state = { detached: false }
    page.document.elementFromPoint.mockReturnValue(new HTMLIFrameElement({ left: 0, top: 0, width: 100, height: 100 }, 100, 100, 0, 0, { left: 0, top: 0 }))
    const leaving = subframe(videoPage, tab.frame, state)
    tab.webContents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(async () => {
      state.detached = true
      return [10, 10]
    })
    expect(await act(tab, leaving, { x: 10, y: 10 }, 'loop', true)).toBe(false)
    expect(leaving.executeJavaScript).not.toHaveBeenCalled()
    expect(video.loop).toBe(false)
  })

  it('takes no point from a page on the way but two numbers', async () => {
    const tab = tabPage(framePage())
    tab.webContents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(['10', 10])
    const target = subframe(framePage(), tab.frame)
    expect(await act(tab, target, { x: 10, y: 10 }, 'loop', true)).toBe(false)
    expect(target.executeJavaScript).not.toHaveBeenCalled()
  })

  it('does nothing for a frame whose page is already gone', async () => {
    const gone = { get parent(): never { throw new Error('Render frame was disposed before WebFrameMain could be accessed') } }
    expect(await act(tabPage(framePage()), gone, { x: 10, y: 10 }, 'loop', true)).toBe(false)
  })
})
