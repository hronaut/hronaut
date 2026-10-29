import type { WebFrameMain } from 'electron'

/** Chrome's actions on the video or audio a right-click is on: Loop, Show controls and Picture in picture. */
export type MediaPlayerAction = 'loop' | 'controls' | 'picture-in-picture'

/** Where the right-click was in the tab's view, in the view's pixels, with the view's size. */
export interface MediaPlayerPoint {
  x: number
  y: number
  viewWidth: number
  viewHeight: number
}

/**
 * Turns Loop, Show controls or Picture in picture on or off for the video or audio at the right-click, as Chrome's
 * media player actions do. Electron runs no media player action at a point, so the pages find the element: the page's
 * own frame takes the point from the view, which zoom scales, each frame on the way to the video's passes it on to the
 * frame element it falls on, and the video's frame acts on the video or audio there. Loop sets the element's `loop`, as
 * in Chrome; Show controls sets its `controls`, which Chrome keeps apart from the page's attribute and Electron cannot;
 * Picture in picture asks for it with the person's click, which it needs. A frame that has navigated or gone on the
 * way, or a point with no video or audio by now, does nothing, as in Chrome. Resolves whether it acted.
 */
export async function mediaPlayerActionAt(frame: WebFrameMain, point: MediaPlayerPoint, action: MediaPlayerAction, enable: boolean): Promise<boolean> {
  const frames = framesFromTop(frame)
  if (!frames) return false
  let at: [number, number] | null = viewportPoint(point)
  for (const [index, current] of frames.entries()) {
    if (!at || current.isDestroyed() || current.detached) return false
    const view = index === 0 ? point : null
    if (index === frames.length - 1) {
      return await current.executeJavaScript(mediaActionScript(at, view, action, enable), action === 'picture-in-picture') === true
    }
    at = framePoint(await current.executeJavaScript(frameEntryScript(at, view), false))
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
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : null
}

/** A point a frame's page gave back, kept only when it is two finite numbers. */
function framePoint(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))
    ? [value[0] as number, value[1] as number]
    : null
}

/**
 * The page's point for the view's: the page's own frame scales it from the view to the page, whose zoom makes its
 * pixels larger than the view's; another frame's page has it already.
 */
function pointSource(at: [number, number], view: MediaPlayerPoint | null): string {
  const scale = view
    ? `innerWidth / ${JSON.stringify(Math.max(1, view.viewWidth))}, innerHeight / ${JSON.stringify(Math.max(1, view.viewHeight))}`
    : '1, 1'
  return `const [scaleX, scaleY] = [${scale}];
    const x = ${JSON.stringify(at[0])} * scaleX;
    const y = ${JSON.stringify(at[1])} * scaleY;`
}

/**
 * The point inside the frame element at the point, in that frame's page, as the click reached it: past the element's
 * border and padding, and scaled back where the page transforms the element. Null when no frame element is there.
 */
function frameEntryScript(at: [number, number], view: MediaPlayerPoint | null): string {
  return `(() => {
    ${pointSource(at, view)}
    const element = document.elementFromPoint(x, y);
    if (!(element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement || element instanceof HTMLObjectElement || element instanceof HTMLEmbedElement)) return null;
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

/** Acts on the video or audio at the point, resolving whether one was there to act on. */
function mediaActionScript(at: [number, number], view: MediaPlayerPoint | null, action: MediaPlayerAction, enable: boolean): string {
  return `(async () => {
    ${pointSource(at, view)}
    const media = document.elementFromPoint(x, y);
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
      else if (document.pictureInPictureElement === media) await document.exitPictureInPicture();
      return true;
    } catch {
      return false;
    }
  })()`
}
