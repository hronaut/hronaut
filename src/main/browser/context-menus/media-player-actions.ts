import type { WebContents, WebFrameMain } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'

const MEDIA_PLAYER_WORLD_ID = ISOLATED_WORLDS.mediaPlayerAction

/** Chrome's actions on the video or audio a right-click is on: Loop, Show controls and Picture in picture. */
export type MediaPlayerAction = 'loop' | 'controls' | 'picture-in-picture'

/** Where the right-click was in the tab's view, in the view's pixels, with the page's zoom factor. */
export interface MediaPlayerPoint {
  x: number
  y: number
  zoom: number
}

/**
 * Turns Loop, Show controls or Picture in picture on or off for the video or audio at the right-click, as Chrome's
 * media player actions do. Electron runs no media player action at a point, so the pages find the element: the page's
 * own frame takes the point from the view, which zoom and a pinch scale, each frame on the way to the video's passes it
 * on to the frame element it falls on, and the video's frame acts on the video or audio there, inside open shadow roots
 * too. The page's own frame does its part in a world of its own, which the page cannot see or change; Electron runs
 * scripts in another frame only in its page's world. Loop sets the element's `loop`, as in Chrome; Show controls sets
 * its `controls`, which Chrome keeps apart from the page's attribute and Electron cannot; turning Picture in picture on
 * asks for it with the person's click, which it needs. A frame that has navigated or gone on the way, or a point with
 * no video or audio by now, does nothing, as in Chrome. Resolves whether it acted.
 */
export async function mediaPlayerActionAt(webContents: WebContents, frame: WebFrameMain, point: MediaPlayerPoint, action: MediaPlayerAction, enable: boolean): Promise<boolean> {
  const frames = framesFromTop(frame)
  if (!frames) return false
  let at: [number, number] | null = viewportPoint(point)
  for (const [index, current] of frames.entries()) {
    if (!at || current.isDestroyed() || current.detached || webContents.isDestroyed()) return false
    const zoom = index === 0 ? point.zoom : null
    const last = index === frames.length - 1
    const code = last ? mediaActionScript(at, zoom, action, enable) : frameEntryScript(at, zoom)
    const userGesture = last && action === 'picture-in-picture' && enable
    const answer: unknown = index === 0
      ? await webContents.executeJavaScriptInIsolatedWorld(MEDIA_PLAYER_WORLD_ID, [{ code }], userGesture)
      : await current.executeJavaScript(code, userGesture)
    if (last) return answer === true
    at = framePoint(answer)
  }
  return false
}

/** The frames from the page's own down to the given one, or null once one of them is gone. */
function framesFromTop(frame: WebFrameMain): WebFrameMain[] | null {
  const frames: WebFrameMain[] = []
  try {
    for (let current: WebFrameMain | null = frame; current; current = current.parent) frames.unshift(current)
  } catch {
    return null
  }
  return frames
}

function viewportPoint(point: MediaPlayerPoint): [number, number] | null {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.zoom) && point.zoom > 0 ? [point.x, point.y] : null
}

/** A point a frame's page gave back, kept only when it is two finite numbers. */
function framePoint(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))
    ? [value[0] as number, value[1] as number]
    : null
}

/**
 * The page's point for the view's, and the element at it inside open shadow roots, where a player or an embed often
 * keeps its video or frame. The page's own frame takes the point from the view: zoom makes the page's pixels larger,
 * and a pinch shows part of the page from an offset, larger still. A page emulating another size is drawn from the
 * view's corner at that zoom. Another frame's page has the point already.
 */
function pointSource(at: [number, number], zoom: number | null): string {
  const point = zoom === null
    ? `const x = ${JSON.stringify(at[0])};
    const y = ${JSON.stringify(at[1])};`
    : `const pinch = visualViewport ? visualViewport.scale : 1;
    const x = (visualViewport ? visualViewport.offsetLeft : 0) + ${JSON.stringify(at[0])} / (${JSON.stringify(zoom)} * pinch);
    const y = (visualViewport ? visualViewport.offsetTop : 0) + ${JSON.stringify(at[1])} / (${JSON.stringify(zoom)} * pinch);`
  return `${point}
    let element = document.elementFromPoint(x, y);
    while (element && element.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }`
}

/**
 * The point inside the frame element at the point, in that frame's page, as the click reached it: past the element's
 * border and padding, and scaled back where the page scales the element. Null when no frame element showing a page is
 * there, such as an object showing its fallback.
 */
function frameEntryScript(at: [number, number], zoom: number | null): string {
  return `(() => {
    ${pointSource(at, zoom)}
    const nested = element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement || element instanceof HTMLObjectElement
      ? element.contentWindow !== null
      : element instanceof HTMLEmbedElement;
    if (!nested) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const widthScale = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
    const heightScale = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1;
    return [
      (x - rect.left) / widthScale - element.clientLeft - parseFloat(style.paddingLeft || '0'),
      (y - rect.top) / heightScale - element.clientTop - parseFloat(style.paddingTop || '0')
    ];
  })()`
}

/**
 * Acts on the video or audio at the point, resolving whether one was there to act on. A video in a shadow root shows in
 * Picture in picture as its root's, which the document gives as the root's host.
 */
function mediaActionScript(at: [number, number], zoom: number | null, action: MediaPlayerAction, enable: boolean): string {
  return `(async () => {
    ${pointSource(at, zoom)}
    const media = element;
    if (!(media instanceof HTMLMediaElement)) return false;
    const action = ${JSON.stringify(action)};
    const enable = ${JSON.stringify(enable)};
    if (action === 'loop') {
      media.loop = enable;
      return true;
    }
    if (action === 'controls') {
      media.controls = enable;
      return true;
    }
    if (!(media instanceof HTMLVideoElement)) return false;
    try {
      if (enable) await media.requestPictureInPicture();
      else if (media.getRootNode().pictureInPictureElement === media) await document.exitPictureInPicture();
      return true;
    } catch {
      return false;
    }
  })()`
}
