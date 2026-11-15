import type { WebContents, WebFrameMain } from 'electron'
import { pageScript } from '../../../shared/page-script.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { mediaActionInPage, mediaFrameEntryInPage, mediaPagePointInPage, type MediaPlayerAction } from './media-player-actions.page.js'

const MEDIA_PLAYER_WORLD_ID = ISOLATED_WORLDS.mediaPlayerAction

export type { MediaPlayerAction } from './media-player-actions.page.js'

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
    // Each frame on the way passes the point on to the frame element it falls on, and the last acts on the video there.
    const code = last
      ? pageScript(mediaActionInPage, at, zoom, action, enable, mediaPagePointInPage)
      : pageScript(mediaFrameEntryInPage, at, zoom, mediaPagePointInPage)
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
