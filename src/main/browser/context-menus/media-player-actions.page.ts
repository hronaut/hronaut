/** Chrome's actions on the video or audio a right-click is on: Loop, Show controls and Picture in picture. */
export type MediaPlayerAction = 'loop' | 'controls' | 'picture-in-picture'

/** The page's point and the element at it. */
export interface MediaPagePoint { x: number; y: number; element: Element | null }

type PointAt = (at: [number, number], zoom: number | null) => MediaPagePoint

/**
 * Runs in a frame's page: the page's point for the view's, and the element at it inside open shadow roots, where a
 * player or an embed often keeps its video or frame. The page's own frame takes the point from the view: zoom makes the
 * page's pixels larger, and a pinch shows part of the page from an offset, larger still. A page emulating another size
 * is drawn from the view's corner at that zoom. Another frame's page has the point already, and gets a null zoom.
 */
export function mediaPagePointInPage(at: [number, number], zoom: number | null): MediaPagePoint {
  let x: number, y: number
  if (zoom === null) {
    x = at[0]
    y = at[1]
  } else {
    const pinch = visualViewport ? visualViewport.scale : 1
    x = (visualViewport ? visualViewport.offsetLeft : 0) + at[0] / (zoom * pinch)
    y = (visualViewport ? visualViewport.offsetTop : 0) + at[1] / (zoom * pinch)
  }
  let element = document.elementFromPoint(x, y)
  while (element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === element) break
    element = inner
  }
  return { x, y, element }
}

/**
 * Runs in a frame's page: the point inside the frame element at the point, in that frame's page, as the click reached
 * it: past the element's border and padding, and scaled back where the page scales the element. Null when no frame
 * element showing a page is there, such as an object showing its fallback.
 */
export function mediaFrameEntryInPage(at: [number, number], zoom: number | null, pointAt: PointAt): [number, number] | null {
  const { x, y, element } = pointAt(at, zoom)
  const nested = element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement || element instanceof HTMLObjectElement
    ? element.contentWindow !== null
    : element instanceof HTMLEmbedElement
  if (!nested) return null
  const frame = element as HTMLElement
  const rect = frame.getBoundingClientRect()
  const style = getComputedStyle(frame)
  const widthScale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1
  const heightScale = frame.offsetHeight > 0 ? rect.height / frame.offsetHeight : 1
  return [
    (x - rect.left) / widthScale - frame.clientLeft - parseFloat(style.paddingLeft || '0'),
    (y - rect.top) / heightScale - frame.clientTop - parseFloat(style.paddingTop || '0')
  ]
}

/**
 * Runs in a frame's page: acts on the video or audio at the point, resolving whether one was there to act on. A video in
 * a shadow root shows in Picture in picture as its root's, which the document gives as the root's host.
 */
export async function mediaActionInPage(at: [number, number], zoom: number | null, action: MediaPlayerAction, enable: boolean, pointAt: PointAt): Promise<boolean> {
  const media = pointAt(at, zoom).element
  if (!(media instanceof HTMLMediaElement)) return false
  if (action === 'loop') {
    media.loop = enable
    return true
  }
  if (action === 'controls') {
    media.controls = enable
    return true
  }
  if (!(media instanceof HTMLVideoElement)) return false
  try {
    if (enable) await media.requestPictureInPicture()
    else if ((media.getRootNode() as Document | ShadowRoot).pictureInPictureElement === media) await document.exitPictureInPicture()
    return true
  } catch {
    return false
  }
}
