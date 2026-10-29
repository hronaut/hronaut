import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import type { WebFrameMain } from 'electron'
import { mediaPlayerActionAt } from '../src/main/browser/context-menus/media-player-actions.js'

class HTMLMediaElement {
  loop = false
  controls = false
}
class HTMLAudioElement extends HTMLMediaElement {}
class HTMLVideoElement extends HTMLMediaElement {
  constructor(private readonly document: FramePage['document']) {
    super()
  }
  requestPictureInPicture = vi.fn(async () => {
    this.document.pictureInPictureElement = this
  })
}
class HTMLIFrameElement {
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
class HTMLFrameElement {}
class HTMLObjectElement {}
class HTMLEmbedElement {}

/** A frame's page, whose elements are where `at` puts them. */
interface FramePage {
  innerWidth: number
  innerHeight: number
  document: {
    elementFromPoint: ReturnType<typeof vi.fn>
    pictureInPictureElement: unknown
    exitPictureInPicture: ReturnType<typeof vi.fn>
  }
}

function framePage(size: { width: number; height: number } = { width: 800, height: 600 }): FramePage {
  const document: FramePage['document'] = {
    elementFromPoint: vi.fn(() => null),
    pictureInPictureElement: null,
    exitPictureInPicture: vi.fn(async () => {
      document.pictureInPictureElement = null
    })
  }
  return { innerWidth: size.width, innerHeight: size.height, document }
}

/** A frame that runs scripts in its page, as Electron's do, with the person's click when asked. */
function frame(page: FramePage, parent: unknown = null, state: { detached?: boolean; destroyed?: boolean } = {}) {
  const gestures: boolean[] = []
  return {
    parent,
    get detached() { return state.detached ?? false },
    isDestroyed: () => state.destroyed ?? false,
    gestures,
    executeJavaScript: vi.fn(async (code: string, userGesture: boolean) => {
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
    })
  }
}

const VIEW = { viewWidth: 800, viewHeight: 600 }

describe('Loop, Show controls and Picture in picture from the page menu', () => {
  it('turns on Loop for the video at the click in the page, in the page’s zoomed pixels', async () => {
    // At 150% zoom the page is 533 by 400 of its pixels in an 800 by 600 view.
    const page = framePage({ width: 800 / 1.5, height: 400 })
    const video = new HTMLVideoElement(page.document)
    page.document.elementFromPoint.mockReturnValue(video)
    const top = frame(page)
    expect(await mediaPlayerActionAt(top as unknown as WebFrameMain, { x: 300, y: 150, ...VIEW }, 'loop', true)).toBe(true)
    expect(video.loop).toBe(true)
    const [x, y] = page.document.elementFromPoint.mock.calls[0] as [number, number]
    expect(x).toBeCloseTo(200)
    expect(y).toBeCloseTo(100)
    // Loop needs no click of the person's, so the page gets none.
    expect(top.gestures).toEqual([false])

    expect(await mediaPlayerActionAt(top as unknown as WebFrameMain, { x: 300, y: 150, ...VIEW }, 'loop', false)).toBe(true)
    expect(video.loop).toBe(false)
  })

  it('shows and hides the controls of an audio', async () => {
    const page = framePage()
    const audio = new HTMLAudioElement()
    page.document.elementFromPoint.mockReturnValue(audio)
    const top = frame(page)
    expect(await mediaPlayerActionAt(top as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'controls', true)).toBe(true)
    expect(audio.controls).toBe(true)
    expect(await mediaPlayerActionAt(top as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'controls', false)).toBe(true)
    expect(audio.controls).toBe(false)
  })

  it('shows a video in picture in picture with the person’s click, which it needs, and takes it back', async () => {
    const page = framePage()
    const video = new HTMLVideoElement(page.document)
    page.document.elementFromPoint.mockReturnValue(video)
    const top = frame(page)
    expect(await mediaPlayerActionAt(top as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'picture-in-picture', true)).toBe(true)
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce()
    expect(top.gestures).toEqual([true])

    expect(await mediaPlayerActionAt(top as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'picture-in-picture', false)).toBe(true)
    expect(page.document.exitPictureInPicture).toHaveBeenCalledOnce()
    expect(page.document.pictureInPictureElement).toBeNull()
  })

  it('leaves another video’s picture in picture alone when this one shows none', async () => {
    const page = framePage()
    const video = new HTMLVideoElement(page.document)
    page.document.pictureInPictureElement = new HTMLVideoElement(page.document)
    page.document.elementFromPoint.mockReturnValue(video)
    expect(await mediaPlayerActionAt(frame(page) as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'picture-in-picture', false)).toBe(true)
    expect(page.document.exitPictureInPicture).not.toHaveBeenCalled()
  })

  it('reports a picture in picture the page refused, and offers none for an audio', async () => {
    const page = framePage()
    const video = new HTMLVideoElement(page.document)
    video.requestPictureInPicture.mockRejectedValueOnce(new Error('NotAllowedError'))
    page.document.elementFromPoint.mockReturnValue(video)
    expect(await mediaPlayerActionAt(frame(page) as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'picture-in-picture', true)).toBe(false)

    page.document.elementFromPoint.mockReturnValue(new HTMLAudioElement())
    expect(await mediaPlayerActionAt(frame(page) as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'picture-in-picture', true)).toBe(false)
  })

  it('does nothing where no video or audio is by now, as in Chrome', async () => {
    const page = framePage()
    page.document.elementFromPoint.mockReturnValue({ loop: false })
    expect(await mediaPlayerActionAt(frame(page) as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'loop', true)).toBe(false)
    page.document.elementFromPoint.mockReturnValue(null)
    expect(await mediaPlayerActionAt(frame(page) as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'controls', true)).toBe(false)
  })

  it('finds the video inside a frame of another site through each frame element on the way', async () => {
    // The page shows the frame at (100, 50), past a 2-pixel border and 3 pixels of padding, scaled to half its size.
    const page = framePage()
    const iframe = new HTMLIFrameElement({ left: 100, top: 50, width: 200, height: 150 }, 400, 300, 2, 2, { left: 3, top: 3 })
    page.document.elementFromPoint.mockReturnValue(iframe)
    const top = frame(page)
    // The frame holds another frame at its own (20, 10), with neither border, padding nor scale.
    const middlePage = framePage({ width: 390, height: 290 })
    const inner = new HTMLIFrameElement({ left: 20, top: 10, width: 300, height: 200 }, 300, 200, 0, 0, { left: 0, top: 0 })
    middlePage.document.elementFromPoint.mockReturnValue(inner)
    const middle = frame(middlePage, top)
    const videoPage = framePage({ width: 300, height: 200 })
    const video = new HTMLVideoElement(videoPage.document)
    videoPage.document.elementFromPoint.mockReturnValue(video)
    const target = frame(videoPage, middle)

    expect(await mediaPlayerActionAt(target as unknown as WebFrameMain, { x: 160, y: 100, ...VIEW }, 'loop', true)).toBe(true)
    expect(video.loop).toBe(true)
    expect(page.document.elementFromPoint).toHaveBeenCalledWith(160, 100)
    // (160 - 100) / 0.5 - 2 - 3 and (100 - 50) / 0.5 - 2 - 3.
    expect(middlePage.document.elementFromPoint).toHaveBeenCalledWith(115, 95)
    expect(videoPage.document.elementFromPoint).toHaveBeenCalledWith(95, 85)
  })

  it('stops when the click falls on no frame element on the way, or a frame on the way is gone', async () => {
    const page = framePage()
    page.document.elementFromPoint.mockReturnValue({})
    const top = frame(page)
    const videoPage = framePage()
    const video = new HTMLVideoElement(videoPage.document)
    videoPage.document.elementFromPoint.mockReturnValue(video)
    const target = frame(videoPage, top)
    expect(await mediaPlayerActionAt(target as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'loop', true)).toBe(false)
    expect(target.executeJavaScript).not.toHaveBeenCalled()

    const state = { detached: false }
    const iframe = new HTMLIFrameElement({ left: 0, top: 0, width: 100, height: 100 }, 100, 100, 0, 0, { left: 0, top: 0 })
    page.document.elementFromPoint.mockReturnValue(iframe)
    const leaving = frame(videoPage, top, state)
    top.executeJavaScript.mockImplementationOnce(async () => {
      state.detached = true
      return [10, 10]
    })
    expect(await mediaPlayerActionAt(leaving as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'loop', true)).toBe(false)
    expect(leaving.executeJavaScript).not.toHaveBeenCalled()
    expect(video.loop).toBe(false)
  })

  it('takes no point from a page on the way but two numbers', async () => {
    const page = framePage()
    const top = frame(page)
    top.executeJavaScript.mockResolvedValueOnce(['10', 10])
    const target = frame(framePage(), top)
    expect(await mediaPlayerActionAt(target as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'loop', true)).toBe(false)
    expect(target.executeJavaScript).not.toHaveBeenCalled()
  })

  it('does nothing for a frame whose page is already gone', async () => {
    const gone = { get parent(): never { throw new Error('Render frame was disposed before WebFrameMain could be accessed') } }
    expect(await mediaPlayerActionAt(gone as unknown as WebFrameMain, { x: 10, y: 10, ...VIEW }, 'loop', true)).toBe(false)
  })
})
